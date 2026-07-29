<?php

declare(strict_types=1);

use Illuminate\Support\Facades\DB;

require '/audit/bootstrap.php';

$tables = [
    'users', 'sessions', 'cache', 'jobs', 'reports', 'report_assignments',
    'reporting_periods', 'report_field_definitions', 'report_field_values',
    'notifications', 'evaluations', 'evaluation_answers', 'students',
    'student_attendance', 'teaching_sessions', 'morning_sessions',
    'morning_attendance', 'duty_assignments', 'rotation_blocks',
];

$analysis = [];
$counts = [];
foreach ($tables as $table) {
    $analysis[$table] = DB::select("ANALYZE TABLE `{$table}`");
    $counts[$table] = DB::table($table)->count();
}

file_put_contents('/audit-output/analyze-tables.json', json_encode(
    $analysis,
    JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES
).PHP_EOL);
file_put_contents('/audit-output/seed-row-counts.json', json_encode(
    $counts,
    JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES
).PHP_EOL);

echo "Analyzed ".count($tables)." hot tables.".PHP_EOL;
