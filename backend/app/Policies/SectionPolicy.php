<?php

namespace App\Policies;

use App\Models\Section;
use App\Models\User;
use App\Policies\Concerns\HandlesDomainAuthorization;

class SectionPolicy
{
    use HandlesDomainAuthorization;

    public function viewAny(User $user): bool
    {
        return $this->isAdminLike($user);
    }

    public function view(User $user, Section $section): bool
    {
        return $this->isAdminLike($user);
    }

    public function create(User $user): bool
    {
        return $this->isAdminLike($user);
    }

    public function update(User $user, ?Section $section = null): bool
    {
        return $this->isAdminLike($user);
    }

    public function delete(User $user, ?Section $section = null): bool
    {
        return $this->isAdminLike($user);
    }
}
