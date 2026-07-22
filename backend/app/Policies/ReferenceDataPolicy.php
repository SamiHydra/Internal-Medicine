<?php

namespace App\Policies;

use App\Models\User;
use App\Policies\Concerns\HandlesDomainAuthorization;

class ReferenceDataPolicy
{
    use HandlesDomainAuthorization;

    public function viewAny(User $user): bool
    {
        return $user->active;
    }

    public function view(User $user, mixed $model = null): bool
    {
        return $user->active;
    }

    public function create(User $user): bool
    {
        return $this->isAdminLike($user);
    }

    public function update(User $user, mixed $model = null): bool
    {
        return $this->isAdminLike($user);
    }

    public function delete(User $user, mixed $model = null): bool
    {
        return $this->isAdminLike($user);
    }
}
