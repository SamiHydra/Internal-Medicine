<?php

namespace Database\Seeders;

use App\Models\Department;
use App\Models\Evaluation;
use App\Models\User;
use App\Models\Ward;
use App\Services\Academic\EvaluationFormService;
use Illuminate\Database\Seeder;
use Illuminate\Support\Collection;

/**
 * Creates known, reproducible login accounts for LOCAL development so a fresh
 * database (migrate:fresh --seed, a clean clone, or a wiped sqlite file) always
 * yields working credentials. Without this, the seeders provision all reference
 * data but no users, leaving a fully-seeded app that nobody can log into.
 *
 * SAFETY: this never runs in production or testing. Production must create its
 * real superadmin via `php artisan app:create-superadmin` (no default password
 * is ever seeded into a real deployment).
 *
 * Idempotent: firstOrCreate keyed on email, so re-seeding never duplicates or
 * clobbers an account whose password was deliberately changed.
 */
class DevUserSeeder extends Seeder
{
    /** Shared password for every local dev account. */
    private const DEV_PASSWORD = 'StPaul2026!';

    public function run(): void
    {
        if (app()->environment('production', 'testing')) {
            return;
        }

        $accounts = [
            [
                'email' => 'admin@stpaulos.local',
                'username' => 'admin1',
                'full_name' => 'St Paul Admin',
                'title' => 'Maintenance',
                'role_key' => 'superadmin',
            ],
            [
                'email' => 'abel.gemechu@stpaulhospital.demo',
                'username' => 'abel.gemechu',
                'full_name' => 'Abel Gemechu',
                'title' => 'Registered Nurse',
                'role_key' => 'nurse',
            ],
            [
                'email' => 'hana.abera@stpaulhospital.demo',
                'username' => 'hana.abera',
                'full_name' => 'Hana Abera',
                'title' => 'Registered Nurse',
                'role_key' => 'nurse',
            ],
        ];

        foreach ($accounts as $account) {
            $user = User::firstOrCreate(
                ['email' => $account['email']],
                [
                    'username' => $account['username'],
                    'full_name' => $account['full_name'],
                    'title' => $account['title'],
                    'role_key' => $account['role_key'],
                    'password' => self::DEV_PASSWORD,
                    'active' => true,
                    'password_change_required' => false,
                ],
            );

            if ($user->wasRecentlyCreated && $user->email_verified_at === null) {
                $user->forceFill(['email_verified_at' => now()])->save();
            }
        }

        $this->seedAcademicData();

        $this->command?->info('Dev users ready - login: admin@stpaulos.local / '.self::DEV_PASSWORD.' (superadmin), plus nurses, residents and consultants.');
    }

    /**
     * Seed residents, consultants (with a home ward) and a spread of evaluations
     * across a few wards over the last ~8 weeks, with realistic variation so the
     * academic trend and Pareto charts render with real shape.
     */
    private function seedAcademicData(): void
    {
        $wards = Department::query()
            ->whereIn('slug', ['gi_neuro_inpatient', 'cardiac_inpatient', 'nephrology_inpatient'])
            ->where('active', true)
            ->get()
            ->keyBy('slug');

        if ($wards->isEmpty()) {
            return;
        }

        $residents = collect([
            ['email' => 'rediet.bekele@stpaulhospital.demo', 'username' => 'rediet.bekele', 'full_name' => 'Dr. Rediet Bekele', 'home' => 'gi_neuro_inpatient'],
            ['email' => 'samuel.alemu@stpaulhospital.demo', 'username' => 'samuel.alemu', 'full_name' => 'Dr. Samuel Alemu', 'home' => 'cardiac_inpatient'],
        ])->map(fn (array $account) => $this->ensureAcademicUser($account, 'resident', 'Resident', $wards));

        $consultants = collect([
            ['email' => 'chaltu.tesfaye@stpaulhospital.demo', 'username' => 'chaltu.tesfaye', 'full_name' => 'Dr. Chaltu Tesfaye', 'home' => 'gi_neuro_inpatient'],
            ['email' => 'mesfin.girma@stpaulhospital.demo', 'username' => 'mesfin.girma', 'full_name' => 'Dr. Mesfin Girma', 'home' => 'cardiac_inpatient'],
        ])->map(fn (array $account) => $this->ensureAcademicUser($account, 'consultant', 'Consultant', $wards));

        // Only seed evaluations once, so re-running never piles up duplicates.
        // Post-Phase-4 these go through the form engine into the unified
        // tables; the legacy evaluation tables are read-only.
        if (Evaluation::query()->exists()) {
            return;
        }

        $forms = app(EvaluationFormService::class);
        $mdtForm = $forms->published('consultant_mdt');
        $acgmeForm = $forms->published('resident_acgme');
        $teachingWards = Ward::query()->where('active', true)->get();

        $mdtPool = ['consultant', 'fellow', 'internist', 'residents', 'interns', 'nurse', 'clinical_pharmacy'];
        $issuePool = ['lab_delay', 'imaging_delay', 'staff_shortage', 'bed_issue', 'emr_interruption', 'communication_issue'];
        $concernPool = ['punctuality', 'preparation', 'medical_knowledge', 'clinical_reasoning', 'documentation', 'communication', 'professionalism', 'follow_through', 'time_management'];

        $chance = static fn (int $pct): bool => random_int(1, 100) <= $pct;
        $sample = static function (array $pool, int $max): array {
            shuffle($pool);

            return array_values(array_slice($pool, 0, random_int(0, $max)));
        };

        // Residents evaluating consultants (the MDT round form).
        for ($i = 0; $i < 32; $i++) {
            $forms->store($mdtForm, [
                'senior_present' => $chance(90),
                'senior_joined_at' => sprintf('%02d:%02d', random_int(7, 9), [0, 15, 30, 45][random_int(0, 3)]),
                'presence_minutes' => random_int(20, 75),
                'all_patients_reviewed' => $chance(85),
                'mgmt_plan_documented' => $chance(78),
                'vte_assessed' => $chance(68),
                'discharge_discussed' => $chance(60),
                'med_review_done' => $chance(82),
                'critical_labs_reviewed' => $chance(74),
                'pct_patients_seen' => random_int(60, 100),
                'round_delayed' => $chance(25),
                'mdt_participants' => $sample($mdtPool, 5),
                'system_issues' => $sample($issuePool, 3),
            ], [
                'author_id' => $residents->random()->id,
                'subject_user_id' => $consultants->random()->id,
                'evaluation_date' => now()->subDays(random_int(0, 56))->toDateString(),
                'ward_id' => $teachingWards->random()->id,
                'placement_type' => 'ward',
            ]);
        }

        // Consultants evaluating residents.
        for ($i = 0; $i < 22; $i++) {
            $forms->store($acgmeForm, [
                'on_time' => $chance(88),
                'prepared' => $chance(80),
                'presentation_clear' => $chance(75),
                'clinical_reasoning' => $chance(72),
                'management_plan' => $chance(70),
                'documentation_timely' => $chance(66),
                'communication' => $chance(82),
                'professional' => $chance(90),
                'responsive_feedback' => $chance(78),
                'follow_through' => $chance(64),
                'overall_rating' => random_int(2, 5),
                'concerns' => $sample($concernPool, 3),
            ], [
                'author_id' => $consultants->random()->id,
                'subject_user_id' => $residents->random()->id,
                'evaluation_date' => now()->subDays(random_int(0, 56))->toDateString(),
                'ward_id' => $teachingWards->random()->id,
                'placement_type' => 'ward',
            ]);
        }
    }

    /**
     * @param  array{email: string, username: string, full_name: string, home: string}  $account
     * @param  Collection<string, Department>  $wards
     */
    private function ensureAcademicUser(array $account, string $roleKey, string $title, Collection $wards): User
    {
        $user = User::firstOrCreate(
            ['email' => $account['email']],
            [
                'username' => $account['username'],
                'full_name' => $account['full_name'],
                'title' => $title,
                'role_key' => $roleKey,
                'home_ward_id' => $wards[$account['home']]?->id,
                'password' => self::DEV_PASSWORD,
                'active' => true,
                'password_change_required' => false,
            ],
        );

        if ($user->wasRecentlyCreated && $user->email_verified_at === null) {
            $user->forceFill(['email_verified_at' => now()])->save();
        }

        return $user;
    }
}
