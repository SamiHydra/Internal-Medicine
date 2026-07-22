<?php

namespace App\Policies\Concerns;

use App\Models\Report;
use App\Models\ReportAssignment;
use App\Models\User;
use App\Support\Authorization\Permissions;

trait HandlesDomainAuthorization
{
    protected function isAdminLike(User $user): bool
    {
        return $user->active && Permissions::isAdminRole($user->role_key);
    }

    protected function isSuperadmin(User $user): bool
    {
        return $user->active && Permissions::isSuperadmin($user->role_key);
    }

    protected function ownsAssignment(User $user, ReportAssignment $assignment): bool
    {
        return $user->active
            && $assignment->active
            && $assignment->nurse_id === $user->id;
    }

    protected function canViewAssignedReport(User $user, Report $report): bool
    {
        if (! $user->active) {
            return false;
        }

        if ($this->isAdminLike($user)) {
            return true;
        }

        return $report->assignment()
            ->where('nurse_id', $user->id)
            ->where('active', true)
            ->exists();
    }

    protected function canMutateAssignedUnlockedReport(User $user, Report $report): bool
    {
        if (! $this->canViewAssignedReport($user, $report)) {
            return false;
        }

        return $this->isAdminLike($user) || ! $report->isLocked();
    }
}
