<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\ConsultantEvaluation;
use App\Services\Academic\AcademicOperationsAnalyticsService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Gate;

/**
 * Phase 7 read models for the admin academic dashboard tabs: morning
 * punctuality, teaching occurrence, and student progress. All cached by
 * content stamp in the service; nothing here is polled.
 */
class AcademicOperationsAnalyticsController extends Controller
{
    public function __construct(
        private readonly AcademicOperationsAnalyticsService $analytics,
    ) {}

    public function morning(Request $request): JsonResponse
    {
        Gate::authorize('viewAny', ConsultantEvaluation::class);

        $validated = $request->validate([
            'userId' => ['sometimes', 'uuid'],
        ]);

        return response()->json($this->analytics->morning($validated['userId'] ?? null));
    }

    public function teaching(): JsonResponse
    {
        Gate::authorize('viewAny', ConsultantEvaluation::class);

        return response()->json($this->analytics->teaching());
    }

    public function students(): JsonResponse
    {
        Gate::authorize('viewAny', ConsultantEvaluation::class);

        return response()->json($this->analytics->students());
    }
}
