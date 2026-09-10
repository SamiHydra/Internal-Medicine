<?php

namespace App\Http\Controllers\Api\Admin;

use App\Http\Controllers\Controller;
use App\Services\Operations\SystemHealthService;
use Illuminate\Http\JsonResponse;

/**
 * Maintenance-only health snapshot (permission system.health, superadmin).
 * Read-only; the response carries states, ages, counts and driver names,
 * never credentials, environment values or stack traces.
 */
class SystemHealthController extends Controller
{
    public function __construct(private readonly SystemHealthService $health) {}

    public function show(): JsonResponse
    {
        return response()->json($this->health->snapshot())
            ->header('Cache-Control', 'no-store');
    }
}
