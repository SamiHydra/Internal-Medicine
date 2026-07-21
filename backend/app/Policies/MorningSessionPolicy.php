<?php

namespace App\Policies;

use App\Models\MorningSession;
use App\Models\User;
use App\Policies\Concerns\HandlesDomainAuthorization;
use App\Services\Academic\MorningSessionService;

class MorningSessionPolicy
{
    use HandlesDomainAuthorization;

    public function viewAny(User $user): bool
    {
        return $this->isAdminLike($user);
    }

    /**
     * Residents and consultants may read today's session summary so the shared
     * academic route can explain who is allowed to record it. The controller
     * includes the expected-person roster only for designated recorders/admins.
     */
    public function viewToday(User $user): bool
    {
        return $user->active
            && ($this->isAdminLike($user) || in_array($user->role_key, ['resident', 'consultant'], true));
    }

    /**
     * The data-driven designation (V2 guide 9.1): recording belongs to the
     * users listed in the academic.morning_recorder_ids setting, or an admin.
     * Recorders may correct the SAME DAY only; after that, admin only.
     */
    public function record(User $user, MorningSession $session): bool
    {
        if (! $user->active) {
            return false;
        }

        if ($this->isAdminLike($user)) {
            return true;
        }

        if (! app(MorningSessionService::class)->isRecorder($user)) {
            return false;
        }

        return $session->session_date?->isToday() ?? false;
    }

    /**
     * A designated recorder may cancel only today's still-pending session.
     * Administrators retain the broader correction and cancellation ability.
     */
    public function cancel(User $user, MorningSession $session): bool
    {
        if (! $user->active) {
            return false;
        }

        if ($this->isAdminLike($user)) {
            return true;
        }

        return $session->status === 'pending'
            && ($session->session_date?->isToday() ?? false)
            && app(MorningSessionService::class)->isRecorder($user);
    }

    public function manage(User $user, ?MorningSession $session = null): bool
    {
        return $this->isAdminLike($user);
    }
}
