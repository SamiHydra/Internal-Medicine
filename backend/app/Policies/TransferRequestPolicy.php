<?php

namespace App\Policies;

use App\Models\Section;
use App\Models\TransferRequest;
use App\Models\User;
use App\Policies\Concerns\HandlesDomainAuthorization;

class TransferRequestPolicy
{
    use HandlesDomainAuthorization;

    public function viewAny(User $user): bool
    {
        // Admins see everything; a consultant sees the review queue only when
        // they head at least one section (narrowed per-row by decide()).
        return $this->isAdminLike($user) || $this->headsAnySection($user);
    }

    public function view(User $user, TransferRequest $request): bool
    {
        return $this->isAdminLike($user)
            || $request->user_id === $user->id
            || $this->headsSection($user, $request->to_section_id)
            || $this->headsSection($user, $request->from_section_id);
    }

    public function create(User $user): bool
    {
        return $user->active && $user->role_key === 'consultant';
    }

    /**
     * The data-driven designation rule: approval authority sits with the head
     * of the DESTINATION section (they accept the member), or an admin. There
     * is deliberately no "section head" role.
     */
    public function decide(User $user, TransferRequest $request): bool
    {
        if (! $user->active || ! $request->isPending()) {
            return false;
        }

        return $this->isAdminLike($user) || $this->headsSection($user, $request->to_section_id);
    }

    public function cancel(User $user, TransferRequest $request): bool
    {
        return $user->active && $request->user_id === $user->id && $request->isPending();
    }

    private function headsSection(User $user, string $sectionId): bool
    {
        return Section::query()
            ->where('id', $sectionId)
            ->where('head_user_id', $user->id)
            ->exists();
    }

    private function headsAnySection(User $user): bool
    {
        return Section::query()->where('head_user_id', $user->id)->exists();
    }
}
