<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

return new class extends Migration
{
    private const BACKFILL_NOTE = 'Backfilled from home ward';

    /**
     * Data migration: existing residents and consultants must keep working on
     * day one, so each one with a resolvable home ward gets a Ward Service
     * assignment for the current calendar month. Users without a resolvable
     * ward are deliberately left unassigned (no guessing); they surface in the
     * admin setup banner via `academicSetup.peopleWithoutAssignment`.
     */
    public function up(): void
    {
        $users = DB::table('users')
            ->whereIn('role_key', ['resident', 'consultant'])
            ->where('active', true)
            ->whereNotNull('home_ward_id')
            ->get(['id', 'home_ward_id']);

        if ($users->isEmpty()) {
            return;
        }

        $wardIdByDepartment = DB::table('departments')
            ->whereNotNull('ward_id')
            ->pluck('ward_id', 'id');

        // First monthly Ward Service duty type per ward. Two sections can share
        // a ward; either section's ward service yields the same pairing key, so
        // the first one is fine for a backfill.
        $wardServiceByWard = DB::table('duty_types')
            ->where('category', 'ward_service')
            ->where('granularity', 'monthly')
            ->whereNotNull('ward_id')
            ->orderBy('slug')
            ->get(['id', 'ward_id'])
            ->unique('ward_id')
            ->pluck('id', 'ward_id');

        $actorId = DB::table('users')
            ->whereIn('role_key', ['superadmin', 'admin'])
            ->orderBy('created_at')
            ->value('id');

        $now = now();
        $monthStart = $now->copy()->startOfMonth()->toDateString();
        $monthEnd = $now->copy()->endOfMonth()->toDateString();

        foreach ($users as $user) {
            $wardId = $wardIdByDepartment[$user->home_ward_id] ?? null;
            $dutyTypeId = $wardId ? ($wardServiceByWard[$wardId] ?? null) : null;

            if ($dutyTypeId === null) {
                continue;
            }

            $alreadyCovered = DB::table('duty_assignments')
                ->where('user_id', $user->id)
                ->where('starts_on', '<=', $now->toDateString())
                ->where('ends_on', '>=', $now->toDateString())
                ->exists();

            if ($alreadyCovered) {
                continue;
            }

            DB::table('duty_assignments')->insert([
                'id' => (string) Str::uuid(),
                'user_id' => $user->id,
                'duty_type_id' => $dutyTypeId,
                'starts_on' => $monthStart,
                'ends_on' => $monthEnd,
                'source' => 'admin',
                'created_by' => $actorId ?? $user->id,
                'note' => self::BACKFILL_NOTE,
                'created_at' => $now,
                'updated_at' => $now,
            ]);
        }
    }

    public function down(): void
    {
        DB::table('duty_assignments')->where('note', self::BACKFILL_NOTE)->delete();
    }
};
