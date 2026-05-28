<?php

namespace App\Policies;

use App\Models\Notification;
use App\Models\User;
use App\Policies\Concerns\HandlesDomainAuthorization;

class NotificationPolicy
{
    use HandlesDomainAuthorization;

    public function viewAny(User $user): bool
    {
        return $user->active;
    }

    public function view(User $user, Notification $notification): bool
    {
        return $this->isAdminLike($user) || $notification->recipient_id === $user->id;
    }

    public function create(User $user): bool
    {
        return $this->isAdminLike($user);
    }

    public function update(User $user, Notification $notification): bool
    {
        return $this->isAdminLike($user) || $notification->recipient_id === $user->id;
    }

    public function delete(User $user, Notification $notification): bool
    {
        return $this->isAdminLike($user) || $notification->recipient_id === $user->id;
    }
}
