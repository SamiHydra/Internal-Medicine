<?php

namespace App\Services\Analytics;

class ProcedureAnalyticsService
{
    public function __construct(
        private readonly AnalyticsService $analytics,
    ) {}

    /**
     * @return array<string, mixed>
     */
    public function summary(AnalyticsFilters $filters): array
    {
        $reports = $this->analytics->reports($filters, 'procedure');
        $summary = $this->analytics->familySummary('procedure', $filters);

        return [
            ...$summary,
            'procedures' => $this->analytics->procedureExtras($reports),
        ];
    }
}
