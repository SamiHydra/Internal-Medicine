<?php

namespace App\Policies;

use App\Models\User;
use App\Policies\Concerns\HandlesDomainAuthorization;

/**
 * Audit rows are append-only. No role, the maintenance owner included, may
 * change or remove one through the application; the only designed deletion
 * path is the retention prune command, gated by config('reports.retention').
 */
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
