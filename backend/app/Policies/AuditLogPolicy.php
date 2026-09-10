<?php

namespace App\Policies;

use App\Models\User;
use App\Policies\Concerns\HandlesDomainAuthorization;

/**
 * The per-cell edit trail is append-only: see AdminAuditLogPolicy.
 */
class AuditLogPolicy
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

    public function update(User $user, mixed $auditLog = null): bool
    {
        return false;
    }

    public function delete(User $user, mixed $auditLog = null): bool
    {
        return false;
    }

    public function forceDelete(User $user, mixed $auditLog = null): bool
    {
        return false;
    }
}
