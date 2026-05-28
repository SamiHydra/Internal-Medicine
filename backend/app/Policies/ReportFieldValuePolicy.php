<?php

namespace App\Policies;

use App\Models\Report;
use App\Models\ReportFieldValue;
use App\Models\User;
use App\Policies\Concerns\HandlesDomainAuthorization;

class ReportFieldValuePolicy
{
    use HandlesDomainAuthorization;

    public function view(User $user, ReportFieldValue $fieldValue): bool
    {
        return $this->canViewAssignedReport($user, $fieldValue->report);
    }

    public function create(User $user, ?Report $report = null): bool
    {
        if ($report === null) {
            return $user->active;
        }

        return $this->canMutateAssignedUnlockedReport($user, $report);
    }

    public function update(User $user, ReportFieldValue $fieldValue): bool
    {
        return $this->canMutateAssignedUnlockedReport($user, $fieldValue->report);
    }

    public function delete(User $user, ReportFieldValue $fieldValue): bool
    {
        return $this->canMutateAssignedUnlockedReport($user, $fieldValue->report);
    }
}
