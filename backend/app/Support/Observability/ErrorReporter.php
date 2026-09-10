<?php

namespace App\Support\Observability;

use Illuminate\Http\Request;
use Illuminate\Queue\Events\JobFailed;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use Symfony\Component\HttpKernel\Exception\HttpExceptionInterface;
use Throwable;

/**
 * The one place operational signals leave the application (docs/OBSERVABILITY.md).
 *
 * Every signal is (1) logged through the normal Laravel log, (2) counted in
 * hourly cache buckets the maintenance health view reads, and (3) forwarded as
 * a sanitised JSON document to OBSERVABILITY_WEBHOOK_URL when one is
 * configured. Forwarding never throws and never carries request bodies,
 * report values, evaluation content, passwords, tokens or cookies.
 */
final class ErrorReporter
{
    public const SIGNAL_EXCEPTIONS = 'exceptions';

    public const SIGNAL_SERVER_ERRORS = 'serverErrors';

    public const SIGNAL_SLOW_REQUESTS = 'slowRequests';

    public const SIGNAL_FAILED_JOBS = 'failedJobs';

    public const SIGNAL_CLIENT_ERRORS = 'clientErrors';

    public const SIGNALS = [
        self::SIGNAL_EXCEPTIONS,
        self::SIGNAL_SERVER_ERRORS,
        self::SIGNAL_SLOW_REQUESTS,
        self::SIGNAL_FAILED_JOBS,
        self::SIGNAL_CLIENT_ERRORS,
    ];

    /** Hourly buckets live long enough for "last hour / previous hour". */
    private const COUNTER_TTL_SECONDS = 3 * 3600;

    public static function reportException(Throwable $exception, ?Request $request = null): void
    {
        $status = $exception instanceof HttpExceptionInterface ? $exception->getStatusCode() : 500;

        // 4xx HTTP exceptions (404, 403, 429, ...) are request outcomes, not
        // application errors; Laravel already keeps them out of the log too.
        if ($status < 500) {
            return;
        }

        self::increment(self::SIGNAL_EXCEPTIONS);

        self::forward([
            'kind' => 'exception',
            'class' => $exception::class,
            'message' => Redactor::scrubString($exception->getMessage()),
            'file' => Redactor::relativePath($exception->getFile()),
            'line' => $exception->getLine(),
            'status' => $status,
            ...self::requestContext($request),
        ]);
    }

    public static function reportFailedJob(JobFailed $event): void
    {
        self::increment(self::SIGNAL_FAILED_JOBS);

        $exception = $event->exception;

        Log::warning('Queue job failed', [
            'job' => $event->job->resolveName(),
            'queue' => $event->job->getQueue(),
            'connection' => $event->connectionName,
            'exception' => $exception::class,
            'message' => Redactor::scrubString($exception->getMessage()),
        ]);

        self::forward([
            'kind' => 'failed_job',
            'job' => $event->job->resolveName(),
            'queue' => $event->job->getQueue(),
            'connection' => $event->connectionName,
            'attempts' => $event->job->attempts(),
            'class' => $exception::class,
            'message' => Redactor::scrubString($exception->getMessage()),
            'file' => Redactor::relativePath($exception->getFile()),
            'line' => $exception->getLine(),
        ]);
    }

    public static function countServerError(Request $request, int $status): void
    {
        self::increment(self::SIGNAL_SERVER_ERRORS);
    }

    public static function reportSlowRequest(Request $request, int $durationMs, int $status): void
    {
        self::increment(self::SIGNAL_SLOW_REQUESTS);

        $context = [
            'durationMs' => $durationMs,
            'status' => $status,
            'thresholdMs' => (int) config('observability.slow_request_ms'),
            ...self::requestContext($request),
        ];

        Log::warning('Slow request', $context);

        self::forward(['kind' => 'slow_request', ...$context]);
    }

    /**
     * @param  array<string, mixed>  $payload  Already validated by the controller.
     */
    public static function reportClientError(array $payload, ?string $userId): void
    {
        self::increment(self::SIGNAL_CLIENT_ERRORS);

        $clean = Redactor::scrubArray($payload);
        $document = [
            'kind' => 'client_'.((string) ($clean['kind'] ?? 'error')),
            'message' => $clean['message'] ?? '',
            'stack' => $clean['stack'] ?? null,
            'route' => $clean['routeName'] ?? null,
            'status' => $clean['status'] ?? null,
            'clientRelease' => $clean['releaseSha'] ?? null,
            'userAgent' => $clean['userAgent'] ?? null,
            'fingerprint' => $clean['fingerprint'] ?? null,
            'userId' => $userId,
        ];

        Log::warning('Client error', $document);

        self::forward($document);
    }

    /**
     * Hourly counters for the health view: {signal: {lastHour, previousHour}}.
     *
     * @return array<string, array{lastHour: int, previousHour: int}>
     */
    public static function counters(): array
    {
        $now = Carbon::now();
        $current = self::bucket($now);
        $previous = self::bucket($now->copy()->subHour());
        $counters = [];

        foreach (self::SIGNALS as $signal) {
            $counters[$signal] = [
                'lastHour' => (int) Cache::get(self::key($signal, $current), 0),
                'previousHour' => (int) Cache::get(self::key($signal, $previous), 0),
            ];
        }

        return $counters;
    }

    public static function webhookConfigured(): bool
    {
        return trim((string) config('observability.webhook_url')) !== '';
    }

    private static function increment(string $signal): void
    {
        try {
            $key = self::key($signal, self::bucket(Carbon::now()));
            Cache::add($key, 0, self::COUNTER_TTL_SECONDS);
            Cache::increment($key);
        } catch (Throwable) {
            // Counting must never break the request that is already failing.
        }
    }

    private static function bucket(Carbon $at): string
    {
        return $at->copy()->utc()->format('YmdH');
    }

    private static function key(string $signal, string $bucket): string
    {
        return "observability:{$signal}:{$bucket}";
    }

    /**
     * @return array<string, mixed>
     */
    private static function requestContext(?Request $request): array
    {
        // PHPUnit runs in the console too, so only a real artisan process
        // (no test run) is treated as console context.
        if ($request === null || (app()->runningInConsole() && ! app()->runningUnitTests())) {
            return ['context' => 'console'];
        }

        // Path and route only: query strings can carry reset tokens, bodies
        // carry report and evaluation content, headers carry cookies.
        return [
            'context' => 'http',
            'method' => $request->getMethod(),
            'path' => '/'.ltrim($request->path(), '/'),
            'route' => $request->route()?->uri(),
            'userId' => $request->user()?->getAuthIdentifier(),
        ];
    }

    /**
     * @param  array<string, mixed>  $document
     */
    private static function forward(array $document): void
    {
        $url = trim((string) config('observability.webhook_url'));

        if ($url === '') {
            return;
        }

        $document += [
            'application' => (string) config('app.name'),
            'environment' => (string) app()->environment(),
            'release' => Release::sha(),
            'occurredAt' => Carbon::now()->toIso8601String(),
        ];

        try {
            $pending = Http::timeout((int) config('observability.webhook_timeout_seconds', 2))
                ->acceptJson()
                ->asJson();

            $token = trim((string) config('observability.webhook_token'));
            if ($token !== '') {
                $pending = $pending->withToken($token);
            }

            $pending->post($url, $document);
        } catch (Throwable $forwardError) {
            // The webhook is an optional mirror of the log; losing one report
            // must never become a second failure. Note it once in the log.
            Log::notice('Observability webhook unreachable', [
                'message' => Redactor::scrubString($forwardError->getMessage(), 200),
            ]);
        }
    }
}
