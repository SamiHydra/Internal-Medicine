<?php

namespace App\Services\Reports;

use App\Models\Notification;
use App\Models\ReportAssignment;
use App\Models\ReportingPeriod;
use App\Services\Admin\AppSettingsService;
use App\Services\Notifications\NotificationDeliveryService;
use Illuminate\Support\Carbon;
use Illuminate\Support\Collection;

class ReportReminderService
{
    private const LIVE_REPORTING_START = '2026-03-02';

    private const OVERDUE_LOOKBACK_DAYS = 7;

    public function __construct(
        private readonly AppSettingsService $settings,
        private readonly NotificationDeliveryService $delivery,
    ) {}

    /**
     * @return array{deadlineEnforced: bool, candidates: int, remindersCreated: int, deliveriesQueued: int}
     */
    public function sendDue(): array
    {
        $settings = $this->settings->structured();

        if (! (bool) $settings['deadlineEnforced']) {
            return [
                'deadlineEnforced' => false,
                'candidates' => 0,
                'remindersCreated' => 0,
                'deliveriesQueued' => 0,
            ];
        }

        $now = now();
        $periods = $this->candidatePeriods($now, $settings['reportReminderThresholds'] ?? []);
        $created = 0;
        $deliveriesQueued = 0;
        $candidates = 0;

        foreach ($periods as $period) {
            $assignments = $this->unsubmittedAssignments($period);

            foreach ($assignments as $assignment) {
                $dueTiers = $this->dueTiers($period, $settings['reportReminderThresholds'] ?? [], $now);

                if ($dueTiers === []) {
                    continue;
                }

                $candidates++;

                foreach ($dueTiers as $tier) {
                    if (! $this->createReminder($assignment, $period, $tier, $now)) {
                        continue;
                    }

                    $created++;
                    $channels = $this->channelsForTier($tier);

                    if ($channels !== []) {
                        $this->delivery->queue(
                            $assignment->nurse,
                            $this->titleForTier($tier),
                            $this->messageForTier($assignment, $tier),
                            $channels,
                            $this->route($assignment, $period),
                        );
                        $deliveriesQueued++;
                    }
                }
            }
        }

        return [
            'deadlineEnforced' => true,
            'candidates' => $candidates,
            'remindersCreated' => $created,
            'deliveriesQueued' => $deliveriesQueued,
        ];
    }

    /**
     * @param  array<string, mixed>  $thresholds
     * @return Collection<int, ReportingPeriod>
     */
    private function candidatePeriods(Carbon $now, array $thresholds): Collection
    {
        $currentPeriod = ReportingPeriod::query()
            ->whereDate('week_start', '<=', $now->toDateString())
            ->orderByDesc('week_start')
            ->first();

        if (! $currentPeriod) {
            return collect();
        }

        $maxHoursBefore = max(
            (int) ($thresholds['inAppHoursBeforeDeadline'] ?? 24),
            (int) ($thresholds['emailHoursBeforeDeadline'] ?? 4),
            (int) ($thresholds['smsHoursBeforeDeadline'] ?? 1),
            0,
        );

        return ReportingPeriod::query()
            ->whereDate('week_start', '>=', self::LIVE_REPORTING_START)
            ->whereDate('week_start', '<=', $currentPeriod->week_start?->toDateString())
            ->where('deadline_at', '>=', $now->copy()->subDays(self::OVERDUE_LOOKBACK_DAYS))
            ->where('deadline_at', '<=', $now->copy()->addHours($maxHoursBefore))
            ->orderBy('deadline_at')
            ->get();
    }

    /**
     * @return Collection<int, ReportAssignment>
     */
    private function unsubmittedAssignments(ReportingPeriod $period): Collection
    {
        return ReportAssignment::query()
            ->with(['department', 'nurse', 'reports' => fn ($query) => $query->where('reporting_period_id', $period->id)])
            ->where('active', true)
            ->whereHas('nurse', fn ($query) => $query->where('active', true))
            ->where(function ($query) use ($period): void {
                $query->whereDoesntHave('reports', fn ($reportQuery) => $reportQuery->where('reporting_period_id', $period->id))
                    ->orWhereHas('reports', fn ($reportQuery) => $reportQuery
                        ->where('reporting_period_id', $period->id)
                        ->where('status', 'draft')
                        ->whereNull('locked_at'));
            })
            ->orderBy('approved_at')
            ->get();
    }

    /**
     * @param  array<string, mixed>  $thresholds
     * @return list<string>
     */
    private function dueTiers(ReportingPeriod $period, array $thresholds, Carbon $now): array
    {
        $deadline = $period->deadline_at;

        if (! $deadline) {
            return [];
        }

        if ($now->greaterThanOrEqualTo($deadline->copy()->addHours((int) ($thresholds['overdueHoursAfterDeadline'] ?? 0)))) {
            return ['overdue'];
        }

        if ($now->greaterThan($deadline)) {
            return [];
        }

        return collect([
            'in_app' => (int) ($thresholds['inAppHoursBeforeDeadline'] ?? 24),
            'email' => (int) ($thresholds['emailHoursBeforeDeadline'] ?? 4),
            'sms' => (int) ($thresholds['smsHoursBeforeDeadline'] ?? 1),
        ])
            ->filter(fn (int $hours): bool => $hours >= 0 && $now->greaterThanOrEqualTo($deadline->copy()->subHours($hours)))
            ->keys()
            ->values()
            ->all();
    }

    private function createReminder(ReportAssignment $assignment, ReportingPeriod $period, string $tier, Carbon $now): bool
    {
        $eventKey = sprintf('reminder:%s:%s:%s', $tier, $assignment->id, $period->id);
        $notification = Notification::query()->firstOrNew([
            'recipient_id' => $assignment->nurse_id,
            'type' => 'report_reminder',
            'related_entity' => $eventKey,
        ]);

        if ($notification->exists) {
            return false;
        }

        $notification->fill([
            'title' => $this->titleForTier($tier),
            'message' => $this->messageForTier($assignment, $tier),
            'related_route' => $this->route($assignment, $period),
            'related_id' => null,
            'created_at' => $now,
        ]);
        $notification->save();

        return true;
    }

    /**
     * @return list<string>
     */
    private function channelsForTier(string $tier): array
    {
        return match ($tier) {
            'email' => ['email'],
            'sms' => ['sms'],
            'overdue' => ['email', 'sms'],
            default => [],
        };
    }

    private function titleForTier(string $tier): string
    {
        return match ($tier) {
            'overdue' => 'Report overdue',
            default => 'Report reminder',
        };
    }

    private function messageForTier(ReportAssignment $assignment, string $tier): string
    {
        $departmentName = $assignment->department?->name ?? 'Your assigned department';

        return match ($tier) {
            'overdue' => sprintf('%s is overdue and still needs submission.', $departmentName),
            'sms' => sprintf('%s is due very soon. Please submit it as soon as possible.', $departmentName),
            'email' => sprintf('%s is nearing its reporting deadline.', $departmentName),
            default => sprintf('%s is coming up for submission.', $departmentName),
        };
    }

    private function route(ReportAssignment $assignment, ReportingPeriod $period): string
    {
        return sprintf('/reports/%s/%s', $assignment->id, $period->id);
    }
}
