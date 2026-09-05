<?php

namespace App\Policies;

use App\Models\ClinicalAlertRule;
use App\Models\User;
use App\Support\Authorization\Permissions;

class ClinicalAlertRulePolicy
{
    public function viewAny(User $user): bool
    {
        return Permissions::userCan($user, Permissions::ACTION_ITEMS_VIEW);
    }

    public function create(User $user): bool
    {
        return Permissions::userCan($user, Permissions::ACTION_ITEMS_MANAGE);
    }

    public function update(User $user, ClinicalAlertRule $rule): bool
    {
        return $this->create($user);
    }

    public function delete(User $user, ClinicalAlertRule $rule): bool
    {
        return $this->create($user);
    }
}
