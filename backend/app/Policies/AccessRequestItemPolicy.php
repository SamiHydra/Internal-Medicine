<?php

namespace App\Policies;

use App\Models\AccessRequestItem;
use App\Models\User;
use App\Policies\Concerns\HandlesDomainAuthorization;

class AccessRequestItemPolicy
{
    use HandlesDomainAuthorization;

    public function view(User $user, AccessRequestItem $item): bool
    {
        return $this->isAdminLike($user) || $item->accessRequest?->user_id === $user->id;
    }

    public function create(User $user): bool
    {
        return $user->active;
    }

    public function delete(User $user, AccessRequestItem $item): bool
    {
        return $this->isAdminLike($user) || $item->accessRequest?->user_id === $user->id;
    }
}
