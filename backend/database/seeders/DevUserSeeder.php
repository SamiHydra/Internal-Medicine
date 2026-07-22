<?php

namespace Database\Seeders;

use App\Models\Department;
use App\Models\User;
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

        $this->seedAcademicAccounts();

        $this->command?->info('Dev users ready - login: admin@stpaulos.local / '.self::DEV_PASSWORD.' (superadmin), plus nurses, residents and consultants.');
    }

    /**
     * Seed the documented academic walkthrough identities. Operational academic
     * history belongs exclusively to DevAcademicDataSeeder so every account is
     * placed through the same coherent roster and rotation plan.
     */
    private function seedAcademicAccounts(): void
    {
        $wards = Department::query()
            ->whereIn('slug', ['gi_neuro_inpatient', 'cardiac_inpatient', 'nephrology_inpatient'])
            ->where('active', true)
            ->get()
            ->keyBy('slug');

        if ($wards->isEmpty()) {
            return;
        }

        foreach ([
            ['email' => 'rediet.bekele@stpaulhospital.demo', 'username' => 'rediet.bekele', 'full_name' => 'Dr. Rediet Bekele', 'home' => 'gi_neuro_inpatient'],
            ['email' => 'samuel.alemu@stpaulhospital.demo', 'username' => 'samuel.alemu', 'full_name' => 'Dr. Samuel Alemu', 'home' => 'cardiac_inpatient'],
        ] as $account) {
            $this->ensureAcademicUser($account, 'resident', 'Resident', $wards);
        }

        foreach ([
            ['email' => 'chaltu.tesfaye@stpaulhospital.demo', 'username' => 'chaltu.tesfaye', 'full_name' => 'Dr. Chaltu Tesfaye', 'home' => 'gi_neuro_inpatient'],
            ['email' => 'mesfin.girma@stpaulhospital.demo', 'username' => 'mesfin.girma', 'full_name' => 'Dr. Mesfin Girma', 'home' => 'cardiac_inpatient'],
        ] as $account) {
            $this->ensureAcademicUser($account, 'consultant', 'Consultant', $wards);
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
