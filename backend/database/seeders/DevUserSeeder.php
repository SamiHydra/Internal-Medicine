<?php

namespace Database\Seeders;

use App\Models\Department;
use App\Models\User;
use Illuminate\Database\Seeder;
use Illuminate\Support\Collection;

/**
 * Creates the LOCAL development workforce so a fresh database (migrate:fresh
 * --seed, a clean clone, or a wiped sqlite file) always yields working
 * credentials AND enough people for the dashboards to be exercised at a
 * realistic hospital scale.
 *
 * Headcount targets (see the TARGET_* constants): 30 nurses, 10 admins, plus
 * the named walkthrough identities. Residents and consultants are counted
 * here too but created by DevAcademicDataSeeder, which is the only place that
 * knows how to place them into a section roster.
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

    /** Total active nurses, including the two named walkthrough nurses below. */
    private const TARGET_NURSES = 30;

    /** Total admins. The superadmin ("Maintenance") is separate and not counted. */
    private const TARGET_ADMINS = 10;

    /**
     * Extra nurses filled in behind the two named walkthrough accounts, up to
     * TARGET_NURSES. Each yields <first>.<last>@stpaulhospital.demo.
     *
     * @var list<string>
     */
    private const NURSE_NAMES = [
        'Sara Tadesse', 'Yonas Kebede', 'Marta Hailu', 'Bethlehem Tesfaye',
        'Dawit Mekonnen', 'Selamawit Girma', 'Kalkidan Wolde', 'Eyob Assefa',
        'Liya Bekele', 'Naod Fikru', 'Tigist Alemu', 'Robel Desta',
        'Meron Tsegaye', 'Hewan Negash', 'Biruk Lemma', 'Saron Habte',
        'Nahom Getachew', 'Rahel Solomon', 'Fitsum Ayele', 'Genet Worku',
        'Helen Tamiru', 'Amanuel Birhanu', 'Lydia Demissie', 'Tewodros Kassa',
        'Eden Mulugeta', 'Kidist Bogale', 'Yeshi Terefe', 'Mikiyas Shiferaw',
    ];

    /**
     * Administrative doctors. Each yields admin.<first>.<last>@stpaulos.local
     * so an admin login can never be confused with a clinical one.
     *
     * @var list<string>
     */
    private const ADMIN_NAMES = [
        'Alem Woldemariam', 'Tsehay Getahun', 'Bekele Terefe', 'Almaz Sahle',
        'Girma Woldu', 'Meseret Aklilu', 'Tadesse Belete', 'Hirut Zewde',
        'Mulugeta Shiferaw', 'Aster Fantahun',
    ];

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
            $this->ensureUser($account);
        }

        $this->seedNurseWorkforce();
        $this->seedAdminWorkforce();
        $this->seedAcademicAccounts();

        $this->command?->info(sprintf(
            'Dev users ready - login: admin@stpaulos.local / %s (superadmin), plus %d nurses and %d admins.',
            self::DEV_PASSWORD,
            User::query()->where('role_key', 'nurse')->where('active', true)->count(),
            User::query()->where('role_key', 'admin')->where('active', true)->count(),
        ));
    }

    /**
     * Top the ward-reporting workforce up to TARGET_NURSES. The two named
     * walkthrough nurses already exist, so only the shortfall is generated.
     */
    private function seedNurseWorkforce(): void
    {
        $existing = User::query()->where('role_key', 'nurse')->count();
        $shortfall = self::TARGET_NURSES - $existing;

        for ($i = 0; $i < $shortfall && $i < count(self::NURSE_NAMES); $i++) {
            $name = self::NURSE_NAMES[$i];
            $handle = $this->handle($name);

            $this->ensureUser([
                'email' => $handle.'@stpaulhospital.demo',
                'username' => $handle,
                'full_name' => $name,
                'title' => 'Registered Nurse',
                'role_key' => 'nurse',
            ]);
        }
    }

    /** Ten administrative doctors, so admin-scoped screens have real breadth. */
    private function seedAdminWorkforce(): void
    {
        $existing = User::query()->where('role_key', 'admin')->count();
        $shortfall = self::TARGET_ADMINS - $existing;

        for ($i = 0; $i < $shortfall && $i < count(self::ADMIN_NAMES); $i++) {
            $name = self::ADMIN_NAMES[$i];
            $handle = 'admin.'.$this->handle($name);

            $this->ensureUser([
                'email' => $handle.'@stpaulos.local',
                'username' => $handle,
                'full_name' => 'Dr. '.$name,
                'title' => 'Admin',
                'role_key' => 'admin',
            ]);
        }
    }

    /**
     * Seed the documented academic walkthrough identities. The rest of the
     * academic workforce, and all operational academic history, belongs
     * exclusively to DevAcademicDataSeeder so every account is placed through
     * the same coherent roster and rotation plan.
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

    /** first.last, lowercased - the login handle convention used throughout. */
    private function handle(string $fullName): string
    {
        return strtolower(str_replace(' ', '.', $fullName));
    }

    /**
     * @param  array{email: string, username: string, full_name: string, title: string, role_key: string}  $account
     * @param  array<string, mixed>  $extra
     */
    private function ensureUser(array $account, array $extra = []): User
    {
        $user = User::firstOrCreate(
            ['email' => $account['email']],
            array_merge([
                'username' => $account['username'],
                'full_name' => $account['full_name'],
                'title' => $account['title'],
                'role_key' => $account['role_key'],
                'password' => self::DEV_PASSWORD,
                'active' => true,
                'password_change_required' => false,
            ], $extra),
        );

        if ($user->wasRecentlyCreated && $user->email_verified_at === null) {
            $user->forceFill(['email_verified_at' => now()])->save();
        }

        return $user;
    }

    /**
     * @param  array{email: string, username: string, full_name: string, home: string}  $account
     * @param  Collection<string, Department>  $wards
     */
    private function ensureAcademicUser(array $account, string $roleKey, string $title, Collection $wards): User
    {
        return $this->ensureUser(
            [
                'email' => $account['email'],
                'username' => $account['username'],
                'full_name' => $account['full_name'],
                'title' => $title,
                'role_key' => $roleKey,
            ],
            ['home_ward_id' => $wards[$account['home']]?->id],
        );
    }
}
