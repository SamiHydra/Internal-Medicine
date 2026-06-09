<?php

namespace App\Support\Import;

use RuntimeException;
use SimpleXMLElement;
use ZipArchive;

/**
 * Minimal, dependency-free .xlsx reader. Parses the first worksheet into rows of
 * string cells, resolving the shared-strings table that Excel uses when it saves
 * a workbook. Pairs with {@see \App\Support\Export\XlsxWriter}.
 */
class XlsxReader
{
    /**
     * @return array<int, array<int, string>>  rows of string cells (header first)
     */
    public function rows(string $path): array
    {
        $zip = new ZipArchive();

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
        $xml = $zip->getFromName('xl/sharedStrings.xml');

        if ($xml === false || $xml === '') {
            return [];
        }

        $doc = @simplexml_load_string($xml);
        if ($doc === false) {
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
        $direct = $zip->getFromName('xl/worksheets/sheet1.xml');
        if ($direct !== false && $direct !== '') {
            return $direct;
        }

        for ($i = 0; $i < $zip->numFiles; $i++) {
            $name = $zip->getNameIndex($i);
            if (is_string($name) && preg_match('#^xl/worksheets/[^/]+\.xml$#', $name)) {
                $xml = $zip->getFromIndex($i);
                if ($xml !== false && $xml !== '') {
                    return $xml;
                }
            }
        }

        return null;
    }

    /**
     * @param  list<string>  $shared
     * @return array<int, array<int, string>>
     */
    private function parseSheet(string $xml, array $shared): array
    {
        $doc = @simplexml_load_string($xml);
        if ($doc === false || ! isset($doc->sheetData)) {
            return [];
        }

        $rows = [];
        foreach ($doc->sheetData->row as $row) {
            $cells = [];
            $maxColumn = -1;

            foreach ($row->c as $cell) {
                $column = $this->columnIndex((string) ($cell['r'] ?? ''));
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
