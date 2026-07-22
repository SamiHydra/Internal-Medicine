<?php

namespace App\Policies;

use App\Models\DutyType;
use App\Models\User;
use App\Policies\Concerns\HandlesDomainAuthorization;

class DutyTypePolicy
{
    use HandlesDomainAuthorization;

    public function viewAny(User $user): bool
    {
        return $this->isAdminLike($user);
    }

    public function view(User $user, DutyType $dutyType): bool
    {
        return $this->isAdminLike($user);
    }

    public function create(User $user): bool
    {
        return $this->isAdminLike($user);
    }

    public function update(User $user, ?DutyType $dutyType = null): bool
    {
        return $this->isAdminLike($user);
    }

    public function delete(User $user, ?DutyType $dutyType = null): bool
    {
        return $this->isAdminLike($user);
    }
}
