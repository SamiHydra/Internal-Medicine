<?php

namespace App\Services\Reports;

use App\Models\Notification;
use App\Models\Report;
use App\Models\ReportStatusHistory;
use App\Models\User;
use App\Services\Analytics\DashboardAnalyticsService;
use App\Support\Authorization\Permissions;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Support\Facades\DB;

/**
 * Locking is an overlay on the report lifecycle, not a step in it. A lock
 * makes the report read-only for everyone until an administrator unlocks it;
 * it never submits a draft and never demotes a submitted report. Unlocking
 * restores the lifecycle state the report was in before the lock: a draft
 * becomes a draft again, a submitted report stays submitted (keeping its
 * "edited after submission" mark when it has one). Submission happens only
 * through ReportSubmissionService::save(..., submit: true).
 */
class ReportLockingService
{
    public function __construct(
        private readonly DashboardAnalyticsService $dashboardAnalytics,
    ) {}

    /**
     * @throws AuthorizationException
     */
    public function setLockState(User $actor, Report $report, bool $locked): Report
    {
        if (! Permissions::isAdminRole($actor->role_key) || ! $actor->active) {
            throw new AuthorizationException('Admin privileges are required to change report locks.');
        }

        $lockedReport = DB::transaction(function () use ($actor, $report, $locked): Report {
            $lockedReport = Report::query()
                ->whereKey($report->id)
                ->lockForUpdate()
                ->firstOrFail();
            $lockedReport->loadMissing(['assignment', 'department']);

            if ($locked && $lockedReport->locked_at !== null) {
                return $lockedReport;
            }

            if (! $locked && $lockedReport->locked_at === null) {
                return $lockedReport;
            }

            $now = now();

            if ($locked) {
                // Only the status string and the lock timestamp change:
                // submitted_at is left exactly as it is, so the pre-lock
                // lifecycle state survives the lock and can be restored.
                $lockedReport->forceFill([
                    'status' => 'locked',
                    'locked_at' => $now,
                    'updated_by' => $actor->id,
                    'updated_at' => $now,
                ])->save();

                $this->recordStatus($lockedReport, 'locked', $actor, 'Report locked after review.', $now);
                $this->notifyNurse(
                    $lockedReport,
                    'report_locked',
                    'Report locked',
                    sprintf('%s has been locked for review.', $lockedReport->department?->name ?? 'This report'),
                    'report_lock',
                    $now,
                );

                return $lockedReport->refresh();
            }

            $nextStatus = $this->restoredStatus($lockedReport);

            $lockedReport->forceFill([
                'status' => $nextStatus,
                'locked_at' => null,
                'updated_by' => $actor->id,
                'updated_at' => $now,
            ])->save();

            $this->recordStatus($lockedReport, $nextStatus, $actor, 'Report unlocked for correction.', $now);
            $this->notifyNurse(
                $lockedReport,
                'report_unlocked',
                'Report unlocked',
                sprintf('%s has been unlocked for correction.', $lockedReport->department?->name ?? 'This report'),
                'report_unlock',
                $now,
            );

            return $lockedReport->refresh();
        });

        $this->dashboardAnalytics->invalidate();

        return $lockedReport;
    }

    /**
     * The lifecycle state a locked report returns to when the lock is released.
     *
     * The pre-lock state is read from the same invariant the submission
     * workflow relies on ($hadSubmission in ReportSubmissionService::save):
     * submitted_at is written exactly once, by a real submission, and is never
     * cleared afterwards. A null submitted_at therefore means the report was
     * still a draft when it was locked, and unlocking must hand it back as a
     * draft rather than inventing a submission. A submitted report returns to
     * submitted, or to edited_after_submission when its history carries that
     * mark (ReportSubmissionService::nextStatus never drops it either).
     */
    private function restoredStatus(Report $report): string
    {
        if ($report->submitted_at === null) {
            return 'draft';
        }

        return $report->statusHistory()
            ->where('status', 'edited_after_submission')
            ->exists() ? 'edited_after_submission' : 'submitted';
    }

    private function recordStatus(Report $report, string $status, User $actor, string $note, mixed $changedAt): void
    {
        ReportStatusHistory::query()->create([
            'report_id' => $report->id,
            'status' => $status,
            'changed_by' => $actor->id,
            'changed_by_name' => $actor->full_name,
            'note' => $note,
            'changed_at' => $changedAt,
        ]);
    }

    private function notifyNurse(Report $report, string $type, string $title, string $message, string $entity, mixed $createdAt): void
    {
        Notification::query()->create([
            'recipient_id' => $report->assignment->nurse_id,
            'type' => $type,
            'title' => $title,
            'message' => $message,
            'related_route' => sprintf('/reports/%s/%s', $report->assignment_id, $report->reporting_period_id),
            'related_entity' => $entity,
            'related_id' => $report->id,
            'created_at' => $createdAt,
        ]);
    }
}
