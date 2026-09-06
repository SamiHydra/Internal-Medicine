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

    /**
     * An assignment row on its own never grants clinical access: the account
     * must ALSO currently hold the reporting permission. Otherwise an account
     * moved off the nurse role (student representative, academic role) keeps
     * reading and writing ward reports through the rows it left behind.
     */
    protected function ownsAssignment(User $user, ReportAssignment $assignment): bool
    {
        return $user->active
            && Permissions::userCan($user, Permissions::REPORTS_SUBMIT)
            && Permissions::userCan($user, Permissions::REPORTS_VIEW_ASSIGNED)
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

        if (! Permissions::userCan($user, Permissions::REPORTS_VIEW_ASSIGNED)) {
            return false;
        }

        return $report->assignment()
            ->where('nurse_id', $user->id)
            ->where('active', true)
            ->exists();
    }

    /**
     * Locked reports are read-only for everyone, administrators included: an
     * administrator unlocks first, then edits. The policy and the submission
     * service now state the same rule instead of contradicting each other.
     */
    protected function canMutateAssignedUnlockedReport(User $user, Report $report): bool
    {
        if (! $this->canViewAssignedReport($user, $report)) {
            return false;
        }

        if ($report->isLocked()) {
            return false;
        }

        return $this->isAdminLike($user)
            || Permissions::userCan($user, Permissions::REPORTS_SUBMIT);
    }
}
