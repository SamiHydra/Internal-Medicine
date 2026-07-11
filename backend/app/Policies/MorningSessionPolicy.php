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

    public function manage(User $user, ?MorningSession $session = null): bool
    {
        return $this->isAdminLike($user);
    }
}
