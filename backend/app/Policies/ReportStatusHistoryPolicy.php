<?php

namespace App\Policies;

use App\Models\ReportStatusHistory;
use App\Models\User;
use App\Policies\Concerns\HandlesDomainAuthorization;

/**
 * Status history is append-only: see AdminAuditLogPolicy.
 */
class ReportStatusHistoryPolicy
{
    use HandlesDomainAuthorization;

    public function view(User $user, ReportStatusHistory $history): bool
    {
        return $this->canViewAssignedReport($user, $history->report);
    }

    public function create(User $user, mixed $report = null): bool
    {
        return $user->active;
    }

    public function update(User $user, mixed $history = null): bool
    {
        return false;
    }

    public function delete(User $user, mixed $history = null): bool
    {
        return false;
    }

    public function forceDelete(User $user, mixed $history = null): bool
    {
        return false;
    }
}
