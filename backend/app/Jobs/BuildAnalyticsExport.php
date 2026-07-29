<?php

namespace App\Jobs;

use App\Models\AnalyticsExport;
use App\Models\Notification;
use App\Services\Analytics\AnalyticsExportService;
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
    ) {}

    public function handle(AnalyticsExportService $service): void
    {
        $export = AnalyticsExport::query()->findOrFail($this->exportId);
        $export->forceFill([
            'status' => AnalyticsExport::STATUS_PROCESSING,
            'error' => null,
        ])->save();

        $relativePath = "analytics-exports/{$export->user_id}/{$export->id}.csv";
        $disk = Storage::disk('local');

        if (! $disk->makeDirectory(dirname($relativePath))) {
            throw new RuntimeException('The analytics export directory could not be created.');
        }

        $handle = fopen($disk->path($relativePath), 'wb');

        if ($handle === false) {
            throw new RuntimeException('The analytics export file could not be opened.');
        }

        try {
            $rowCount = $service->writeCsv($handle);
        } finally {
            fclose($handle);
        }

        $fileName = 'clinical-submissions-full-history-'.now()->format('Y-m-d-His').'.csv';
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
            'message' => 'Your full-history clinical CSV is ready to download.',
            'related_route' => '/admin/dashboard',
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
