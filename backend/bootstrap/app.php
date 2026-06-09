<?php

use App\Http\Middleware\EnsureActiveUser;
use App\Http\Middleware\EnsurePermission;
use App\Http\Middleware\EnsureRole;
use App\Http\Middleware\SecurityHeaders;
use Illuminate\Foundation\Application;
use Illuminate\Foundation\Configuration\Exceptions;
use Illuminate\Foundation\Configuration\Middleware;
use Laravel\Sanctum\Http\Middleware\EnsureFrontendRequestsAreStateful;

return Application::configure(basePath: dirname(__DIR__))
    ->withRouting(
        web: __DIR__.'/../routes/web.php',
        api: __DIR__.'/../routes/api.php',
        commands: __DIR__.'/../routes/console.php',
        channels: __DIR__.'/../routes/channels.php',
        health: '/up',
    )
    ->withCommands([
        __DIR__.'/../app/Console/Commands',
    ])
    ->withMiddleware(function (Middleware $middleware): void {
        // Behind a TLS-terminating proxy (typical on shared hosting), trust the
        // forwarded headers so $request->isSecure(), secure cookies and HSTS work.
        // Set TRUSTED_PROXIES="*" (or a comma-separated list) in the environment.
        $trustedProxies = env('TRUSTED_PROXIES');
        if (! empty($trustedProxies)) {
            $middleware->trustProxies(
                at: $trustedProxies === '*' ? '*' : array_map('trim', explode(',', $trustedProxies)),
            );
        }

        // API-only app: there is no web "login" route. Returning null for the
        // guest redirect stops the auth middleware from eagerly resolving
        // route('login') (which 500s); combined with shouldRenderJsonWhen below,
        // an unauthenticated request gets a clean 401 JSON response.
        $middleware->redirectGuestsTo(fn () => null);

        $middleware->append(SecurityHeaders::class);
        $middleware->statefulApi();
        $middleware->api(prepend: [
            EnsureFrontendRequestsAreStateful::class,
        ]);
        $middleware->alias([
            'active' => EnsureActiveUser::class,
            'permission' => EnsurePermission::class,
            'role' => EnsureRole::class,
        ]);
    })
    ->withExceptions(function (Exceptions $exceptions): void {
        // This is an API-only app with no web "login" route. Force JSON rendering
        // for /api/* so an unauthenticated request returns a clean 401 instead of
        // attempting a redirect to the non-existent login route (which 500s).
        $exceptions->shouldRenderJsonWhen(
            fn ($request, $throwable): bool => $request->is('api/*') || $request->expectsJson(),
        );
    })->create();
