<?php

namespace App\Policies;

use App\Models\User;
use App\Policies\Concerns\HandlesDomainAuthorization;

class RolePolicy
{
    use HandlesDomainAuthorization;

    public function viewAny(User $user): bool
    {
        return $user->active;
    }

    public function view(User $user, mixed $role = null): bool
    {
        return $user->active;
    }

    public function create(User $user): bool
    {
        return $this->isSuperadmin($user);
    }

    public function update(User $user, mixed $role = null): bool
    {
        return $this->isSuperadmin($user);
    }

    public function delete(User $user, mixed $role = null): bool
    {
        return $this->isSuperadmin($user);
    }
}
