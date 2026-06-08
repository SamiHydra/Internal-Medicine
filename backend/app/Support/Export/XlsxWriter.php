<?php

namespace App\Support\Export;

use ZipArchive;

/**
 * Minimal, dependency-free .xlsx writer (Office Open XML). Builds a single-sheet
 * workbook using inline strings (no shared-strings table) so it needs no external
 * library — just PHP's bundled ZipArchive. The sheet XML is streamed to a temp
 * file row-by-row, so peak memory stays flat regardless of row count.
 */
class XlsxWriter
{
    /**
     * Write a worksheet to a temp .xlsx file and return its path. The caller is
     * responsible for deleting it (e.g. response()->download(...)->deleteFileAfterSend()).
     *
     * @param  list<string>  $header
     * @param  iterable<int, array<int, string|int|float|null>>  $rows
     */
    public function toTempFile(array $header, iterable $rows): string
    {
        $sheetPath = $this->tempPath('sheet');
        $sheet = fopen($sheetPath, 'w');

        fwrite($sheet, '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>');
        fwrite($sheet, '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>');

        $rowIndex = 1;
        $this->writeRow($sheet, $rowIndex++, $header, true);
        foreach ($rows as $row) {
            $this->writeRow($sheet, $rowIndex++, array_values($row), false);
        }

        fwrite($sheet, '</sheetData></worksheet>');
        fclose($sheet);

        $xlsxPath = $this->tempPath('xlsx');
        $zip = new ZipArchive();
        $zip->open($xlsxPath, ZipArchive::OVERWRITE);
        $zip->addFromString('[Content_Types].xml', $this->contentTypes());
        $zip->addFromString('_rels/.rels', $this->rootRels());
        $zip->addFromString('xl/workbook.xml', $this->workbook());
        $zip->addFromString('xl/_rels/workbook.xml.rels', $this->workbookRels());
        $zip->addFile($sheetPath, 'xl/worksheets/sheet1.xml');
        $zip->close();

        @unlink($sheetPath);

        return $xlsxPath;
    }

    /**
     * @param  resource  $handle
     * @param  array<int, string|int|float|null>  $cells
     */
    private function writeRow($handle, int $rowIndex, array $cells, bool $isHeader): void
    {
        fwrite($handle, '<row r="'.$rowIndex.'">');

        $column = 0;
        foreach ($cells as $cell) {
            $ref = $this->columnLetter($column++).$rowIndex;
            $value = (string) ($cell ?? '');

            // Numbers (not the header, not values with leading zeros) become numeric
            // cells; everything else is an inline string.
            if (! $isHeader && $value !== '' && is_numeric($value) && ! $this->hasLeadingZero($value)) {
                fwrite($handle, '<c r="'.$ref.'"><v>'.$value.'</v></c>');

                continue;
            }

            fwrite($handle, '<c r="'.$ref.'" t="inlineStr"><is><t xml:space="preserve">'.$this->escape($value).'</t></is></c>');
        }

        fwrite($handle, '</row>');
    }

    private function hasLeadingZero(string $value): bool
    {
        return strlen($value) > 1 && $value[0] === '0' && $value[1] !== '.';
    }

    private function escape(string $value): string
    {
        return htmlspecialchars($value, ENT_QUOTES | ENT_XML1, 'UTF-8');
    }

    private function columnLetter(int $index): string
    {
        $letter = '';
        $index++;

        while ($index > 0) {
            $remainder = ($index - 1) % 26;
            $letter = chr(65 + $remainder).$letter;
            $index = intdiv($index - 1, 26);
        }

        return $letter;
    }

    private function tempPath(string $prefix): string
    {
        $path = tempnam(sys_get_temp_dir(), $prefix);

        if ($path === false) {
            throw new \RuntimeException('Unable to allocate a temp file for the xlsx export.');
        }

        return $path;
    }

    private function contentTypes(): string
    {
        return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            .'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
            .'<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
            .'<Default Extension="xml" ContentType="application/xml"/>'
            .'<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
            .'<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
            .'</Types>';
    }

    private function rootRels(): string
    {
        return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            .'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            .'<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'
            .'</Relationships>';
    }

    private function workbook(): string
    {
        return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            .'<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
            .'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
            .'<sheets><sheet name="Report" sheetId="1" r:id="rId1"/></sheets>'
            .'</workbook>';
    }

    private function workbookRels(): string
    {
        return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            .'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            .'<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>'
            .'</Relationships>';
    }
}
