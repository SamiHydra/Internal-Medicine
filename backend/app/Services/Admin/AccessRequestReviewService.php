<?php

namespace App\Services\Admin;

use App\Models\AccessRequest;
use App\Models\Notification;
use App\Models\ReportAssignment;
use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

class AccessRequestReviewService
{
    public function __construct(
        private readonly AdminAuditService $auditService,
    ) {}

    public function review(User $actor, AccessRequest $accessRequest, string $decision): AccessRequest
    {
        $decision = strtolower(trim($decision));

        if (! in_array($decision, ['approved', 'rejected'], true)) {
            throw ValidationException::withMessages([
                'decision' => 'Access request review must be approved or rejected.',
            ]);
        }

        return DB::transaction(function () use ($actor, $accessRequest, $decision): AccessRequest {
            $lockedRequest = AccessRequest::query()
                ->with(['user', 'items.department', 'items.template'])
                ->lockForUpdate()
                ->findOrFail($accessRequest->id);
            $oldValues = $lockedRequest->only(['status', 'reviewed_at', 'reviewed_by']);

            $lockedRequest->forceFill([
                'status' => $decision,
                'reviewed_at' => now(),
                'reviewed_by' => $actor->id,
            ])->save();

            if ($decision === 'approved') {
                foreach ($lockedRequest->items as $item) {
                    ReportAssignment::query()->updateOrCreate(
                        [
                            'nurse_id' => $lockedRequest->user_id,
                            'department_id' => $item->department_id,
                            'template_id' => $item->template_id,
                        ],
                        [
                            'active' => true,
                            'approved_at' => now(),
                            'approved_by' => $actor->id,
                        ],
                    );
                }
            }

            $this->notifyRequester($actor, $lockedRequest, $decision);
            $this->auditService->record(
                $actor,
                'review',
                'access_request',
                $lockedRequest->id,
                $oldValues,
                $lockedRequest->fresh()->only(['status', 'reviewed_at', 'reviewed_by']),
                request(),
            );

            return $lockedRequest->refresh()->load(['user', 'reviewer', 'items.department', 'items.template']);
        });
    }

    private function notifyRequester(User $actor, AccessRequest $accessRequest, string $decision): void
    {
        Notification::query()->create([
            'recipient_id' => $accessRequest->user_id,
            'type' => 'access_request_reviewed',
            'title' => $decision === 'approved' ? 'Access approved' : 'Access request reviewed',
            'message' => $decision === 'approved'
                ? sprintf('%s approved your requested reporting access.', $actor->full_name)
                : sprintf('%s reviewed your access request. Please contact administration for follow-up.', $actor->full_name),
            'related_route' => $decision === 'approved' ? '/nurse/reports' : '/register',
            'related_entity' => 'access_request',
            'related_id' => $accessRequest->id,
            'created_at' => now(),
        ]);
    }
}
