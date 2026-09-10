<?php

namespace App\Jobs;

use App\Models\AnalyticsExport;
use App\Models\Notification;
use App\Services\Analytics\AnalyticsExportService;
use App\Support\Export\XlsxWriter;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Support\Facades\Storage;
use RuntimeException;
use Throwable;

class BuildAnalyticsExport implements ShouldQueue
{
    use Queueable;

    public int $tries = 2;

    public int $timeout = 300;

    public array $backoff = [30, 120];

    public function __construct(
        public readonly string $exportId,
    ) {
        $this->onQueue('analytics');
    }

    public function handle(AnalyticsExportService $service): void
    {
        $export = AnalyticsExport::query()->findOrFail($this->exportId);
        $export->forceFill([
            'status' => AnalyticsExport::STATUS_PROCESSING,
            'error' => null,
        ])->save();

        $service->withFilters($export->filters);

        $format = $export->format === 'xlsx' ? 'xlsx' : 'csv';
        $relativePath = "analytics-exports/{$export->user_id}/{$export->id}.{$format}";
        $disk = Storage::disk('local');

        if (! $disk->makeDirectory(dirname($relativePath))) {
            throw new RuntimeException('The analytics export directory could not be created.');
        }

        if ($format === 'xlsx') {
            $sheets = $service->workbookSheets();
            $temporaryPath = (new XlsxWriter)->toMultiSheetTempFile($sheets);
            $handle = fopen($temporaryPath, 'rb');

            if ($handle === false) {
                @unlink($temporaryPath);
                throw new RuntimeException('The Excel export file could not be opened.');
            }

            try {
                if (! $disk->put($relativePath, $handle)) {
                    throw new RuntimeException('The Excel export file could not be stored.');
                }
            } finally {
                fclose($handle);
                @unlink($temporaryPath);
            }

            // One workbook sheet per submitted report, excluding the index and
            // edit-history sheets.
            $rowCount = max(0, count($sheets) - 2);
        } else {
            $handle = fopen($disk->path($relativePath), 'wb');

            if ($handle === false) {
                throw new RuntimeException('The analytics export file could not be opened.');
            }

            try {
                $rowCount = $service->writeCsv($handle);
            } finally {
                fclose($handle);
            }
        }

        // "full-history" is only honest when nothing was narrowed.
        $scope = $export->filters ? 'filtered' : 'full-history';
        $fileName = "clinical-submissions-{$scope}-".now()->format('Y-m-d-His').".{$format}";
        $export->forceFill([
            'status' => AnalyticsExport::STATUS_READY,
            'file_path' => $relativePath,
            'file_name' => $fileName,
            'row_count' => $rowCount,
            'byte_size' => $disk->size($relativePath),
            'completed_at' => now(),
            'expires_at' => now()->addDays(7),
            'error' => null,
        ])->save();

        Notification::query()->create([
            'recipient_id' => $export->user_id,
            'type' => 'analytics_export_ready',
            'title' => 'Clinical export ready',
            'message' => sprintf(
                'Your %s clinical %s export is ready to download.',
                $export->filters ? 'filtered' : 'full-history',
                $format,
            ),
            // The admin dashboard, which hosts AnalyticsExportPanel and so is
            // where the finished file is actually downloaded. There is no
            // /admin/dashboard route; the SPA would render not-found.
            'related_route' => '/admin',
            'related_entity' => 'analytics_export',
            'related_id' => $export->id,
            'created_at' => now(),
        ]);
    }

    public function failed(?Throwable $exception): void
    {
        AnalyticsExport::query()
            ->whereKey($this->exportId)
            ->update([
                'status' => AnalyticsExport::STATUS_FAILED,
                'error' => mb_substr($exception?->getMessage() ?? 'Export failed.', 0, 2000),
                'completed_at' => now(),
            ]);
    }
}
