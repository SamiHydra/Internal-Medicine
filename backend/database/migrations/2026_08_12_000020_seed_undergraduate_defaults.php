<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

return new class extends Migration
{
    /**
     * Data migration: the student_rep role and the weekly activity programs
     * named by the client (V2 guide 1.6). Lectures and seminars are cohort
     * scope (recorded by the group rep); bedside and teaching rounds are
     * subgroup scope (recorded by the subgroup reps). Idempotent.
     */
    public function up(): void
    {
        $now = now();

        if (! DB::table('roles')->where('role_key', 'student_rep')->exists()) {
            DB::table('roles')->insert([
                'role_key' => 'student_rep',
                'label' => 'Student representative',
                'description' => 'Records whether scheduled teaching activities were held. No access to any evaluation, assessment, or score.',
                'created_at' => $now,
                'updated_at' => $now,
            ]);
        }

        // [cohort, activity_type, weekdays (1 = Monday), scope]
        $programs = [
            ['C1', 'lecture', [1, 2, 3, 4, 5], 'cohort'],
            ['C1', 'teaching_round', [2, 4], 'subgroup'],
            ['C1', 'bedside', [1, 5], 'subgroup'],
            ['C1', 'seminar', [3], 'cohort'],
            ['C2', 'lecture', [5], 'cohort'],
            ['C2', 'teaching_round', [2, 4], 'subgroup'],
            ['C2', 'bedside', [1, 3], 'subgroup'],
            ['C2', 'seminar', [5], 'cohort'],
        ];

        foreach ($programs as [$cohort, $activityType, $weekdays, $scope]) {
            foreach ($weekdays as $weekday) {
                $exists = DB::table('teaching_activity_schedules')
                    ->where('cohort', $cohort)
                    ->where('activity_type', $activityType)
                    ->where('weekday', $weekday)
                    ->exists();

                if ($exists) {
                    continue;
                }

                DB::table('teaching_activity_schedules')->insert([
                    'id' => (string) Str::uuid(),
                    'cohort' => $cohort,
                    'activity_type' => $activityType,
                    'weekday' => $weekday,
                    'scope' => $scope,
                    'active' => true,
                    'created_at' => $now,
                    'updated_at' => $now,
                ]);
            }
        }
    }

    public function down(): void
    {
        DB::table('teaching_activity_schedules')->delete();
        DB::table('roles')->where('role_key', 'student_rep')->delete();
    }
};
