<?php

namespace App\Http\Middleware;

use App\Support\Observability\ErrorReporter;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Counts 5xx answers and logs slow requests (docs/OBSERVABILITY.md). Runs
 * after the application has produced its response, so a request that ends in
 * a handled 500 (no exception reaching the handler) is still counted.
 */
class RecordRequestTiming
{
    /**
     * @param  Closure(Request): Response  $next
     */
    public function handle(Request $request, Closure $next): Response
    {
        $startedAt = defined('LARAVEL_START') ? (float) LARAVEL_START : microtime(true);

        $response = $next($request);

        $durationMs = (int) round((microtime(true) - $startedAt) * 1000);
        $status = $response->getStatusCode();

        // A single number the browser (and the load harness) can read from the
        // response without any body parsing.
        $response->headers->set('Server-Timing', sprintf('app;dur=%d', $durationMs));

        if ($request->is('up')) {
            return $response;
        }

        if ($status >= 500) {
            ErrorReporter::countServerError($request, $status);
        }

        $threshold = (int) config('observability.slow_request_ms', 1000);
        if ($threshold > 0 && $durationMs >= $threshold) {
            ErrorReporter::reportSlowRequest($request, $durationMs, $status);
        }

        return $response;
    }
}
