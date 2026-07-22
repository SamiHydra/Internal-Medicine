<?php

namespace App\Policies;

use App\Models\ResidentEvaluation;
use App\Models\User;
use App\Policies\Concerns\HandlesDomainAuthorization;
use App\Services\Academic\RosterService;
use Illuminate\Support\Carbon;

class ResidentEvaluationPolicy
{
    use HandlesDomainAuthorization;

    public function viewAny(User $user): bool
    {
        return $this->isAdminLike($user);
    }

    public function view(User $user, ResidentEvaluation $evaluation): bool
    {
        return $this->isAdminLike($user)
            || $evaluation->author_id === $user->id
            || $evaluation->subject_id === $user->id;
    }

    /**
     * With a subject and date the Gate mirrors the controller's pairing rule
     * (authorization in depth); without them it only requires an active
     * account. The direction/role match is enforced in the controller.
     */
    public function create(User $user, ?User $subject = null, ?string $date = null): bool
    {
        if (! $user->active) {
            return false;
        }

        if ($subject === null || $date === null) {
            return true;
        }

        return app(RosterService::class)->canPair($user, $subject, Carbon::parse($date));
    }

    /** Externally-sourced paper evaluations are typed in by admins. */
    public function createExternal(User $user): bool
    {
        return $this->isAdminLike($user);
    }

    public function update(User $user, ?ResidentEvaluation $evaluation = null): bool
    {
        return $this->isAdminLike($user);
    }

    public function delete(User $user, ?ResidentEvaluation $evaluation = null): bool
    {
        return $this->isAdminLike($user);
    }
}
