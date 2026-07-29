<?php

declare(strict_types=1);

use App\Http\Controllers\Api\WorkspaceController;
use App\Models\User;
use App\Services\Academic\AcademicAnalyticsFilters;
use App\Services\Academic\AcademicAnalyticsService;
use App\Services\Academic\AcademicOperationsAnalyticsService;
use App\Services\Analytics\AnalyticsFilters;
use App\Services\Analytics\DashboardAnalyticsService;
use Illuminate\Database\Events\QueryExecuted;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;

$app = require '/audit/bootstrap.php';
header('Content-Type: application/json');

$case = (string) ($_GET['case'] ?? '');
if ($case === 'flush') {
    Cache::flush();
    echo json_encode(['flushed' => true, 'driver' => config('cache.default')]);
    return;
}

if (($_GET['cold'] ?? '0') === '1') {
    Cache::flush();
}

$user = User::query()->where('email', 'audit.load.0001@stpaulos.local')->firstOrFail();
Auth::setUser($user);

$queries = [];
DB::listen(function (QueryExecuted $query) use (&$queries): void {
    $queries[] = [
        'sql' => $query->sql,
        'rawSql' => $query->toRawSql(),
        'bindings' => $query->bindings,
        'timeMs' => $query->time,
        'connection' => $query->connectionName,
    ];
});

$memoryBefore = memory_get_usage(true);
$peakBefore = memory_get_peak_usage(true);
$started = hrtime(true);

$payload = match ($case) {
    'academic_summary' => $app->make(AcademicAnalyticsService::class)
        ->summary(new AcademicAnalyticsFilters()),
    'academic_trend' => $app->make(AcademicAnalyticsService::class)
        ->trend(new AcademicAnalyticsFilters()),
    'academic_people' => $app->make(AcademicAnalyticsService::class)
        ->people(new AcademicAnalyticsFilters()),
    'clinical_all' => $app->make(DashboardAnalyticsService::class)
        ->summary(new AnalyticsFilters()),
    'clinical_8w' => $app->make(DashboardAnalyticsService::class)->summary(new AnalyticsFilters(
        dateFrom: '2026-06-08',
        dateTo: '2026-08-02',
    )),
    'students' => $app->make(AcademicOperationsAnalyticsService::class)->students(),
    'workspace_default', 'workspace_all' => (function () use ($app, $user, $case): array {
        $params = [
            'includeProfiles' => 0,
            'includeAccessRequests' => 0,
            'includeHistory' => $case === 'workspace_all' ? 1 : 0,
        ];
        if ($case === 'workspace_all') {
            $params['reportPeriodWindow'] = 'all';
        }
        $request = Request::create('/api/workspace', 'GET', $params);
        $request->setUserResolver(fn () => $user);
        $response = $app->make(WorkspaceController::class)->show($request);
        return json_decode($response->getContent(), true, 512, JSON_THROW_ON_ERROR);
    })(),
    default => throw new InvalidArgumentException("Unknown measurement case: {$case}"),
};

$elapsedMs = (hrtime(true) - $started) / 1_000_000;
$encoded = json_encode($payload, JSON_THROW_ON_ERROR);

usort($queries, fn (array $left, array $right): int => $right['timeMs'] <=> $left['timeMs']);

echo json_encode([
    'case' => $case,
    'cacheDriver' => config('cache.default'),
    'sessionDriver' => config('session.driver'),
    'queueDriver' => config('queue.default'),
    'elapsedMs' => round($elapsedMs, 3),
    'queryCount' => count($queries),
    'queryTimeMs' => round(array_sum(array_column($queries, 'timeMs')), 3),
    'slowestQueryMs' => round((float) ($queries[0]['timeMs'] ?? 0), 3),
    'payloadBytes' => strlen($encoded),
    'allocationDeltaMb' => round((memory_get_usage(true) - $memoryBefore) / 1048576, 3),
    'peakDeltaMb' => round((memory_get_peak_usage(true) - $peakBefore) / 1048576, 3),
    'processPeakMb' => round(memory_get_peak_usage(true) / 1048576, 3),
    'queries' => $queries,
], JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES);
