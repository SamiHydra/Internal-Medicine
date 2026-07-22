<?php

namespace App\Policies;

use App\Models\RotationCalendar;
use App\Models\User;
use App\Policies\Concerns\HandlesDomainAuthorization;

class RotationCalendarPolicy
{
    use HandlesDomainAuthorization;

    public function viewAny(User $user): bool
    {
        return $this->isAdminLike($user);
    }

    public function view(User $user, RotationCalendar $calendar): bool
    {
        return $this->isAdminLike($user);
    }

    public function create(User $user): bool
    {
        return $this->isAdminLike($user);
    }

    public function update(User $user, ?RotationCalendar $calendar = null): bool
    {
        return $this->isAdminLike($user);
    }

    public function delete(User $user, ?RotationCalendar $calendar = null): bool
    {
        return $this->isAdminLike($user);
    }
}
