<?php

namespace App\Policies;

use App\Models\DutyAssignment;
use App\Models\User;
use App\Policies\Concerns\HandlesDomainAuthorization;

class DutyAssignmentPolicy
{
    use HandlesDomainAuthorization;

    public function viewAny(User $user): bool
    {
        return $this->isAdminLike($user);
    }

    public function view(User $user, DutyAssignment $assignment): bool
    {
        // People may always see their own placements (the academic home page
        // shows the current one); managing anyone's is admin work.
        return $this->isAdminLike($user) || $assignment->user_id === $user->id;
    }

    public function create(User $user): bool
    {
        return $this->isAdminLike($user);
    }

    public function update(User $user, ?DutyAssignment $assignment = null): bool
    {
        return $this->isAdminLike($user);
    }

    public function delete(User $user, ?DutyAssignment $assignment = null): bool
    {
        return $this->isAdminLike($user);
    }
}
