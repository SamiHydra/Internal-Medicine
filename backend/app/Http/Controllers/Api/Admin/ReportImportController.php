<?php

namespace App\Http\Controllers\Api\Admin;

use App\Http\Controllers\Controller;
use App\Models\ReportingPeriod;
use App\Services\Reports\ReportImportService;
use App\Services\Reports\ReportImportTemplateService;
use App\Support\Export\XlsxWriter;
use App\Support\Import\XlsxReader;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\ValidationException;

class ReportImportController extends Controller
{
    public function __construct(
        private readonly ReportImportTemplateService $templates,
        private readonly ReportImportService $importer,
    ) {}

    public function template(Request $request): \Symfony\Component\HttpFoundation\Response
    {
        $validated = $request->validate([
            'period' => ['required', 'uuid', 'exists:reporting_periods,id'],
            'department' => ['sometimes', 'string'],
            'format' => ['sometimes', 'in:csv,xlsx'],
        ]);

        $period = ReportingPeriod::query()->findOrFail($validated['period']);
        $built = $this->templates->build($period, $validated['department'] ?? null);
        $label = $period->week_start?->toDateString() ?? 'period';

        if (($validated['format'] ?? 'xlsx') === 'csv') {
            return response()->streamDownload(function () use ($built): void {
                $handle = fopen('php://output', 'w');
                fputcsv($handle, $built['header']);
                foreach ($built['rows'] as $row) {
                    fputcsv($handle, $row);
                }
                fclose($handle);
            }, "st-paul-import-template-{$label}.csv", ['Content-Type' => 'text/csv; charset=UTF-8']);
        }

        $path = (new XlsxWriter())->toTempFile($built['header'], $built['rows']);

        return response()->download(
            $path,
            "st-paul-import-template-{$label}.xlsx",
            ['Content-Type' => 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
        )->deleteFileAfterSend();
    }

    public function import(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'file' => ['required', 'file', 'max:10240'],
            'submit' => ['sometimes', 'boolean'],
        ]);

        $file = $request->file('file');
        $extension = strtolower((string) $file->getClientOriginalExtension());

        if (! in_array($extension, ['csv', 'txt', 'xlsx'], true)) {
            throw ValidationException::withMessages(['file' => 'Upload a .csv or .xlsx file.']);
        }

        $rows = $this->parse($file->getRealPath(), $extension);
        $result = $this->importer->import($rows, $request->user(), (bool) ($validated['submit'] ?? false));

        $failedOutright = $result['imported'] === 0 && $result['errors'] !== [];

        return response()->json($result, $failedOutright ? 422 : 200);
    }

    /**
     * @return array<int, array<int, string>>
     */
    private function parse(string $path, string $extension): array
    {
        if ($extension === 'xlsx') {
            return (new XlsxReader())->rows($path);
        }

        $rows = [];
        $handle = fopen($path, 'r');
        while (($row = fgetcsv($handle)) !== false) {
            $rows[] = array_map(fn ($cell): string => (string) ($cell ?? ''), $row);
        }
        fclose($handle);

        return $rows;
    }
}
