<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\ConsultantEvaluation;
use App\Services\Academic\AcademicAnalyticsFilters;
use App\Services\Academic\AcademicAnalyticsService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Gate;
use Illuminate\Validation\Rule;

class AcademicAnalyticsController extends Controller
{
    public function __construct(
        private readonly AcademicAnalyticsService $analytics,
    ) {}

    public function summary(Request $request): JsonResponse
    {
        Gate::authorize('viewAny', ConsultantEvaluation::class);

        return response()->json($this->analytics->summary($this->filters($request)));
    }

    public function trend(Request $request): JsonResponse
    {
        Gate::authorize('viewAny', ConsultantEvaluation::class);

        return response()->json($this->analytics->trend($this->filters($request)));
    }

    public function people(Request $request): JsonResponse
    {
        Gate::authorize('viewAny', ConsultantEvaluation::class);

        return response()->json($this->analytics->people($this->filters($request)));
    }

    private function filters(Request $request): AcademicAnalyticsFilters
    {
        $validated = $request->validate([
            'direction' => ['sometimes', Rule::in(['consultant', 'resident'])],
            'ward_id' => ['sometimes', 'uuid'],
            'wardId' => ['sometimes', 'uuid'],
            'subject_id' => ['sometimes', 'uuid'],
            'subjectId' => ['sometimes', 'uuid'],
            'date_from' => ['sometimes', 'date_format:Y-m-d'],
            'dateFrom' => ['sometimes', 'date_format:Y-m-d'],
            'date_to' => ['sometimes', 'date_format:Y-m-d'],
            'dateTo' => ['sometimes', 'date_format:Y-m-d'],
            'granularity' => ['sometimes', Rule::in(['weekly', 'monthly'])],
        ]);

        return AcademicAnalyticsFilters::fromArray($validated);
    }
}
