<?php

namespace Tests\Unit;

use App\Support\Export\XlsxWriter;
use Tests\TestCase;
use ZipArchive;

class XlsxWriterTest extends TestCase
{
    public function test_builds_a_valid_single_sheet_workbook(): void
    {
        $path = (new XlsxWriter())->toTempFile(
            ['Department', 'Count'],
            [['Cardiac', 7], ['Neurology', 0]],
        );

        $this->assertTrue(is_file($path));

        $zip = new ZipArchive();
        $this->assertTrue($zip->open($path) === true);
        $this->assertNotFalse($zip->getFromName('[Content_Types].xml'));
        $this->assertNotFalse($zip->getFromName('xl/workbook.xml'));
        $sheet = (string) $zip->getFromName('xl/worksheets/sheet1.xml');
        $zip->close();
        @unlink($path);

        $this->assertStringContainsString('Department', $sheet);   // header
        $this->assertStringContainsString('Cardiac', $sheet);      // inline string
        $this->assertStringContainsString('<v>7</v>', $sheet);     // numeric cell
    }

    public function test_escapes_xml_special_characters_and_preserves_leading_zeros(): void
    {
        $path = (new XlsxWriter())->toTempFile(
            ['Value'],
            [['a & b <c>'], ['007']],
        );

        $zip = new ZipArchive();
        $zip->open($path);
        $sheet = (string) $zip->getFromName('xl/worksheets/sheet1.xml');
        $zip->close();
        @unlink($path);

        $this->assertStringContainsString('a &amp; b &lt;c&gt;', $sheet);
        // A leading-zero code is kept as text, not coerced to the number 7.
        $this->assertStringContainsString('<t xml:space="preserve">007</t>', $sheet);
    }
}
