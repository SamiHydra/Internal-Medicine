<?php

namespace App\Policies;

use App\Models\ActionItem;
use App\Models\User;
use App\Support\Authorization\Permissions;

class ActionItemPolicy
{
    public function viewAny(User $user): bool
    {
        return Permissions::userCan($user, Permissions::ACTION_ITEMS_VIEW);
    }

    public function view(User $user, ActionItem $item): bool
    {
        return $this->viewAny($user);
    }

    public function create(User $user): bool
    {
        return Permissions::userCan($user, Permissions::ACTION_ITEMS_MANAGE);
    }

    public function update(User $user, ActionItem $item): bool
    {
        return $this->create($user);
    }
}
