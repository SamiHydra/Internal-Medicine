<?php

namespace App\Console\Commands;

use App\Models\Notification;
use App\Models\StudentBatch;
use App\Models\SubgroupPlacement;
use App\Models\User;
use Illuminate\Console\Command;

class CheckSubgroupPlacements extends Command
{
    protected $signature = 'academic:check-placements';

    protected $description = 'Friday check: alert admins when a subgroup has no ward placement for the coming week.';

    public function handle(): int
    {
        $nextMonday = now()->next('Monday');

        $gaps = [];

        $batches = StudentBatch::query()
            ->where('active', true)
            ->whereDate('starts_on', '<=', $nextMonday->toDateString())
            ->whereDate('ends_on', '>=', $nextMonday->toDateString())
            ->get();

        foreach ($batches as $batch) {
            foreach (['A', 'B'] as $subgroup) {
                $placed = SubgroupPlacement::query()
                    ->where('batch_id', $batch->id)
                    ->where('subgroup', $subgroup)
                    ->whereDate('week_starts_on', '<=', $nextMonday->toDateString())
                    ->whereDate('week_ends_on', '>=', $nextMonday->toDateString())
                    ->exists();

                if (! $placed) {
                    $gaps[] = sprintf('%s subgroup %s', $batch->label, $subgroup);
                }
            }
        }

        if ($gaps === []) {
            $this->info('Placement check: every subgroup is placed for next week.');

            return self::SUCCESS;
        }

        $admins = User::query()
            ->whereIn('role_key', ['admin', 'superadmin'])
            ->where('active', true)
            ->get();

        foreach ($admins as $admin) {
            Notification::query()->create([
                'recipient_id' => $admin->id,
                'type' => 'placement_gap',
                'title' => 'Subgroups without a ward next week',
                'message' => sprintf(
                    'No ward placement for the week of %s: %s. Place them on the Students page.',
                    $nextMonday->format('M j'),
                    implode('; ', $gaps),
                ),
                'related_route' => '/admin/academic/students',
                'related_entity' => 'subgroup_placement',
                'related_id' => null,
                'created_at' => now(),
            ]);
        }

        $this->info(sprintf('Placement gaps found: %d; admins notified: %d.', count($gaps), $admins->count()));

        return self::SUCCESS;
    }
}
