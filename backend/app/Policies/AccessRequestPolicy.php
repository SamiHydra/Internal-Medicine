<?php

namespace App\Policies;

use App\Models\AccessRequest;
use App\Models\User;
use App\Policies\Concerns\HandlesDomainAuthorization;

class AccessRequestPolicy
{
    use HandlesDomainAuthorization;

    public function viewAny(User $user): bool
    {
        return $this->isAdminLike($user);
    }

    public function view(User $user, AccessRequest $accessRequest): bool
    {
        return $this->isAdminLike($user) || $accessRequest->user_id === $user->id;
    }

    public function create(User $user): bool
    {
        return $user->active;
    }

    public function update(User $user, ?AccessRequest $accessRequest = null): bool
    {
        return $this->isAdminLike($user);
    }

    public function review(User $user, ?AccessRequest $accessRequest = null): bool
    {
        return $this->isAdminLike($user);
    }

    public function delete(User $user, ?AccessRequest $accessRequest = null): bool
    {
        return $this->isAdminLike($user);
    }
}
