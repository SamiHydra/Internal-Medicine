<?php

namespace App\Services\Reports;

use App\Models\ActionItem;
use App\Models\Report;
use App\Models\ReportAssignment;
use App\Models\ReportingPeriod;
use Illuminate\Support\Collection;

/**
 * Builds the weekly leadership digest — a single at-a-glance summary of the most
 * recent reporting period, mailed to leadership so they never have to assemble
 * it from a spreadsheet by hand.
 */
class LeadershipDigestService
{
    /**
     * @return array<string, mixed>
     */
    public function build(): array
    {
        $period = ReportingPeriod::query()
            ->whereDate('week_start', '<=', now())
            ->orderByDesc('week_start')
            ->first();

        if (! $period) {
            return ['hasData' => false];
        }

        $reports = Report::query()
            ->with(['fieldValues.fieldDefinition'])
            ->where('reporting_period_id', $period->id)
            ->get();

        $submitted = $reports
            ->whereIn('status', ['submitted', 'edited_after_submission', 'locked'])
            ->count();
        $expected = ReportAssignment::query()->where('active', true)->count();

        return [
            'hasData' => true,
            'periodLabel' => sprintf(
                '%s – %s',
                $period->week_start?->format('M j'),
                $period->week_end?->format('M j, Y'),
            ),
            'submitted' => $submitted,
            'expected' => $expected,
            'deliveryRate' => $expected > 0 ? (int) round($submitted / $expected * 100) : 0,
            'admissions' => $this->sumFields($reports, ['total_admitted_patients', 'new_admitted_patients']),
            'discharges' => $this->sumFields($reports, ['discharged_home', 'discharged_ama']),
            'deaths' => $this->sumFields($reports, ['new_deaths']),
            'hai' => $this->sumFields($reports, ['total_hai']),
            'outpatientSeen' => $this->sumFields($reports, ['total_patients_seen']),
            'openActionItems' => ActionItem::query()->where('status', 'open')->count(),
        ];
    }

    /**
     * @param  Collection<int, Report>  $reports
     * @param  list<string>  $fieldKeys
     */
    private function sumFields(Collection $reports, array $fieldKeys): int
    {
        return (int) $reports->sum(fn (Report $report): float => $report->fieldValues
            ->filter(fn ($value): bool => in_array($value->fieldDefinition?->field_key, $fieldKeys, true))
            ->sum(fn ($value): float => (float) ($value->value_number ?? 0)));
    }
}
