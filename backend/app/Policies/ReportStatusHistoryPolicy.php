<?php

namespace App\Policies;

use App\Models\ReportStatusHistory;
use App\Models\User;
use App\Policies\Concerns\HandlesDomainAuthorization;

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
}
