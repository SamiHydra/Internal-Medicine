<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Two enum columns lost their SQLite CHECK. Adding a constrained foreign key
 * to a table forces SQLite to rebuild it, and the rebuild does not re-emit the
 * CHECK an earlier `enum()` produced: `departments.family` lost it to the
 * ward_id migration and `admin_access_requests.status` to the home_ward_id
 * one. MariaDB still rejects an out-of-range value with ERROR 1265, so the two
 * lanes disagreed - and the test suite runs on SQLite, so a regression that
 * wrote a bad value would pass tests and fail only in production.
 *
 * Triggers rather than a rebuilt CHECK: the same driver-guarded shape the
 * evaluation header invariants already use, and it cannot drop anything else
 * on the way through.
 */
return new class extends Migration
{
    /** @var array<string, array{table: string, column: string, values: list<string>, message: string}> */
    private const GUARDS = [
        'departments_family_enum' => [
            'table' => 'departments',
            'column' => 'family',
            'values' => ['inpatient', 'outpatient', 'procedure'],
            'message' => 'departments.family must be inpatient, outpatient or procedure.',
        ],
        'admin_access_requests_status_enum' => [
            'table' => 'admin_access_requests',
            'column' => 'status',
            'values' => ['pending', 'approved', 'rejected'],
            'message' => 'admin_access_requests.status must be pending, approved or rejected.',
        ],
    ];

    public function up(): void
    {
        if (DB::connection()->getDriverName() !== 'sqlite') {
            // MariaDB keeps the native enum, which already rejects the write.
            return;
        }

        foreach (self::GUARDS as $name => $guard) {
            $list = collect($guard['values'])
                ->map(fn (string $value) => "'".$value."'")
                ->implode(', ');

            foreach (['INSERT', 'UPDATE'] as $operation) {
                $trigger = $name.'_'.strtolower($operation);
                DB::unprepared('DROP TRIGGER IF EXISTS '.$trigger);
                DB::unprepared(<<<SQL
                    CREATE TRIGGER {$trigger}
                    BEFORE {$operation} ON {$guard['table']}
                    FOR EACH ROW
                    WHEN NEW.{$guard['column']} IS NOT NULL AND NEW.{$guard['column']} NOT IN ({$list})
                    BEGIN
                        SELECT RAISE(ABORT, '{$guard['message']}');
                    END
                SQL);
            }
        }
    }

    public function down(): void
    {
        if (DB::connection()->getDriverName() !== 'sqlite') {
            return;
        }

        foreach (array_keys(self::GUARDS) as $name) {
            foreach (['insert', 'update'] as $operation) {
                DB::unprepared('DROP TRIGGER IF EXISTS '.$name.'_'.$operation);
            }
        }
    }
};
