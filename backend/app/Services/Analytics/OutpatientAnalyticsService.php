<?php

namespace App\Services\Analytics;

class OutpatientAnalyticsService
{
    public function __construct(
        private readonly AnalyticsService $analytics,
    ) {}

    /**
     * @return array<string, mixed>
     */
    public function summary(AnalyticsFilters $filters): array
    {
        $reports = $this->analytics->reports($filters, 'outpatient');
        $summary = $this->analytics->familySummary('outpatient', $filters);

        return [
            ...$summary,
            'outpatient' => $this->analytics->outpatientExtras($reports),
        ];
    }
}
