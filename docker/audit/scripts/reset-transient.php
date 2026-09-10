<?php

declare(strict_types=1);

use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;

require '/audit/bootstrap.php';

foreach (['sessions', 'cache_locks', 'cache', 'jobs', 'job_batches'] as $table) {
    if (DB::getSchemaBuilder()->hasTable($table)) {
        DB::table($table)->delete();
    }
}

try {
    $redis = new Redis();
    $redis->connect((string) env('REDIS_HOST', 'redis'), (int) env('REDIS_PORT', 6379), 2.0);
    $redis->flushAll();
    $redis->close();
} catch (Throwable $error) {
    fwrite(STDERR, "Redis reset skipped: {$error->getMessage()}".PHP_EOL);
}

Artisan::call('cache:clear');
echo "Transient session/cache/queue state reset.".PHP_EOL;
