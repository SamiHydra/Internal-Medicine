<?php

namespace Tests\Unit;

use App\Support\Export\XlsxWriter;
use App\Support\Import\XlsxReader;
use Tests\TestCase;
use ZipArchive;

class XlsxReaderTest extends TestCase
{
    public function test_round_trips_a_workbook_written_by_xlsx_writer(): void
    {
        $path = (new XlsxWriter())->toTempFile(
            ['Field key', 'Monday'],
            [['total_admitted_patients', 5], ['new_deaths', 0]],
        );

        $rows = (new XlsxReader())->rows($path);
        @unlink($path);

        $this->assertSame(['Field key', 'Monday'], $rows[0]);
        $this->assertSame(['total_admitted_patients', '5'], $rows[1]);
        $this->assertSame(['new_deaths', '0'], $rows[2]);
    }

    public function test_resolves_excel_shared_strings(): void
    {
        // Excel saves text via a shared-strings table (t="s" cells referencing it).
        $path = tempnam(sys_get_temp_dir(), 'xlsxr');
        $zip = new ZipArchive();
        $zip->open($path, ZipArchive::OVERWRITE);
        $zip->addFromString(
            'xl/sharedStrings.xml',
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            .'<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
            .'<si><t>Field key</t></si><si><t>gi_neuro_inpatient</t></si></sst>',
        );
        $zip->addFromString(
            'xl/worksheets/sheet1.xml',
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            .'<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>'
            .'<row r="1"><c r="A1" t="s"><v>0</v></c><c r="C1"><v>42</v></c></row>'
            .'<row r="2"><c r="A2" t="s"><v>1</v></c></row>'
            .'</sheetData></worksheet>',
        );
        $zip->close();

        $rows = (new XlsxReader())->rows($path);
        @unlink($path);

        // Shared strings resolved, and the gap at column B is densified to ''.
        $this->assertSame(['Field key', '', '42'], $rows[0]);
        $this->assertSame(['gi_neuro_inpatient'], $rows[1]);
    }
}
