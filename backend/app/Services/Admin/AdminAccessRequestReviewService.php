<?php

namespace App\Services\Admin;

use App\Models\AdminAccessRequest;
use App\Models\Notification;
use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

class AdminAccessRequestReviewService
{
    public function __construct(
        private readonly AdminAuditService $auditService,
    ) {}

    public function review(User $actor, AdminAccessRequest $adminRequest, string $decision): AdminAccessRequest
    {
        $decision = strtolower(trim($decision));

        if (! in_array($decision, ['approved', 'rejected'], true)) {
            throw ValidationException::withMessages([
                'decision' => 'Admin request review must be approved or rejected.',
            ]);
        }

        return DB::transaction(function () use ($actor, $adminRequest, $decision): AdminAccessRequest {
            $locked = AdminAccessRequest::query()->lockForUpdate()->findOrFail($adminRequest->id);

            if ($locked->status !== 'pending') {
                throw ValidationException::withMessages([
                    'decision' => 'This admin request has already been reviewed.',
                ]);
            }

            $oldValues = $locked->only(['status', 'reviewed_at', 'reviewed_by', 'created_user_id']);

            if ($decision === 'approved') {
                $createdUser = $this->createAdminUser($locked);
                $locked->forceFill([
                    'status' => 'approved',
                    'reviewed_at' => now(),
                    'reviewed_by' => $actor->id,
                    'created_user_id' => $createdUser->id,
                ])->save();

                $this->notifyNewAdmin($actor, $createdUser);
            } else {
                $locked->forceFill([
                    'status' => 'rejected',
                    'reviewed_at' => now(),
                    'reviewed_by' => $actor->id,
                ])->save();
            }

            $this->auditService->record(
                $actor,
                $decision === 'approved' ? 'approve_admin_request' : 'reject_admin_request',
                'admin_access_request',
                $locked->id,
                $oldValues,
                $locked->fresh()->only(['status', 'reviewed_at', 'reviewed_by', 'created_user_id']),
                request(),
            );

            return $locked->refresh()->load(['reviewer', 'createdUser']);
        });
    }

    private function createAdminUser(AdminAccessRequest $adminRequest): User
    {
        $email = strtolower(trim($adminRequest->email));

        if (User::query()->whereRaw('lower(email) = ?', [$email])->exists()) {
            throw ValidationException::withMessages([
                'email' => 'An account with this email already exists; cannot approve.',
            ]);
        }

        $user = User::query()->create([
            'full_name' => $adminRequest->full_name,
            'email' => $email,
            'username' => null,
            // The stored value is already a bcrypt hash; the User "hashed" cast
            // detects this and keeps it as-is rather than re-hashing.
            'password' => $adminRequest->password,
            'role_key' => 'admin',
            'title' => 'Administrator',
            'active' => true,
            'password_change_required' => false,
        ]);
        $user->forceFill(['email_verified_at' => now()])->save();

        return $user;
    }

    private function notifyNewAdmin(User $actor, User $newAdmin): void
    {
        Notification::query()->create([
            'recipient_id' => $newAdmin->id,
            'type' => 'admin_access_request_reviewed',
            'title' => 'Admin access approved',
            'message' => sprintf('%s approved your admin account. You can now sign in.', $actor->full_name),
            'related_route' => '/admin',
            // related_id is the new admin's USER id, so the entity must be 'user'
            // (not 'admin_access_request') to keep the (entity, id) pair consistent.
            'related_entity' => 'user',
            'related_id' => $newAdmin->id,
            'created_at' => now(),
        ]);
    }
}
