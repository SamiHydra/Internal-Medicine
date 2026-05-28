<?php

namespace App\Policies;

use App\Models\CalculatedMetric;
use App\Models\User;
use App\Policies\Concerns\HandlesDomainAuthorization;

class CalculatedMetricPolicy
{
    use HandlesDomainAuthorization;

    public function view(User $user, CalculatedMetric $metric): bool
    {
        return $this->canViewAssignedReport($user, $metric->report);
    }

    public function create(User $user): bool
    {
        return $this->isAdminLike($user);
    }

    public function update(User $user, ?CalculatedMetric $metric = null): bool
    {
        return $this->isAdminLike($user);
    }

    public function delete(User $user, ?CalculatedMetric $metric = null): bool
    {
        return $this->isAdminLike($user);
    }
}
