<?php

namespace App\Policies;

use App\Models\User;
use App\Models\Ward;
use App\Policies\Concerns\HandlesDomainAuthorization;

class WardPolicy
{
    use HandlesDomainAuthorization;

    public function viewAny(User $user): bool
    {
        return $this->isAdminLike($user);
    }

    public function view(User $user, Ward $ward): bool
    {
        return $this->isAdminLike($user);
    }

    public function create(User $user): bool
    {
        return $this->isAdminLike($user);
    }

    public function update(User $user, ?Ward $ward = null): bool
    {
        return $this->isAdminLike($user);
    }

    public function delete(User $user, ?Ward $ward = null): bool
    {
        return $this->isAdminLike($user);
    }
}
