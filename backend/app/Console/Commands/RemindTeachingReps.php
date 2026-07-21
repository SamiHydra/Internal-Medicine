<?php

namespace App\Console\Commands;

use App\Models\Notification;
use App\Models\RepAssignment;
use App\Models\TeachingSession;
use App\Support\HospitalClock;
use Illuminate\Console\Command;

class RemindTeachingReps extends Command
{
    protected $signature = 'academic:remind-reps';

    protected $description = 'End-of-day nudge: notify each rep about today\'s teaching sessions still pending in their scope.';

    public function handle(): int
    {
        $today = HospitalClock::today();
        $pendingToday = TeachingSession::query()
            ->whereDate('scheduled_date', $today->toDateString())
            ->where('status', 'pending')
            ->get();

        if ($pendingToday->isEmpty()) {
            $this->info('Rep reminders sent: 0.');

            return self::SUCCESS;
        }

        $reps = RepAssignment::query()
            ->where('active', true)
            ->whereIn('batch_id', $pendingToday->pluck('batch_id')->unique())
            ->get();

        $notified = 0;

        foreach ($reps as $rep) {
            $inScope = $pendingToday
                ->where('batch_id', $rep->batch_id)
                ->filter(fn (TeachingSession $session) => in_array($session->activity_type, $rep->recordableActivities(), true)
                    && ($rep->scope === 'group' || $rep->subgroup() === $session->subgroup));

            if ($inScope->isEmpty()) {
                continue;
            }

            Notification::query()->create([
                'recipient_id' => $rep->user_id,
                'type' => 'teaching_log_reminder',
                'title' => 'Teaching activities not logged yet',
                'message' => sprintf(
                    '%d of today\'s scheduled activities in your scope %s not been recorded as held or not held.',
                    $inScope->count(),
                    $inScope->count() === 1 ? 'has' : 'have',
                ),
                'related_route' => '/teaching',
                'related_entity' => 'teaching_session',
                'related_id' => $inScope->first()->id,
                'created_at' => now(),
            ]);
            $notified++;
        }

        $this->info(sprintf('Rep reminders sent: %d.', $notified));

        return self::SUCCESS;
    }
}
