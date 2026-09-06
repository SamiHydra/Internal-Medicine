<?php

declare(strict_types=1);

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;

require '/audit/bootstrap.php';

$password = 'AuditLoad2026!';
$passwordHash = Hash::make($password);
$now = now();
$rows = [];
$credentials = [];
$accountCount = 800;
$roleCounts = ['admin' => 0, 'nurse' => 0];

for ($index = 1; $index <= $accountCount; $index++) {
    $number = str_pad((string) $index, 4, '0', STR_PAD_LEFT);
    $email = "audit.load.{$number}@stpaulos.local";
    $role = $index % 3 === 1 ? 'admin' : 'nurse';
    $roleCounts[$role]++;

    $rows[] = [
        'id' => (string) Str::uuid(),
        'email' => $email,
        'username' => "audit.load.{$number}",
        'password' => $passwordHash,
        'full_name' => "Audit Load User {$number}",
        'title' => $role === 'admin' ? 'Audit Administrator' : 'Audit Nurse',
        'role_key' => $role,
        'active' => true,
        'email_verified_at' => $now,
        'password_change_required' => false,
        'created_at' => $now,
        'updated_at' => $now,
    ];
    $credentials[] = "{$email},{$password}";
}

foreach (array_chunk($rows, 100) as $chunk) {
    DB::table('users')->upsert(
        $chunk,
        ['email'],
        ['username', 'password', 'full_name', 'title', 'role_key', 'active',
            'email_verified_at', 'password_change_required', 'updated_at']
    );
}

file_put_contents('/audit-output/load-credentials.csv', implode(PHP_EOL, $credentials).PHP_EOL);
file_put_contents('/audit-output/load-account-model.json', json_encode([
    'count' => count($credentials),
    'password' => 'stored only in the local audit evidence directory',
    'roles' => $roleCounts,
    'login_source_ips' => '10.250.0.1 upward across /24 boundaries via trusted audit proxy headers',
    'authenticated_limit' => '300 requests/minute per distinct user',
], JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES).PHP_EOL);

echo "Audit load accounts ready: ".count($credentials).PHP_EOL;
