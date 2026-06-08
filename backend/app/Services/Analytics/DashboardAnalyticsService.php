<?php

namespace App\Services\Analytics;

use App\Models\Report;
use App\Models\ReportAssignment;
use App\Models\ReportFieldValue;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Str;

class DashboardAnalyticsService
{
    private const CACHE_VERSION_KEY = 'analytics:dashboard:version';
    private const CACHE_REGISTRY_KEY = 'analytics:dashboard:keys';
    private const CACHE_TTL_SECONDS = 300;

    public function __construct(
        private readonly AnalyticsService $analytics,
    ) {}

    /**
     * @return array<string, mixed>
     */
    public function summary(AnalyticsFilters $filters): array
    {
        $cacheKey = $this->cacheKey($filters);
        $this->rememberCacheKey($cacheKey);

        return Cache::remember($cacheKey, self::CACHE_TTL_SECONDS, function () use ($filters): array {
            $this->analytics->flushMemo();

            $outpatientReports = $this->analytics->reports($filters, 'outpatient');
            $procedureReports = $this->analytics->reports($filters, 'procedure');

            return [
                'generatedAt' => now()->toJSON(),
                'scope' => $this->analytics->scope($filters),
                'overview' => $this->analytics->overview($filters),
                'families' => [
                    'inpatient' => $this->analytics->familySummary('inpatient', $filters),
                    'outpatient' => [
                        ...$this->analytics->familySummary('outpatient', $filters),
                        'outpatient' => $this->analytics->outpatientExtras($outpatientReports),
                    ],
                    'procedure' => [
                        ...$this->analytics->familySummary('procedure', $filters),
                        'procedures' => $this->analytics->procedureExtras($procedureReports),
                    ],
                ],
            ];
        });
    }

    public function invalidate(): void
    {
        $keys = Cache::get(self::CACHE_REGISTRY_KEY, []);

        if (is_array($keys)) {
            foreach ($keys as $key) {
                if (is_string($key) && $key !== '') {
                    Cache::forget($key);
                }
            }
        }

        Cache::forget(self::CACHE_REGISTRY_KEY);
        Cache::forget(self::CACHE_VERSION_KEY);
        Cache::forever(self::CACHE_VERSION_KEY, (string) Str::uuid());
    }

    private function version(): string
    {
        $version = Cache::get(self::CACHE_VERSION_KEY);

        if (is_string($version) && $version !== '') {
            return $version;
        }

        $version = (string) Str::uuid();
        Cache::forever(self::CACHE_VERSION_KEY, $version);

        return $version;
    }

    private function cacheKey(AnalyticsFilters $filters): string
    {
        return 'analytics:dashboard:'.$this->version().':'.md5(json_encode([
            'fingerprint' => $this->dataFingerprint(),
            'periodId' => $filters->periodId,
            'weekStart' => $filters->weekStart,
            'month' => $filters->month,
            'year' => $filters->year,
            'dateFrom' => $filters->dateFrom,
            'dateTo' => $filters->dateTo,
            'department' => $filters->department,
            'ward' => $filters->ward,
            'family' => $filters->family,
            'reportType' => $filters->reportType,
            'procedureCategory' => $filters->procedureCategory,
        ]));
    }

    private function rememberCacheKey(string $cacheKey): void
    {
        $keys = Cache::get(self::CACHE_REGISTRY_KEY, []);

        if (! is_array($keys)) {
            $keys = [];
        }

        if (! in_array($cacheKey, $keys, true)) {
            $keys[] = $cacheKey;
            Cache::forever(self::CACHE_REGISTRY_KEY, array_slice($keys, -100));
        }
    }

    /**
     * @return array<string, mixed>
     */
    private function dataFingerprint(): array
    {
        return [
            'reportCount' => Report::query()->count(),
            'latestReportUpdate' => Report::query()->max('updated_at'),
            'fieldValueCount' => ReportFieldValue::query()->count(),
            'latestFieldValueUpdate' => ReportFieldValue::query()->max('updated_at'),
            'assignmentCount' => ReportAssignment::query()->count(),
            'latestAssignmentUpdate' => ReportAssignment::query()->max('updated_at'),
        ];
    }
}
