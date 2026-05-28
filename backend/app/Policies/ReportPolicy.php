<?php

namespace App\Policies;

use App\Models\Report;
use App\Models\ReportAssignment;
use App\Models\User;
use App\Policies\Concerns\HandlesDomainAuthorization;

class ReportPolicy
{
    use HandlesDomainAuthorization;

    public function viewAny(User $user): bool
    {
        return $this->isAdminLike($user);
    }

    public function view(User $user, Report $report): bool
    {
        return $this->canViewAssignedReport($user, $report);
    }

    public function create(User $user, ?ReportAssignment $assignment = null): bool
    {
        if ($this->isAdminLike($user)) {
            return true;
        }

        return $assignment !== null && $this->ownsAssignment($user, $assignment);
    }

    public function update(User $user, Report $report): bool
    {
        return $this->canMutateAssignedUnlockedReport($user, $report);
    }

    public function submit(User $user, Report $report): bool
    {
        return $this->canMutateAssignedUnlockedReport($user, $report);
    }

    public function lock(User $user, ?Report $report = null): bool
    {
        return $this->isAdminLike($user);
    }

    public function unlock(User $user, ?Report $report = null): bool
    {
        return $this->isAdminLike($user);
    }

    public function delete(User $user, ?Report $report = null): bool
    {
        return $this->isAdminLike($user);
    }
}
