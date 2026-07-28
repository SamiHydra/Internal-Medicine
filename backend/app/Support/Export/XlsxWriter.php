<?php

namespace App\Support\Export;

use ZipArchive;

/**
 * Dependency-free .xlsx writer (Office Open XML). It uses inline strings (no
 * shared-strings table) and streams worksheet rows to temp files, so large
 * clinical-history exports keep bounded memory. In addition to plain tabular
 * sheets it supports a small, controlled style vocabulary for form-like sheets.
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
        return $this->toMultiSheetTempFile([
            [
                'name' => 'Report',
                'header' => $header,
                'rows' => $rows,
            ],
        ]);
    }

    /**
     * Build a workbook with multiple independently streamed worksheets.
     *
     * @param  list<array{
     *     name: string,
     *     header?: list<string>,
     *     rows: iterable<int, array<int, string|int|float|null>|array{
     *         cells: list<string|int|float|null>,
     *         style?: string,
     *         styles?: list<string|null>,
     *         height?: int|float,
     *         mergeAcross?: int,
     *         mergeRanges?: list<array{0: int, 1: int}>
     *     }>,
     *     columns?: list<int|float>,
     *     freezeRows?: int,
     *     showGridlines?: bool,
     *     autoFilter?: bool
     * }>  $sheets
     */
    public function toMultiSheetTempFile(array $sheets): string
    {
        if ($sheets === []) {
            throw new \InvalidArgumentException('At least one worksheet is required.');
        }

        $sheetFiles = [];
        $sheetNames = [];

        foreach ($sheets as $index => $definition) {
            $sheetPath = $this->tempPath('sheet');
            $sheetFiles[] = $sheetPath;
            $sheetNames[] = $this->worksheetName($definition['name'], $sheetNames, $index + 1);
            $this->writeSheet($sheetPath, $definition);
        }

        $xlsxPath = $this->tempPath('xlsx');
        $zip = new ZipArchive;
        $zip->open($xlsxPath, ZipArchive::OVERWRITE);
        $zip->addFromString('[Content_Types].xml', $this->contentTypes(count($sheetFiles)));
        $zip->addFromString('_rels/.rels', $this->rootRels());
        $zip->addFromString('xl/workbook.xml', $this->workbook($sheetNames));
        $zip->addFromString('xl/_rels/workbook.xml.rels', $this->workbookRels(count($sheetFiles)));
        $zip->addFromString('xl/styles.xml', $this->styles());

        foreach ($sheetFiles as $index => $sheetPath) {
            $zip->addFile($sheetPath, 'xl/worksheets/sheet'.($index + 1).'.xml');
        }

        $zip->close();

        foreach ($sheetFiles as $sheetPath) {
            @unlink($sheetPath);
        }

        return $xlsxPath;
    }

    /**
     * @param  array{
     *     header?: list<string>,
     *     rows: iterable<int, array<int, string|int|float|null>|array{
     *         cells: list<string|int|float|null>,
     *         style?: string,
     *         styles?: list<string|null>,
     *         height?: int|float,
     *         mergeAcross?: int,
     *         mergeRanges?: list<array{0: int, 1: int}>
     *     }>,
     *     columns?: list<int|float>,
     *     freezeRows?: int,
     *     showGridlines?: bool,
     *     autoFilter?: bool
     * }  $definition
     */
    private function writeSheet(string $sheetPath, array $definition): void
    {
        $sheet = fopen($sheetPath, 'w');
        fwrite($sheet, '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>');
        fwrite($sheet, '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">');
        fwrite($sheet, $this->sheetViews(
            (int) ($definition['freezeRows'] ?? 0),
            (bool) ($definition['showGridlines'] ?? true),
        ));
        fwrite($sheet, '<sheetFormatPr defaultRowHeight="18"/>');

        if (($definition['columns'] ?? []) !== []) {
            fwrite($sheet, $this->columns($definition['columns']));
        }

        fwrite($sheet, '<sheetData>');

        $rowIndex = 1;
        $merges = [];
        $header = $definition['header'] ?? [];

        if ($header !== []) {
            $this->writeRow($sheet, $rowIndex++, [
                'cells' => $header,
                'style' => 'header',
                'height' => 24,
            ], $merges);
        }

        foreach ($definition['rows'] as $row) {
            $descriptor = array_key_exists('cells', $row)
                ? $row
                : ['cells' => array_values($row)];
            $this->writeRow($sheet, $rowIndex++, $descriptor, $merges);
        }

        fwrite($sheet, '</sheetData>');

        if (($definition['autoFilter'] ?? false) && $header !== []) {
            $lastColumn = $this->columnLetter(max(count($header) - 1, 0));
            fwrite($sheet, '<autoFilter ref="A1:'.$lastColumn.max($rowIndex - 1, 1).'"/>');
        }

        if ($merges !== []) {
            fwrite($sheet, '<mergeCells count="'.count($merges).'">');
            foreach ($merges as $merge) {
                fwrite($sheet, '<mergeCell ref="'.$merge.'"/>');
            }
            fwrite($sheet, '</mergeCells>');
        }

        fwrite($sheet, '<pageMargins left="0.3" right="0.3" top="0.5" bottom="0.5" header="0.2" footer="0.2"/>');
        fwrite($sheet, '</worksheet>');
        fclose($sheet);
    }

    /**
     * @param  resource  $handle
     * @param  array{
     *     cells: list<string|int|float|null>,
     *     style?: string,
     *     styles?: list<string|null>,
     *     height?: int|float,
     *     mergeAcross?: int,
     *     mergeRanges?: list<array{0: int, 1: int}>
     * }  $row
     * @param  list<string>  $merges
     */
    private function writeRow($handle, int $rowIndex, array $row, array &$merges): void
    {
        $height = isset($row['height']) ? ' ht="'.(float) $row['height'].'" customHeight="1"' : '';
        fwrite($handle, '<row r="'.$rowIndex.'"'.$height.'>');

        $column = 0;
        foreach ($row['cells'] as $cell) {
            $ref = $this->columnLetter($column++).$rowIndex;
            $value = (string) ($cell ?? '');
            $styleName = $row['styles'][$column - 1] ?? $row['style'] ?? null;
            $style = $styleName !== null ? ' s="'.$this->styleId($styleName).'"' : '';

            // Numbers without leading zeros become numeric cells; everything else
            // is an inline string. Formula-like text is neutralized below.
            if ($value !== '' && is_numeric($value) && ! $this->hasLeadingZero($value)) {
                fwrite($handle, '<c r="'.$ref.'"'.$style.'><v>'.$value.'</v></c>');

                continue;
            }

            $rendered = SpreadsheetSafe::sanitize($value);
            fwrite($handle, '<c r="'.$ref.'"'.$style.' t="inlineStr"><is><t xml:space="preserve">'.$this->escape($rendered).'</t></is></c>');
        }

        fwrite($handle, '</row>');

        if (($row['mergeAcross'] ?? 0) > 1) {
            $merges[] = 'A'.$rowIndex.':'.$this->columnLetter($row['mergeAcross'] - 1).$rowIndex;
        }

        foreach ($row['mergeRanges'] ?? [] as [$from, $to]) {
            if ($to > $from) {
                $merges[] = $this->columnLetter($from).$rowIndex.':'.$this->columnLetter($to).$rowIndex;
            }
        }
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

    private function contentTypes(int $sheetCount): string
    {
        $overrides = '';

        for ($index = 1; $index <= $sheetCount; $index++) {
            $overrides .= '<Override PartName="/xl/worksheets/sheet'.$index.'.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>';
        }

        return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            .'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
            .'<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
            .'<Default Extension="xml" ContentType="application/xml"/>'
            .'<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
            .'<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
            .$overrides
            .'</Types>';
    }

    private function rootRels(): string
    {
        return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            .'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            .'<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'
            .'</Relationships>';
    }

    /**
     * @param  list<string>  $sheetNames
     */
    private function workbook(array $sheetNames): string
    {
        $sheets = '';

        foreach ($sheetNames as $index => $name) {
            $sheetId = $index + 1;
            $sheets .= '<sheet name="'.$this->escape($name).'" sheetId="'.$sheetId.'" r:id="rId'.$sheetId.'"/>';
        }

        return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            .'<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
            .'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
            .'<sheets>'.$sheets.'</sheets>'
            .'</workbook>';
    }

    private function workbookRels(int $sheetCount): string
    {
        $relationships = '';

        for ($index = 1; $index <= $sheetCount; $index++) {
            $relationships .= '<Relationship Id="rId'.$index.'" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet'.$index.'.xml"/>';
        }

        $relationships .= '<Relationship Id="rId'.($sheetCount + 1).'" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>';

        return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            .'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            .$relationships
            .'</Relationships>';
    }

    /**
     * @param  list<int|float>  $widths
     */
    private function columns(array $widths): string
    {
        $xml = '<cols>';

        foreach ($widths as $index => $width) {
            $column = $index + 1;
            $xml .= '<col min="'.$column.'" max="'.$column.'" width="'.(float) $width.'" customWidth="1"/>';
        }

        return $xml.'</cols>';
    }

    private function sheetViews(int $freezeRows, bool $showGridlines): string
    {
        $gridlines = $showGridlines ? '1' : '0';
        $pane = $freezeRows > 0
            ? '<pane ySplit="'.$freezeRows.'" topLeftCell="A'.($freezeRows + 1).'" activePane="bottomLeft" state="frozen"/>'
            : '';

        return '<sheetViews><sheetView showGridLines="'.$gridlines.'" workbookViewId="0">'.$pane.'</sheetView></sheetViews>';
    }

    private function styleId(string $name): int
    {
        return match ($name) {
            'header' => 1,
            'report_title' => 2,
            'report_subtitle' => 3,
            'meta_label' => 4,
            'meta_value' => 5,
            'section_title' => 6,
            'section_description' => 7,
            'table_header' => 8,
            'metric' => 9,
            'value' => 10,
            'weekly_total' => 11,
            default => 0,
        };
    }

    private function styles(): string
    {
        return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            .'<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
            .'<fonts count="7">'
            .'<font><sz val="11"/><name val="Calibri"/><family val="2"/></font>'
            .'<font><b/><color rgb="FFFFFFFF"/><sz val="11"/><name val="Calibri"/></font>'
            .'<font><b/><color rgb="FFFFFFFF"/><sz val="17"/><name val="Calibri"/></font>'
            .'<font><color rgb="FFD7E8F4"/><sz val="10"/><name val="Calibri"/></font>'
            .'<font><b/><color rgb="FF001B36"/><sz val="11"/><name val="Calibri"/></font>'
            .'<font><b/><color rgb="FF001B36"/><sz val="14"/><name val="Calibri"/></font>'
            .'<font><i/><color rgb="FF5E6875"/><sz val="10"/><name val="Calibri"/></font>'
            .'</fonts>'
            .'<fills count="7">'
            .'<fill><patternFill patternType="none"/></fill>'
            .'<fill><patternFill patternType="gray125"/></fill>'
            .'<fill><patternFill patternType="solid"><fgColor rgb="FF001B36"/><bgColor indexed="64"/></patternFill></fill>'
            .'<fill><patternFill patternType="solid"><fgColor rgb="FF0F8EA8"/><bgColor indexed="64"/></patternFill></fill>'
            .'<fill><patternFill patternType="solid"><fgColor rgb="FFEAF3F8"/><bgColor indexed="64"/></patternFill></fill>'
            .'<fill><patternFill patternType="solid"><fgColor rgb="FFF8FAFC"/><bgColor indexed="64"/></patternFill></fill>'
            .'<fill><patternFill patternType="solid"><fgColor rgb="FFFFF4D6"/><bgColor indexed="64"/></patternFill></fill>'
            .'</fills>'
            .'<borders count="2">'
            .'<border><left/><right/><top/><bottom/><diagonal/></border>'
            .'<border><left style="thin"><color rgb="FFD9E0E7"/></left><right style="thin"><color rgb="FFD9E0E7"/></right><top style="thin"><color rgb="FFD9E0E7"/></top><bottom style="thin"><color rgb="FFD9E0E7"/></bottom><diagonal/></border>'
            .'</borders>'
            .'<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
            .'<cellXfs count="12">'
            .'<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'
            .'<xf numFmtId="0" fontId="1" fillId="3" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>'
            .'<xf numFmtId="0" fontId="2" fillId="2" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="center"/></xf>'
            .'<xf numFmtId="0" fontId="3" fillId="2" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="center"/></xf>'
            .'<xf numFmtId="0" fontId="4" fillId="4" borderId="1" xfId="0" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>'
            .'<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>'
            .'<xf numFmtId="0" fontId="5" fillId="4" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="center"/></xf>'
            .'<xf numFmtId="0" fontId="6" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>'
            .'<xf numFmtId="0" fontId="1" fillId="3" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>'
            .'<xf numFmtId="0" fontId="4" fillId="5" borderId="1" xfId="0" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>'
            .'<xf numFmtId="0" fontId="0" fillId="5" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>'
            .'<xf numFmtId="0" fontId="4" fillId="6" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>'
            .'</cellXfs>'
            .'<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>'
            .'</styleSheet>';
    }

    /**
     * Excel limits names to 31 characters and forbids []:*?/\. Make names
     * deterministic and unique so generated workbooks always open cleanly.
     *
     * @param  list<string>  $existingNames
     */
    private function worksheetName(string $requested, array $existingNames, int $fallbackIndex): string
    {
        $base = trim((string) preg_replace('/[\[\]:*?\/\\\\]/', ' ', $requested));
        $base = mb_substr($base !== '' ? $base : 'Sheet '.$fallbackIndex, 0, 31);
        $name = $base;
        $suffix = 2;

        while (in_array(mb_strtolower($name), array_map('mb_strtolower', $existingNames), true)) {
            $tail = ' '.$suffix++;
            $name = mb_substr($base, 0, 31 - mb_strlen($tail)).$tail;
        }

        return $name;
    }
}
