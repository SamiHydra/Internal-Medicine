<?php

namespace App\Services\Academic;

use App\Models\DutyAssignment;
use App\Models\Notification;
use App\Models\Section;
use App\Models\TransferRequest;
use App\Models\User;
use App\Services\Admin\AdminAuditService;
use App\Support\HospitalClock;
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
        $requestId = DB::transaction(function () use ($consultant, $toSection, $reason): string {
            // The consultant is the stable serialization row for request
            // creation. It closes the empty-result race in the pending query.
            $lockedConsultant = User::query()->lockForUpdate()->findOrFail($consultant->id);
            $lockedDestination = Section::query()->lockForUpdate()->findOrFail($toSection->id);

            if ($lockedConsultant->section_id === null) {
                throw ValidationException::withMessages([
                    'toSectionId' => ['You need a current section before requesting a transfer. Contact an administrator.'],
                ]);
            }

            if ($lockedConsultant->section_id === $lockedDestination->id) {
                throw ValidationException::withMessages([
                    'toSectionId' => ['You already belong to this section.'],
                ]);
            }

            if (! $lockedDestination->active) {
                throw ValidationException::withMessages([
                    'toSectionId' => ['This section is not active.'],
                ]);
            }

            $hasPending = TransferRequest::query()
                ->where('user_id', $lockedConsultant->id)
                ->where('status', 'pending')
                ->exists();

            if ($hasPending) {
                throw ValidationException::withMessages([
                    'toSectionId' => ['You already have a pending transfer request. Cancel it before filing a new one.'],
                ]);
            }

            $request = TransferRequest::query()->create([
                'user_id' => $lockedConsultant->id,
                'from_section_id' => $lockedConsultant->section_id,
                'to_section_id' => $lockedDestination->id,
                'reason' => $reason,
            ]);

            // Approve/reject/apply were audited but the request itself was not,
            // so an approved transfer had no record of when it was asked for.
            $this->auditService->record($lockedConsultant, 'request', 'transfer_request', $request->id, null, [
                'userId' => $lockedConsultant->id,
                'fromSectionId' => $lockedConsultant->section_id,
                'toSectionId' => $lockedDestination->id,
            ]);

            if ($lockedDestination->head_user_id !== null) {
                $this->notify(
                    $lockedDestination->head_user_id,
                    'transfer_requested',
                    'Section transfer request',
                    sprintf('%s requested a transfer into %s.', $lockedConsultant->full_name, $lockedDestination->name),
                    $request->id,
                );
            }

            return $request->id;
        });

        return TransferRequest::query()->with(['fromSection', 'toSection'])->findOrFail($requestId);
    }

    public function approve(TransferRequest $request, User $by, ?CarbonInterface $effectiveOn = null): TransferRequest
    {
        $effective = $effectiveOn ?? $this->calendars->nextBoundaryAfter(HospitalClock::today());
        $today = HospitalClock::today()->toDateString();

        DB::transaction(function () use ($request, $by, $effective, $today): void {
            $locked = $this->lockRequest($request->id);

            if ($locked->status === 'approved') {
                return;
            }

            $this->assertPending($locked, 'approved');

            if ($effective->toDateString() < $today) {
                throw ValidationException::withMessages([
                    'effectiveOn' => ['The effective date cannot be in the past.'],
                ]);
            }

            $locked->forceFill([
                'status' => 'approved',
                'decided_by' => $by->id,
                'decided_at' => now(),
                'effective_on' => $effective->toDateString(),
            ])->save();

            $this->auditService->record($by, 'approve', 'transfer_request', $locked->id, null, [
                'userId' => $locked->user_id,
                'toSectionId' => $locked->to_section_id,
                'effectiveOn' => $locked->effective_on?->toDateString(),
            ]);

            $this->notify(
                $locked->user_id,
                'transfer_decided',
                'Transfer approved',
                sprintf(
                    'Your transfer to %s was approved, effective %s.',
                    $locked->toSection()->value('name') ?? 'the new section',
                    $locked->effective_on?->format('M j, Y') ?? 'immediately',
                ),
                $locked->id,
            );

            // Immediate override (admin picked today or earlier boundary).
            if ($effective->toDateString() <= $today) {
                $this->applyLocked($locked, $by);
            }
        });

        return TransferRequest::query()->with(['fromSection', 'toSection', 'decidedBy'])->findOrFail($request->id);
    }

    public function reject(TransferRequest $request, User $by): TransferRequest
    {
        DB::transaction(function () use ($request, $by): void {
            $locked = $this->lockRequest($request->id);

            if ($locked->status === 'rejected') {
                return;
            }

            $this->assertPending($locked, 'rejected');

            $locked->forceFill([
                'status' => 'rejected',
                'decided_by' => $by->id,
                'decided_at' => now(),
            ])->save();

            $this->auditService->record($by, 'reject', 'transfer_request', $locked->id, null, [
                'userId' => $locked->user_id,
                'toSectionId' => $locked->to_section_id,
            ]);

            $this->notify(
                $locked->user_id,
                'transfer_decided',
                'Transfer request declined',
                sprintf('Your transfer request to %s was declined.', $locked->toSection()->value('name') ?? 'the section'),
                $locked->id,
            );
        });

        return TransferRequest::query()->with(['fromSection', 'toSection', 'decidedBy'])->findOrFail($request->id);
    }

    public function cancel(TransferRequest $request, User $by): TransferRequest
    {
        DB::transaction(function () use ($request, $by): void {
            $locked = $this->lockRequest($request->id);

            if ($locked->status === 'cancelled') {
                return;
            }

            $this->assertPending($locked, 'cancelled');

            $locked->forceFill([
                'status' => 'cancelled',
                'decided_at' => now(),
            ])->save();

            // Inside the early-return guard, so a retried cancel writes one row.
            $this->auditService->record($by, 'cancel', 'transfer_request', $locked->id, null, [
                'userId' => $locked->user_id,
                'toSectionId' => $locked->to_section_id,
            ]);
        });

        return TransferRequest::query()->with(['fromSection', 'toSection'])->findOrFail($request->id);
    }

    /**
     * Move the consultant: update the section, close the old section's open
     * Ward Service assignment the day before the effective date, stamp
     * applied_at, and notify everyone involved.
     */
    public function apply(TransferRequest $request): bool
    {
        return DB::transaction(function () use ($request): bool {
            $locked = $this->lockRequest($request->id);

            return $this->applyLocked($locked);
        });
    }

    /** Apply every approved request whose effective date has arrived. Idempotent. */
    public function applyDue(?CarbonInterface $asOf = null): int
    {
        $asOf ??= HospitalClock::today();

        $due = TransferRequest::query()
            ->where('status', 'approved')
            ->whereNull('applied_at')
            ->whereDate('effective_on', '<=', $asOf->toDateString())
            ->get();

        return $due->sum(fn (TransferRequest $request): int => $this->apply($request) ? 1 : 0);
    }

    private function lockRequest(string $requestId): TransferRequest
    {
        return TransferRequest::query()->lockForUpdate()->findOrFail($requestId);
    }

    private function assertPending(TransferRequest $request, string $action): void
    {
        if ($request->status === 'pending') {
            return;
        }

        throw ValidationException::withMessages([
            'request' => [sprintf('This transfer request can no longer be %s.', $action)],
        ]);
    }

    /**
     * Apply an already row-locked request. Returning false is the idempotent
     * path: another worker completed the same request while this caller was
     * waiting. All durable side effects share the state-change transaction.
     */
    private function applyLocked(TransferRequest $request, ?User $actor = null): bool
    {
        if ($request->applied_at !== null) {
            return false;
        }

        if ($request->status !== 'approved') {
            throw ValidationException::withMessages([
                'request' => ['Only an approved transfer request can be applied.'],
            ]);
        }

        $effective = $request->effective_on ?? HospitalClock::today();

        if ($effective->toDateString() > HospitalClock::today()->toDateString()) {
            return false;
        }

        $consultant = User::query()->lockForUpdate()->findOrFail($request->user_id);
        $consultant->forceFill(['section_id' => $request->to_section_id])->save();

        // Lock the assignment rows as well: roster editing serializes on the
        // same consultant row, while this lock protects direct legacy writes.
        $openAssignments = DutyAssignment::query()
            ->where('user_id', $consultant->id)
            ->whereDate('ends_on', '>=', $effective->toDateString())
            ->whereHas('dutyType', fn (Builder $query) => $query
                ->where('section_id', $request->from_section_id)
                ->where('category', 'ward_service'))
            ->lockForUpdate()
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
        $request->load(['fromSection', 'toSection']);

        $auditActor = $actor
            ?? ($request->decided_by !== null ? User::query()->find($request->decided_by) : null)
            ?? $consultant;

        $this->auditService->record($auditActor, 'apply', 'transfer_request', $request->id, null, [
            'userId' => $request->user_id,
            'fromSectionId' => $request->from_section_id,
            'toSectionId' => $request->to_section_id,
        ]);

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
                    $consultant->full_name,
                    $request->fromSection?->name ?? 'their section',
                    $request->toSection?->name ?? 'the new section',
                ),
                $request->id,
            );
        }

        return true;
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
