<?php

namespace App\Services\Reports;

use App\Models\Notification;
use App\Models\Report;
use App\Models\ReportStatusHistory;
use App\Models\User;
use App\Support\Authorization\Permissions;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Support\Facades\DB;

class ReportLockingService
{
    /**
     * @throws AuthorizationException
     */
    public function setLockState(User $actor, Report $report, bool $locked): Report
    {
        if (! Permissions::isAdminRole($actor->role_key) || ! $actor->active) {
            throw new AuthorizationException('Admin privileges are required to change report locks.');
        }

        return DB::transaction(function () use ($actor, $report, $locked): Report {
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

            $nextStatus = $lockedReport->statusHistory()
                ->where('status', 'edited_after_submission')
                ->exists() ? 'edited_after_submission' : 'submitted';

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
