<?php

namespace App\Policies;

use App\Models\ReportAssignment;
use App\Models\User;
use App\Policies\Concerns\HandlesDomainAuthorization;

class ReportAssignmentPolicy
{
    use HandlesDomainAuthorization;

    public function viewAny(User $user): bool
    {
        return $this->isAdminLike($user);
    }

    public function view(User $user, ReportAssignment $assignment): bool
    {
        return $this->isAdminLike($user) || $this->ownsAssignment($user, $assignment);
    }

    public function create(User $user): bool
    {
        return $this->isAdminLike($user);
    }

    public function update(User $user, ?ReportAssignment $assignment = null): bool
    {
        return $this->isAdminLike($user);
    }

    public function delete(User $user, ?ReportAssignment $assignment = null): bool
    {
        return $this->isAdminLike($user);
    }
}
