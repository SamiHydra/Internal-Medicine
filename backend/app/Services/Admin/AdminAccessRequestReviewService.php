<?php

namespace App\Services\Admin;

use App\Models\AdminAccessRequest;
use App\Models\Notification;
use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * The single place a self-service account request turns into a real account.
 * The queue is named after its original admin-only purpose but now carries
 * academic enrollments too, so the created role comes from requested_role.
 */
class AdminAccessRequestReviewService
{
    /**
     * Roles an approval may create. The maintenance owner (superadmin) is
     * absent on purpose: it must stay uncreatable through any app flow.
     *
     * @var array<string, string>
     */
    private const CREATABLE_ROLE_TITLES = [
        'admin' => 'Administrator',
        'consultant' => 'Consultant',
        'resident' => 'Resident',
    ];

    public function __construct(
        private readonly AdminAuditService $auditService,
    ) {}

    public function review(User $actor, AdminAccessRequest $adminRequest, string $decision): AdminAccessRequest
    {
        $decision = strtolower(trim($decision));

        if (! in_array($decision, ['approved', 'rejected'], true)) {
            throw ValidationException::withMessages([
                'decision' => 'Account request review must be approved or rejected.',
            ]);
        }

        return DB::transaction(function () use ($actor, $adminRequest, $decision): AdminAccessRequest {
            $locked = AdminAccessRequest::query()->lockForUpdate()->findOrFail($adminRequest->id);

            if ($locked->status !== 'pending') {
                throw ValidationException::withMessages([
                    'decision' => 'This account request has already been reviewed.',
                ]);
            }

            $oldValues = $locked->only(['status', 'reviewed_at', 'reviewed_by', 'created_user_id']);

            if ($decision === 'approved') {
                $createdUser = $this->createRequestedUser($locked);
                $locked->forceFill([
                    'status' => 'approved',
                    'reviewed_at' => now(),
                    'reviewed_by' => $actor->id,
                    'created_user_id' => $createdUser->id,
                ])->save();

                $this->notifyNewAccount($actor, $createdUser);
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

    private function createRequestedUser(AdminAccessRequest $adminRequest): User
    {
        $roleKey = $adminRequest->requested_role;

        // requested_role is the only privilege input on the row, and the column
        // defaults to 'admin', so an unrecognised value must abort the approval
        // rather than fall back to anything.
        if (! array_key_exists($roleKey, self::CREATABLE_ROLE_TITLES)) {
            throw ValidationException::withMessages([
                'decision' => 'This request asks for a role that cannot be created; reject it instead.',
            ]);
        }

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
            'role_key' => $roleKey,
            'title' => self::CREATABLE_ROLE_TITLES[$roleKey],
            'home_ward_id' => $adminRequest->home_ward_id,
            'active' => true,
            // The applicant chose this password at signup, so do not force a change.
            'password_change_required' => false,
        ]);
        $user->forceFill(['email_verified_at' => now()])->save();

        return $user;
    }

    private function notifyNewAccount(User $actor, User $newUser): void
    {
        $isAdmin = $newUser->role_key === 'admin';

        Notification::query()->create([
            'recipient_id' => $newUser->id,
            'type' => 'admin_access_request_reviewed',
            'title' => $isAdmin ? 'Admin access approved' : 'Account approved',
            'message' => sprintf('%s approved your %s account. You can now sign in.', $actor->full_name, $newUser->role_key),
            // Send each role where it actually lands (src/routes/landing.ts).
            'related_route' => $isAdmin ? '/admin' : '/academic',
            // related_id is the new user's USER id, so the entity must be 'user'
            // (not 'admin_access_request') to keep the (entity, id) pair consistent.
            'related_entity' => 'user',
            'related_id' => $newUser->id,
            'created_at' => now(),
        ]);
    }
}
