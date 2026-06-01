<?php

namespace App\Policies;

use App\Models\ResidentEvaluation;
use App\Models\User;
use App\Policies\Concerns\HandlesDomainAuthorization;

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

    public function create(User $user): bool
    {
        // The direction/role match (consultant → resident subject) is enforced
        // in the controller; here we only require an active account.
        return $user->active;
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
