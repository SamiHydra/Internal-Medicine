<?php

namespace App\Support\Import;

use App\Support\Export\XlsxWriter;
use RuntimeException;
use SimpleXMLElement;
use ZipArchive;

/**
 * Minimal, dependency-free .xlsx reader. Parses the first worksheet into rows of
 * string cells, resolving the shared-strings table that Excel uses when it saves
 * a workbook. Pairs with {@see XlsxWriter}.
 *
 * Hardened against hostile uploads: per-part uncompressed-size cap (zip bomb),
 * DTD rejection (billion-laughs entity expansion), and no external entities.
 */
class XlsxReader
{
    /** Reject any single XML part that decompresses beyond this (zip-bomb guard). */
    private const MAX_PART_BYTES = 64 * 1024 * 1024;

    /**
     * @return array<int, array<int, string>> rows of string cells (header first)
     */
    public function rows(string $path): array
    {
        $zip = new ZipArchive;

        if ($zip->open($path) !== true) {
            throw new RuntimeException('Unable to open the spreadsheet file.');
        }

        try {
            $shared = $this->sharedStrings($zip);
            $sheetXml = $this->firstSheetXml($zip);
        } finally {
            $zip->close();
        }

        if ($sheetXml === null) {
            return [];
        }

        return $this->parseSheet($sheetXml, $shared);
    }

    /**
     * @return list<string>
     */
    private function sharedStrings(ZipArchive $zip): array
    {
        $xml = $this->readPart($zip, 'xl/sharedStrings.xml');
        $doc = $xml === null ? null : $this->loadXml($xml);

        if ($doc === null) {
            return [];
        }

        $strings = [];
        foreach ($doc->si as $si) {
            $strings[] = $this->stringItemText($si);
        }

        return $strings;
    }

    private function stringItemText(SimpleXMLElement $si): string
    {
        // <si><t>..</t></si> or rich text <si><r><t>..</t></r>...</si>
        if (isset($si->t)) {
            return (string) $si->t;
        }

        $text = '';
        foreach ($si->r as $run) {
            $text .= (string) $run->t;
        }

        return $text;
    }

    private function firstSheetXml(ZipArchive $zip): ?string
    {
        $direct = $this->readPart($zip, 'xl/worksheets/sheet1.xml');
        if ($direct !== null && $direct !== '') {
            return $direct;
        }

        for ($i = 0; $i < $zip->numFiles; $i++) {
            $name = $zip->getNameIndex($i);
            if (is_string($name) && preg_match('#^xl/worksheets/[^/]+\.xml$#', $name)) {
                $xml = $this->readPart($zip, $name);
                if ($xml !== null && $xml !== '') {
                    return $xml;
                }
            }
        }

        return null;
    }

    /**
     * Read a zip part, rejecting an oversized uncompressed payload before it is
     * pulled into memory.
     */
    private function readPart(ZipArchive $zip, string $name): ?string
    {
        $stat = $zip->statName($name);
        if ($stat === false) {
            return null;
        }

        if (($stat['size'] ?? 0) > self::MAX_PART_BYTES) {
            throw new RuntimeException('The spreadsheet is too large to import.');
        }

        $data = $zip->getFromName($name);

        return $data === false ? null : $data;
    }

    private function loadXml(string $xml): ?SimpleXMLElement
    {
        // OOXML parts must not carry a DTD; reject one to block entity-expansion
        // (billion laughs). LIBXML_NONET also disables any network/external fetch.
        if (stripos($xml, '<!DOCTYPE') !== false) {
            return null;
        }

        $doc = @simplexml_load_string($xml, SimpleXMLElement::class, LIBXML_NONET);

        return $doc === false ? null : $doc;
    }

    /**
     * @param  list<string>  $shared
     * @return array<int, array<int, string>>
     */
    private function parseSheet(string $xml, array $shared): array
    {
        $doc = $this->loadXml($xml);
        if ($doc === null || ! isset($doc->sheetData)) {
            return [];
        }

        $rows = [];
        foreach ($doc->sheetData->row as $row) {
            $cells = [];
            $maxColumn = -1;
            $cursor = 0;

            foreach ($row->c as $cell) {
                $reference = (string) ($cell['r'] ?? '');
                // Positional cells (no `r`, as some non-Excel writers emit) advance
                // a cursor instead of all collapsing to column 0.
                $column = $reference !== '' ? $this->columnIndex($reference) : $cursor;
                $cursor = $column + 1;

                $cells[$column] = $this->cellValue($cell, (string) ($cell['t'] ?? ''), $shared);
                $maxColumn = max($maxColumn, $column);
            }

            // Densify so callers can index by position even with gaps.
            $dense = [];
            for ($i = 0; $i <= $maxColumn; $i++) {
                $dense[$i] = $cells[$i] ?? '';
            }
            $rows[] = $dense;
        }

        return $rows;
    }

    /**
     * @param  list<string>  $shared
     */
    private function cellValue(SimpleXMLElement $cell, string $type, array $shared): string
    {
        if ($type === 's') {
            $index = (int) ($cell->v ?? -1);

            return $shared[$index] ?? '';
        }

        if ($type === 'inlineStr') {
            return isset($cell->is->t) ? (string) $cell->is->t : '';
        }

        return isset($cell->v) ? (string) $cell->v : '';
    }

    private function columnIndex(string $reference): int
    {
        if (! preg_match('/^([A-Z]+)/', $reference, $matches)) {
            return 0;
        }

        $letters = $matches[1];
        $index = 0;
        $length = strlen($letters);

        for ($i = 0; $i < $length; $i++) {
            $index = $index * 26 + (ord($letters[$i]) - 64);
        }

        return $index - 1;
    }
}
