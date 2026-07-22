<?php

namespace App\Services\Analytics;

class InpatientAnalyticsService
{
    public function __construct(
        private readonly AnalyticsService $analytics,
    ) {}

    /**
     * @return array<string, mixed>
     */
    public function summary(AnalyticsFilters $filters): array
    {
        return $this->analytics->familySummary('inpatient', $filters);
    }
}
