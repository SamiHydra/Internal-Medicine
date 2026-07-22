<?php

namespace App\Services\Reports;

use App\Models\ActionItem;
use App\Models\Evaluation;
use App\Models\MorningSession;
use App\Models\Report;
use App\Models\ReportAssignment;
use App\Models\ReportingPeriod;
use App\Models\TeachingSession;
use Illuminate\Support\Collection;

/**
 * Builds the weekly leadership digest - a single at-a-glance summary of the most
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
            'periodId' => $period->id,
            'periodLabel' => sprintf(
                '%s - %s',
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
            'academic' => $this->academicBlock($period),
        ];
    }

    /**
     * The short academic block (V2 guide Phase 7): morning punctuality for
     * the week, teaching sessions held versus expected, evaluation counts.
     *
     * @return array<string, mixed>
     */
    private function academicBlock(ReportingPeriod $period): array
    {
        $from = $period->week_start?->toDateString();
        $to = $period->week_end?->toDateString();

        $morning = MorningSession::query()
            ->whereDate('session_date', '>=', $from)
            ->whereDate('session_date', '<=', $to)
            ->get();
        $recorded = $morning->where('status', 'recorded');

        $teaching = TeachingSession::query()
            ->whereDate('scheduled_date', '>=', $from)
            ->whereDate('scheduled_date', '<=', $to)
            ->get();

        $evaluationCounts = Evaluation::query()
            ->whereDate('evaluation_date', '>=', $from)
            ->whereDate('evaluation_date', '<=', $to)
            ->selectRaw('form_key, count(*) as total')
            ->groupBy('form_key')
            ->pluck('total', 'form_key');

        return [
            'morningRecorded' => $recorded->count(),
            'morningNotRecorded' => $morning->where('status', 'pending')->count(),
            'morningOnTimeRate' => $recorded->count()
                ? (int) round($recorded->avg(fn (MorningSession $session) => $session->started_on_time ? 100 : 0))
                : null,
            'morningAvgDelayMinutes' => $recorded->count()
                ? (int) round($recorded->avg(fn (MorningSession $session) => $session->delayMinutes() ?? 0))
                : null,
            'teachingHeld' => $teaching->where('status', 'held')->count(),
            'teachingExpected' => $teaching->whereIn('status', ['held', 'not_held', 'pending'])->count(),
            'peerEvaluations' => (int) ($evaluationCounts->get('consultant_mdt', 0) + $evaluationCounts->get('resident_acgme', 0)),
            'studentEvaluations' => (int) ($evaluationCounts->get('student_weekly', 0) + $evaluationCounts->get('student_final', 0)),
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
