<?php

namespace App\Policies;

use App\Models\User;
use App\Policies\Concerns\HandlesDomainAuthorization;

class AdminAuditLogPolicy
{
    use HandlesDomainAuthorization;

    public function viewAny(User $user): bool
    {
        return $this->isAdminLike($user);
    }

    public function view(User $user, mixed $auditLog = null): bool
    {
        return $this->isAdminLike($user);
    }

    public function create(User $user, mixed $auditLog = null): bool
    {
        return $this->isAdminLike($user);
    }
}
