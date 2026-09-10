<?php

declare(strict_types=1);

/**
 * Tops the parity database up to N distinct accounts so a capacity stage can
 * give every virtual user its own session (docs/CAPACITY_TEST_REPORT.md). The
 * seeded fixture holds about 190 people, which is the department's real
 * headcount; stages above that need synthetic accounts.
 *
 * Run inside the parity app container:
 *   docker compose exec -T app php /opt/imreport/current/scripts/capacity/seed-load-accounts.php 320
 *
 * The accounts are read-only participants: role `nurse` or `admin`, no report
 * assignments, marked with the LOAD_ prefix in their full name so they are
 * obvious in any listing. They exist only in the disposable parity database.
 */

require __DIR__.'/../../backend/vendor/autoload.php';

$app = require_once __DIR__.'/../../backend/bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;

if (app()->environment('production') && ! getenv('CAPACITY_ALLOW_PRODUCTION')) {
    // The parity stack runs APP_ENV=production on purpose, so this is an
    // explicit opt-in rather than a hard block: never run it on a real host.
    fwrite(STDERR, "Refusing to seed load accounts: set CAPACITY_ALLOW_PRODUCTION=1 only on a disposable stack.\n");
    exit(1);
}

$target = (int) ($argv[1] ?? 320);
$password = getenv('LOAD_SEED_PASSWORD') ?: 'StPaul2026!';
$existing = (int) DB::table('users')->where('active', true)->where('password_change_required', false)->count();
$needed = max(0, $target - $existing);

if ($needed === 0) {
    echo "Already {$existing} usable accounts; nothing to seed.\n";
    exit(0);
}

$hash = Hash::make($password);
$now = now();
$rows = [];

for ($index = 1; $index <= $needed; $index++) {
    $number = str_pad((string) $index, 4, '0', STR_PAD_LEFT);
    // One admin per three accounts, matching the audit harness's account model.
    $role = $index % 3 === 1 ? 'admin' : 'nurse';

    $rows[] = [
        'id' => (string) Str::uuid(),
        'email' => "load.{$number}@stpaulos.local",
        'username' => "load.{$number}",
        'password' => $hash,
        'full_name' => "LOAD_ Capacity User {$number}",
        'title' => $role === 'admin' ? 'Capacity Administrator' : 'Capacity Nurse',
        'role_key' => $role,
        'active' => true,
        'email_verified_at' => $now,
        'password_change_required' => false,
        'created_at' => $now,
        'updated_at' => $now,
    ];
}

foreach (array_chunk($rows, 100) as $chunk) {
    DB::table('users')->upsert(
        $chunk,
        ['email'],
        ['username', 'password', 'full_name', 'title', 'role_key', 'active',
            'email_verified_at', 'password_change_required', 'updated_at'],
    );
}

echo "Seeded {$needed} capacity accounts (total usable: ".($existing + $needed).").\n";
