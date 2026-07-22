<?php

namespace App\Policies;

use App\Models\User;
use App\Policies\Concerns\HandlesDomainAuthorization;

class AppSettingPolicy
{
    use HandlesDomainAuthorization;

    public function viewAny(User $user): bool
    {
        return $user->active;
    }

    public function view(User $user, mixed $setting = null): bool
    {
        return $user->active;
    }

    public function update(User $user, mixed $setting = null): bool
    {
        return $this->isAdminLike($user);
    }
}
