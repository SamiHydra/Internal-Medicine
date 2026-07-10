<?php

namespace App\Policies;

use App\Models\ConsultantEvaluation;
use App\Models\User;
use App\Policies\Concerns\HandlesDomainAuthorization;
use App\Services\Academic\RosterService;
use Illuminate\Support\Carbon;

class ConsultantEvaluationPolicy
{
    use HandlesDomainAuthorization;

    public function viewAny(User $user): bool
    {
        return $this->isAdminLike($user);
    }

    public function view(User $user, ConsultantEvaluation $evaluation): bool
    {
        return $this->isAdminLike($user)
            || $evaluation->author_id === $user->id
            || $evaluation->subject_id === $user->id;
    }

    /**
     * With a subject and date the Gate mirrors the controller's pairing rule
     * (authorization in depth); without them it only requires an active
     * account (form-options and listing calls). The direction/role match is
     * enforced in the controller.
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

    public function update(User $user, ?ConsultantEvaluation $evaluation = null): bool
    {
        return $this->isAdminLike($user);
    }

    public function delete(User $user, ?ConsultantEvaluation $evaluation = null): bool
    {
        return $this->isAdminLike($user);
    }
}
