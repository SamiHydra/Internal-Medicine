<?php

namespace App\Policies;

use App\Models\AdminAccessRequest;
use App\Models\User;
use App\Policies\Concerns\HandlesDomainAuthorization;
use App\Support\Authorization\Permissions;

class AdminAccessRequestPolicy
{
    use HandlesDomainAuthorization;

    public function viewAny(User $user): bool
    {
        return Permissions::userCan($user, Permissions::ADMINS_APPROVE);
    }

    public function review(User $user, AdminAccessRequest $request): bool
    {
        return Permissions::userCan($user, Permissions::ADMINS_APPROVE);
    }
}
