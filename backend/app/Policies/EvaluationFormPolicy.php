<?php

namespace App\Policies;

use App\Models\EvaluationForm;
use App\Models\User;
use App\Policies\Concerns\HandlesDomainAuthorization;

class EvaluationFormPolicy
{
    use HandlesDomainAuthorization;

    public function viewAny(User $user): bool
    {
        return $this->isAdminLike($user);
    }

    public function view(User $user, EvaluationForm $form): bool
    {
        return $this->isAdminLike($user);
    }

    /** Safe content edits (labels, help text, order, option wording) apply in place. */
    public function editContent(User $user, ?EvaluationForm $form = null): bool
    {
        return $this->isAdminLike($user);
    }

    /** Structural edits (add/remove field, change key or type) force a new version. */
    public function editStructure(User $user, ?EvaluationForm $form = null): bool
    {
        return $this->isSuperadmin($user);
    }
}
