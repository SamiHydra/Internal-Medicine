<?php

namespace App\Services\Academic;

use App\Models\DutyAssignment;
use App\Models\Notification;
use App\Models\Section;
use App\Models\TransferRequest;
use App\Models\User;
use App\Services\Admin\AdminAuditService;
use Carbon\CarbonInterface;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * Consultant section transfers. Approval authority is the head of the
 * destination section (or an admin); application happens at the next rotation
 * boundary by default, immediately on admin override. Applying a transfer is
 * the only place `users.section_id` changes through this workflow, and it
 * also closes the old section's open Ward Service assignment so the roster
 * stays truthful.
 */
final class TransferService
{
    public function __construct(
        private readonly RotationCalendarService $calendars,
        private readonly AdminAuditService $auditService,
    ) {}

    public function request(User $consultant, Section $toSection, ?string $reason): TransferRequest
    {
        if ($consultant->section_id === null) {
            throw ValidationException::withMessages([
                'toSectionId' => ['You need a current section before requesting a transfer. Contact an administrator.'],
            ]);
        }

        if ($consultant->section_id === $toSection->id) {
            throw ValidationException::withMessages([
                'toSectionId' => ['You already belong to this section.'],
            ]);
        }

        if (! $toSection->active) {
            throw ValidationException::withMessages([
                'toSectionId' => ['This section is not active.'],
            ]);
        }

        $hasPending = TransferRequest::query()
            ->where('user_id', $consultant->id)
            ->where('status', 'pending')
            ->exists();

        if ($hasPending) {
            throw ValidationException::withMessages([
                'toSectionId' => ['You already have a pending transfer request. Cancel it before filing a new one.'],
            ]);
        }

        $request = TransferRequest::query()->create([
            'user_id' => $consultant->id,
            'from_section_id' => $consultant->section_id,
            'to_section_id' => $toSection->id,
            'reason' => $reason,
        ]);

        if ($toSection->head_user_id !== null) {
            $this->notify(
                $toSection->head_user_id,
                'transfer_requested',
                'Section transfer request',
                sprintf('%s requested a transfer into %s.', $consultant->full_name, $toSection->name),
                $request->id,
            );
        }

        return $request->load(['fromSection', 'toSection']);
    }

    public function approve(TransferRequest $request, User $by, ?CarbonInterface $effectiveOn = null): TransferRequest
    {
        $effective = $effectiveOn ?? $this->calendars->nextBoundaryAfter(now());

        if ($effective->lessThan(now()->startOfDay())) {
            throw ValidationException::withMessages([
                'effectiveOn' => ['The effective date cannot be in the past.'],
            ]);
        }

        DB::transaction(function () use ($request, $by, $effective): void {
            $request->forceFill([
                'status' => 'approved',
                'decided_by' => $by->id,
                'decided_at' => now(),
                'effective_on' => $effective->toDateString(),
            ])->save();

            // Immediate override (admin picked today or earlier boundary).
            if ($effective->lessThanOrEqualTo(now()->startOfDay())) {
                $this->apply($request);
            }
        });

        $this->auditService->record($by, 'approve', 'transfer_request', $request->id, null, [
            'userId' => $request->user_id,
            'toSectionId' => $request->to_section_id,
            'effectiveOn' => $request->effective_on?->toDateString(),
        ]);

        $request->refresh();

        $this->notify(
            $request->user_id,
            'transfer_decided',
            'Transfer approved',
            sprintf(
                'Your transfer to %s was approved, effective %s.',
                $request->toSection?->name ?? 'the new section',
                $request->effective_on?->format('M j, Y') ?? 'immediately',
            ),
            $request->id,
        );

        return $request->load(['fromSection', 'toSection', 'decidedBy']);
    }

    public function reject(TransferRequest $request, User $by): TransferRequest
    {
        $request->forceFill([
            'status' => 'rejected',
            'decided_by' => $by->id,
            'decided_at' => now(),
        ])->save();

        $this->auditService->record($by, 'reject', 'transfer_request', $request->id, null, [
            'userId' => $request->user_id,
            'toSectionId' => $request->to_section_id,
        ]);

        $this->notify(
            $request->user_id,
            'transfer_decided',
            'Transfer request declined',
            sprintf('Your transfer request to %s was declined.', $request->toSection?->name ?? 'the section'),
            $request->id,
        );

        return $request->load(['fromSection', 'toSection', 'decidedBy']);
    }

    public function cancel(TransferRequest $request): TransferRequest
    {
        $request->forceFill([
            'status' => 'cancelled',
            'decided_at' => now(),
        ])->save();

        return $request->load(['fromSection', 'toSection']);
    }

    /**
     * Move the consultant: update the section, close the old section's open
     * Ward Service assignment the day before the effective date, stamp
     * applied_at, and notify everyone involved.
     */
    public function apply(TransferRequest $request): void
    {
        DB::transaction(function () use ($request): void {
            $consultant = $request->user()->lockForUpdate()->firstOrFail();
            $effective = $request->effective_on ?? now();

            $consultant->forceFill(['section_id' => $request->to_section_id])->save();

            // Close (or drop) the old section's ward-service months that reach
            // into the transfer window so the roster never shows the consultant
            // serving a section they left.
            $openAssignments = DutyAssignment::query()
                ->where('user_id', $consultant->id)
                ->whereDate('ends_on', '>=', $effective->toDateString())
                ->whereHas('dutyType', fn (Builder $query) => $query
                    ->where('section_id', $request->from_section_id)
                    ->where('category', 'ward_service'))
                ->get();

            foreach ($openAssignments as $assignment) {
                $lastDay = $effective->copy()->subDay();

                if ($assignment->starts_on->greaterThan($lastDay)) {
                    $assignment->delete();
                } else {
                    $assignment->forceFill(['ends_on' => $lastDay->toDateString()])->save();
                }
            }

            $request->forceFill(['applied_at' => now()])->save();
        });

        $request->refresh()->load(['fromSection', 'toSection', 'user']);

        $decider = $request->decidedBy ?? $request->user;

        if ($decider !== null) {
            $this->auditService->record($decider, 'apply', 'transfer_request', $request->id, null, [
                'userId' => $request->user_id,
                'fromSectionId' => $request->from_section_id,
                'toSectionId' => $request->to_section_id,
            ]);
        }

        $recipients = array_filter(array_unique([
            $request->user_id,
            $request->fromSection?->head_user_id,
            $request->toSection?->head_user_id,
        ]));

        foreach ($recipients as $recipientId) {
            $this->notify(
                $recipientId,
                'transfer_applied',
                'Section transfer applied',
                sprintf(
                    '%s moved from %s to %s.',
                    $request->user?->full_name ?? 'A consultant',
                    $request->fromSection?->name ?? 'their section',
                    $request->toSection?->name ?? 'the new section',
                ),
                $request->id,
            );
        }
    }

    /** Apply every approved request whose effective date has arrived. Idempotent. */
    public function applyDue(): int
    {
        $due = TransferRequest::query()
            ->where('status', 'approved')
            ->whereNull('applied_at')
            ->whereDate('effective_on', '<=', now()->toDateString())
            ->get();

        foreach ($due as $request) {
            $this->apply($request);
        }

        return $due->count();
    }

    private function notify(string $recipientId, string $type, string $title, string $message, string $requestId): void
    {
        Notification::query()->create([
            'recipient_id' => $recipientId,
            'type' => $type,
            'title' => $title,
            'message' => $message,
            'related_route' => '/academic',
            'related_entity' => 'transfer_request',
            'related_id' => $requestId,
            'created_at' => now(),
        ]);
    }
}
