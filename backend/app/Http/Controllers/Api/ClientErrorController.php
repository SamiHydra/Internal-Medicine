<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Support\Observability\ErrorReporter;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Validation\Rule;

/**
 * Receives sanitised error reports from the SPA (docs/OBSERVABILITY.md).
 * Public (the sign-in page must be able to report too), rate limited per IP,
 * strictly validated, and it stores nothing: the report goes to the log, the
 * hourly counters and the optional webhook. Report and evaluation content is
 * never part of the schema, so it cannot arrive here even by mistake.
 */
class ClientErrorController extends Controller
{
    public function store(Request $request): Response
    {
        if (! config('observability.client_errors.enabled', true)) {
            return response()->noContent();
        }

        $validated = $request->validate([
            'kind' => ['required', Rule::in(['error', 'unhandledrejection', 'render', 'api', 'offline-sync'])],
            'message' => ['required', 'string', 'max:500'],
            'stack' => ['nullable', 'string', 'max:4000'],
            'routeName' => ['required', 'string', 'max:120', 'regex:/^\/[A-Za-z0-9_\/:.-]*$/'],
            'status' => ['nullable', 'integer', 'min:100', 'max:599'],
            'releaseSha' => ['nullable', 'string', 'max:64', 'regex:/^[A-Za-z0-9._-]+$/'],
            'userAgent' => ['nullable', 'string', 'max:200'],
            'fingerprint' => ['nullable', 'string', 'max:64', 'regex:/^[A-Za-z0-9._-]+$/'],
        ]);

        ErrorReporter::reportClientError($validated, $request->user()?->getAuthIdentifier());

        return response()->noContent(Response::HTTP_ACCEPTED);
    }
}
