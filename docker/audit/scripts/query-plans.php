<?php

declare(strict_types=1);

use App\Models\User;
use App\Services\Academic\AcademicOperationsAnalyticsService;
use App\Services\Analytics\AnalyticsFilters;
use App\Services\Analytics\DashboardAnalyticsService;
use App\Services\Workspace\WorkspaceRevisionService;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;

$app = require '/audit/bootstrap.php';

function median(array $values): float
{
    sort($values);
    $count = count($values);
    $middle = intdiv($count, 2);
    return $count % 2 === 0
        ? ($values[$middle - 1] + $values[$middle]) / 2
        : $values[$middle];
}

function timedSelect(string $sql, array $bindings = [], int $runs = 21): array
{
    $samples = [];
    for ($index = 0; $index < $runs; $index++) {
        $started = hrtime(true);
        DB::select($sql, $bindings);
        $elapsed = (hrtime(true) - $started) / 1_000_000;
        if ($index >= 5) {
            $samples[] = $elapsed;
        }
    }
    sort($samples);
    return [
        'samplesMs' => array_map(fn (float $value): float => round($value, 3), $samples),
        'medianMs' => round(median($samples), 3),
        'p95Ms' => round($samples[(int) ceil(count($samples) * 0.95) - 1], 3),
    ];
}

function plans(string $sql, array $bindings = []): array
{
    $explain = DB::select('EXPLAIN '.$sql, $bindings);
    // MariaDB's actual-row equivalent of MySQL "EXPLAIN ANALYZE" is
    // ANALYZE FORMAT=JSON. It executes the statement and reports r_rows/r_loops.
    $analyzeRows = DB::select('ANALYZE FORMAT=JSON '.$sql, $bindings);
    $analyzeJson = (string) (array_values((array) $analyzeRows[0])[0] ?? '');
    return [
        'sql' => $sql,
        'bindings' => $bindings,
        'explain' => $explain,
        'explainAnalyzeSyntax' => 'ANALYZE FORMAT=JSON (MariaDB equivalent)',
        'explainAnalyze' => $analyzeJson,
    ];
}

function captureQueries(callable $operation): array
{
    DB::flushQueryLog();
    DB::enableQueryLog();
    $started = hrtime(true);
    $operation();
    $elapsedMs = (hrtime(true) - $started) / 1_000_000;
    $queries = DB::getQueryLog();
    DB::disableQueryLog();
    return ['elapsedMs' => round($elapsedMs, 3), 'queries' => $queries];
}

$result = [
    'capturedAt' => now()->toIso8601String(),
    'databaseVersion' => DB::selectOne('select version() as version')->version,
    'mariadbAnalyzeNote' => 'MariaDB uses ANALYZE FORMAT=JSON for actual execution plans.',
];
$raw = [];

// PERF-05: exact student attendance aggregate, before and after the candidate.
$indexName = 'student_attendance_student_present_index';
$helperIndexName = 'student_attendance_student_id_audit_helper_index';
$existingIndexes = collect(DB::select('SHOW INDEX FROM student_attendance'));
$existing = $existingIndexes
    ->contains(fn (object $row): bool => $row->Key_name === $indexName);
if ($existing) {
    if (! $existingIndexes->contains(fn (object $row): bool => $row->Key_name === $helperIndexName)) {
        DB::statement(
            "ALTER TABLE student_attendance ADD INDEX {$helperIndexName} (student_id)"
        );
    }
    DB::statement("ALTER TABLE student_attendance DROP INDEX {$indexName}");
}
DB::statement('ANALYZE TABLE student_attendance');

$attendanceSql = 'SELECT student_id, COUNT(*) AS expected, '
    .'SUM(CASE WHEN present THEN 1 ELSE 0 END) AS present '
    .'FROM student_attendance GROUP BY student_id';
$beforePlan = plans($attendanceSql);
$beforeTiming = timedSelect($attendanceSql);

DB::statement(
    "ALTER TABLE student_attendance ADD INDEX {$indexName} (student_id, present)"
);
if (collect(DB::select('SHOW INDEX FROM student_attendance'))
    ->contains(fn (object $row): bool => $row->Key_name === $helperIndexName)) {
    DB::statement("ALTER TABLE student_attendance DROP INDEX {$helperIndexName}");
}
DB::statement('ANALYZE TABLE student_attendance');
$afterPlan = plans($attendanceSql);
$afterTiming = timedSelect($attendanceSql);
$chosen = str_contains($afterPlan['explainAnalyze'], $indexName)
    || collect($afterPlan['explain'])->contains(
        fn (object $row): bool => (string) ($row->key ?? '') === $indexName
    );
$improvementPct = $beforeTiming['medianMs'] > 0
    ? round((1 - $afterTiming['medianMs'] / $beforeTiming['medianMs']) * 100, 2)
    : 0.0;
$kept = $chosen && $improvementPct >= 5.0;
if (! $kept) {
    DB::statement(
        'ALTER TABLE student_attendance ADD INDEX '
        .'student_attendance_student_id_foreign (student_id)'
    );
    DB::statement("ALTER TABLE student_attendance DROP INDEX {$indexName}");
    DB::statement('ANALYZE TABLE student_attendance');
}
$result['studentAttendance'] = [
    'ddlTested' => "ALTER TABLE student_attendance ADD INDEX {$indexName} (student_id, present);",
    'before' => ['plan' => $beforePlan, 'timing' => $beforeTiming],
    'after' => ['plan' => $afterPlan, 'timing' => $afterTiming],
    'optimizerChoseIndex' => $chosen,
    'medianImprovementPct' => $improvementPct,
    'keptInAuditDatabase' => $kept,
    'decisionRule' => 'Keep only when chosen and warmed median improves by at least 5%.',
];
$raw[] = "=== student_attendance BEFORE ===\n"
    .json_encode($beforePlan['explain'], JSON_PRETTY_PRINT)."\n"
    .$beforePlan['explainAnalyze'];
$raw[] = "=== student_attendance AFTER ===\n"
    .json_encode($afterPlan['explain'], JSON_PRETTY_PRINT)."\n"
    .$afterPlan['explainAnalyze'];

// PERF-02: capture the actual slowest chunk aggregate built by the service.
$dashboard = $app->make(DashboardAnalyticsService::class);
$build = new ReflectionMethod($dashboard, 'buildSummary');
$allCapture = captureQueries(fn () => $build->invoke($dashboard, new AnalyticsFilters()));
$aggregateQueries = collect($allCapture['queries'])
    ->filter(fn (array $query): bool => str_contains($query['query'], 'report_field_values')
        && str_contains(strtolower($query['query']), 'group by'))
    ->sortByDesc('time')
    ->values();
$aggregate = $aggregateQueries->first();
if (! is_array($aggregate)) {
    throw new RuntimeException('Could not capture the all-time field-value aggregate.');
}
$aggregatePlan = plans($aggregate['query'], $aggregate['bindings']);
$result['allTimeFieldAggregate'] = [
    'serviceElapsedMs' => $allCapture['elapsedMs'],
    'serviceQueryCount' => count($allCapture['queries']),
    'capturedQueryTimeMs' => $aggregate['time'],
    'chunkQueryCount' => $aggregateQueries->count(),
    'plan' => $aggregatePlan,
];
$raw[] = "=== all-time field-value aggregate ===\n"
    .json_encode($aggregatePlan['explain'], JSON_PRETTY_PRINT)."\n"
    .$aggregatePlan['explainAnalyze'];

// PERF-04: capture and execute the admin revision union.
$user = User::query()->where('email', 'audit.load.0001@stpaulos.local')->firstOrFail();
$revisionService = $app->make(WorkspaceRevisionService::class);
$revisionCapture = captureQueries(fn () => $revisionService->for($user));
$revisionQuery = collect($revisionCapture['queries'])
    ->sortByDesc('time')
    ->first();
if (! is_array($revisionQuery)) {
    throw new RuntimeException('Could not capture workspace revision query.');
}
$revisionPlan = plans($revisionQuery['query'], $revisionQuery['bindings']);

$branchDefinitions = [
    'reports' => ['reports', 'updated_at', null],
    'assignments' => ['report_assignments', 'updated_at', null],
    'reporting_periods' => ['reporting_periods', 'created_at', null],
    'notifications' => ['notifications', 'created_at', ['recipient_id', $user->id]],
    'report_templates' => ['report_templates', 'updated_at', null],
    'report_fields' => ['report_field_definitions', 'updated_at', null],
    'settings' => ['app_settings', 'updated_at', null],
    'current_user' => ['users', 'updated_at', ['id', $user->id]],
    'duty_assignments' => ['duty_assignments', 'updated_at', null],
    'rotation_calendars' => ['rotation_calendars', 'updated_at', null],
    'rotation_blocks' => ['rotation_blocks', 'updated_at', null],
    'transfer_requests' => ['transfer_requests', 'updated_at', null],
    'rep_assignments' => ['rep_assignments', 'updated_at', null],
    'teaching_activity_schedules' => ['teaching_activity_schedules', 'updated_at', null],
    'teaching_sessions' => ['teaching_sessions', 'updated_at', null],
    'student_attendance' => ['student_attendance', 'updated_at', null],
    'morning_sessions' => ['morning_sessions', 'updated_at', null],
    'morning_attendance' => ['morning_attendance', 'updated_at', null],
    'morning_roster_overrides' => ['morning_roster_overrides', 'updated_at', null],
];
$branchCosts = [];
foreach ($branchDefinitions as $name => [$table, $updatedColumn, $filter]) {
    $sql = "SELECT MAX(`{$updatedColumn}`) AS changed_at, COUNT(*) AS records FROM `{$table}`";
    $bindings = [];
    if (is_array($filter)) {
        $sql .= " WHERE `{$filter[0]}` = ?";
        $bindings[] = $filter[1];
    }
    $branchCosts[$name] = timedSelect($sql, $bindings, 11);
}
$result['workspaceRevision'] = [
    'serviceElapsedMs' => $revisionCapture['elapsedMs'],
    'capturedQueryTimeMs' => $revisionQuery['time'],
    'plan' => $revisionPlan,
    'branchCosts' => $branchCosts,
];
$raw[] = "=== workspace revision UNION ===\n"
    .json_encode($revisionPlan['explain'], JSON_PRETTY_PRINT)."\n"
    .$revisionPlan['explainAnalyze'];

// Confirm MariaDB choices for student evaluations and answer eager load.
Cache::flush();
$studentCapture = captureQueries(
    fn () => $app->make(AcademicOperationsAnalyticsService::class)->students()
);
$evaluationQuery = collect($studentCapture['queries'])->first(
    fn (array $query): bool => str_contains($query['query'], 'from `evaluations`')
        && str_contains($query['query'], '`form_key` in')
);
$answerQuery = collect($studentCapture['queries'])->first(
    fn (array $query): bool => str_contains($query['query'], 'from `evaluation_answers`')
        && str_contains($query['query'], '`evaluation_id` in')
);
if (! is_array($evaluationQuery) || ! is_array($answerQuery)) {
    throw new RuntimeException('Could not capture evaluation/evaluation-answer eager-load queries.');
}
$evaluationPlan = plans($evaluationQuery['query'], $evaluationQuery['bindings']);
$answerPlan = plans($answerQuery['query'], $answerQuery['bindings']);
$answerIndex = 'evaluation_answers_evaluation_id_field_key_unique';
$forcedAnswerSql = preg_replace(
    '/from `evaluation_answers`/i',
    "from `evaluation_answers` FORCE INDEX (`{$answerIndex}`)",
    $answerQuery['query'],
    1
);
if (! is_string($forcedAnswerSql)) {
    throw new RuntimeException('Could not construct forced-index evaluation-answer query.');
}
$forcedAnswerPlan = plans($forcedAnswerSql, $answerQuery['bindings']);
$answerScanTiming = timedSelect($answerQuery['query'], $answerQuery['bindings'], 11);
$answerForcedTiming = timedSelect($forcedAnswerSql, $answerQuery['bindings'], 11);
$result['studentEvaluations'] = [
    'serviceElapsedMs' => $studentCapture['elapsedMs'],
    'evaluations' => $evaluationPlan,
    'answers' => [
        'naturalPlan' => $answerPlan,
        'naturalTiming' => $answerScanTiming,
        'forcedExistingIndexPlan' => $forcedAnswerPlan,
        'forcedExistingIndexTiming' => $answerForcedTiming,
        'indexTested' => $answerIndex,
    ],
];
$raw[] = "=== student evaluations IN filter ===\n"
    .json_encode($evaluationPlan['explain'], JSON_PRETTY_PRINT)."\n"
    .$evaluationPlan['explainAnalyze'];
$raw[] = "=== evaluation answers eager load ===\n"
    .json_encode($answerPlan['explain'], JSON_PRETTY_PRINT)."\n"
    .$answerPlan['explainAnalyze']."\n\n"
    ."=== evaluation answers eager load: FORCE existing index ===\n"
    .json_encode($forcedAnswerPlan['explain'], JSON_PRETTY_PRINT)."\n"
    .$forcedAnswerPlan['explainAnalyze'];

file_put_contents(
    '/audit-output/query-plans.json',
    json_encode($result, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES).PHP_EOL
);
file_put_contents('/audit-output/query-plans-raw.txt', implode("\n\n", $raw).PHP_EOL);

echo json_encode([
    'databaseVersion' => $result['databaseVersion'],
    'studentAttendanceIndexChosen' => $chosen,
    'studentAttendanceImprovementPct' => $improvementPct,
    'studentAttendanceIndexKept' => $kept,
    'allTimeServiceMs' => $allCapture['elapsedMs'],
    'revisionServiceMs' => $revisionCapture['elapsedMs'],
    'studentServiceMs' => $studentCapture['elapsedMs'],
], JSON_PRETTY_PRINT).PHP_EOL;
