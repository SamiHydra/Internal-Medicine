<?php

namespace App\Policies;

use App\Models\User;
use App\Policies\Concerns\HandlesDomainAuthorization;
use App\Support\Authorization\Permissions;

class UserPolicy
{
    use HandlesDomainAuthorization;

    public function viewAny(User $user): bool
    {
        return Permissions::userCan($user, Permissions::USERS_VIEW);
    }

    public function view(User $user, User $target): bool
    {
        return $user->id === $target->id || $this->isAdminLike($user);
    }

    public function create(User $user): bool
    {
        return Permissions::userCan($user, Permissions::USERS_MANAGE);
    }

    public function createAdmin(User $user): bool
    {
        return Permissions::userCan($user, Permissions::ADMINS_MANAGE);
    }

    public function update(User $user, User $target): bool
    {
        if ($user->id === $target->id) {
            return true;
        }

        if ($this->isSuperadmin($user)) {
            return true;
        }

        return $this->isAdminLike($user) && $target->role_key === 'nurse';
    }

    public function setActive(User $user, User $target): bool
    {
        if ($target->role_key === 'superadmin') {
            return false;
        }

        if (Permissions::isAdminRole($target->role_key)) {
            return $this->isSuperadmin($user);
        }

        return $this->isAdminLike($user);
    }

    public function delete(User $user, User $target): bool
    {
        return $this->setActive($user, $target);
    }
}
