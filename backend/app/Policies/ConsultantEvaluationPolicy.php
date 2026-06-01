<?php

namespace App\Policies;

use App\Models\ConsultantEvaluation;
use App\Models\User;
use App\Policies\Concerns\HandlesDomainAuthorization;

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

    public function create(User $user): bool
    {
        // The direction/role match (resident → consultant subject) is enforced
        // in the controller; here we only require an active account.
        return $user->active;
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
