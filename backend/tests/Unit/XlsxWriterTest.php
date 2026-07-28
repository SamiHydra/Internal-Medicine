<?php

namespace Tests\Unit;

use App\Support\Export\XlsxWriter;
use Tests\TestCase;
use ZipArchive;

class XlsxWriterTest extends TestCase
{
    public function test_builds_a_valid_single_sheet_workbook(): void
    {
        $path = (new XlsxWriter)->toTempFile(
            ['Department', 'Count'],
            [['Cardiac', 7], ['Neurology', 0]],
        );

        $this->assertTrue(is_file($path));

        $zip = new ZipArchive;
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
        $path = (new XlsxWriter)->toTempFile(
            ['Value'],
            [['a & b <c>'], ['007']],
        );

        $zip = new ZipArchive;
        $zip->open($path);
        $sheet = (string) $zip->getFromName('xl/worksheets/sheet1.xml');
        $zip->close();
        @unlink($path);

        $this->assertStringContainsString('a &amp; b &lt;c&gt;', $sheet);
        // A leading-zero code is kept as text, not coerced to the number 7.
        $this->assertStringContainsString('<t xml:space="preserve">007</t>', $sheet);
    }

    public function test_builds_a_valid_multi_sheet_workbook(): void
    {
        $path = (new XlsxWriter)->toMultiSheetTempFile([
            [
                'name' => 'Submissions',
                'header' => ['Report ID'],
                'rows' => [['report-1']],
            ],
            [
                'name' => 'Submitted Data',
                'header' => ['Day', 'Value'],
                'rows' => [['Monday', 12]],
            ],
        ]);

        $zip = new ZipArchive;
        $this->assertTrue($zip->open($path) === true);
        $workbook = (string) $zip->getFromName('xl/workbook.xml');
        $secondSheet = (string) $zip->getFromName('xl/worksheets/sheet2.xml');
        $relationships = (string) $zip->getFromName('xl/_rels/workbook.xml.rels');
        $zip->close();
        @unlink($path);

        $this->assertStringContainsString('name="Submissions"', $workbook);
        $this->assertStringContainsString('name="Submitted Data"', $workbook);
        $this->assertStringContainsString('worksheets/sheet2.xml', $relationships);
        $this->assertStringContainsString('Monday', $secondSheet);
        $this->assertStringContainsString('<v>12</v>', $secondSheet);
    }

    public function test_builds_styled_form_rows_with_widths_and_merged_headings(): void
    {
        $path = (new XlsxWriter)->toMultiSheetTempFile([
            [
                'name' => 'Clinical Form',
                'columns' => [42, 14, 14, 18],
                'showGridlines' => false,
                'rows' => [
                    [
                        'cells' => ['Chest weekly report'],
                        'style' => 'report_title',
                        'height' => 32,
                        'mergeAcross' => 4,
                    ],
                    [
                        'cells' => ['Metric', 'Mon', 'Tue', 'Weekly total'],
                        'style' => 'table_header',
                    ],
                    [
                        'cells' => ['Admissions', 10, 12, 22],
                        'styles' => ['metric', 'value', 'value', 'weekly_total'],
                    ],
                ],
            ],
        ]);

        $zip = new ZipArchive;
        $this->assertTrue($zip->open($path) === true);
        $sheet = (string) $zip->getFromName('xl/worksheets/sheet1.xml');
        $styles = (string) $zip->getFromName('xl/styles.xml');
        $relationships = (string) $zip->getFromName('xl/_rels/workbook.xml.rels');
        $zip->close();
        @unlink($path);

        $this->assertStringContainsString('showGridLines="0"', $sheet);
        $this->assertStringContainsString('<cols>', $sheet);
        $this->assertStringContainsString('<mergeCell ref="A1:D1"/>', $sheet);
        $this->assertStringContainsString('s="11"><v>22</v>', $sheet);
        $this->assertStringContainsString('<styleSheet', $styles);
        $this->assertStringContainsString('relationships/styles', $relationships);
    }
}
