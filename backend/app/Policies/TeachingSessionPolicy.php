<?php

namespace App\Policies;

use App\Models\RepAssignment;
use App\Models\TeachingSession;
use App\Models\User;
use App\Policies\Concerns\HandlesDomainAuthorization;

class TeachingSessionPolicy
{
    use HandlesDomainAuthorization;

    public function viewAny(User $user): bool
    {
        return $this->isAdminLike($user);
    }

    /**
     * The data-driven rep rule (V2 guide 8.1): an admin may record anything;
     * a rep needs an ACTIVE assignment for the session's batch whose scope
     * covers the activity: `group` records lectures and seminars for the
     * whole cohort; `subgroup_a`/`subgroup_b` record bedside and teaching
     * rounds ONLY for their own subgroup.
     */
    public function record(User $user, TeachingSession $session): bool
    {
        if (! $user->active) {
            return false;
        }

        if ($this->isAdminLike($user)) {
            return true;
        }

        return RepAssignment::query()
            ->where('user_id', $user->id)
            ->where('batch_id', $session->batch_id)
            ->where('active', true)
            ->get()
            ->contains(function (RepAssignment $assignment) use ($session) {
                if (! in_array($session->activity_type, $assignment->recordableActivities(), true)) {
                    return false;
                }

                return $assignment->scope === 'group' || $assignment->subgroup() === $session->subgroup;
            });
    }

    /** Attendance is recorded by the consultant who taught, or an admin. */
    public function recordAttendance(User $user, TeachingSession $session): bool
    {
        return $user->active && ($this->isAdminLike($user) || $user->role_key === 'consultant');
    }
}
