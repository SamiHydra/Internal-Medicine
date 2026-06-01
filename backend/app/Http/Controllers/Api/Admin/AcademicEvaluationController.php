<?php

namespace App\Http\Controllers\Api\Admin;

use App\Http\Controllers\Api\Concerns\SerializesAdminResources;
use App\Http\Controllers\Controller;
use App\Models\ConsultantEvaluation;
use App\Models\ResidentEvaluation;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Gate;
use Illuminate\Validation\Rule;

class AcademicEvaluationController extends Controller
{
    use SerializesAdminResources;

    /**
     * Paginated raw list for tables and the per-person detail page. The
     * `direction` filter selects which evaluation table is read.
     */
    public function index(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'direction' => ['sometimes', Rule::in(['consultant', 'resident'])],
            'subject_id' => ['sometimes', 'uuid'],
            'subjectId' => ['sometimes', 'uuid'],
            'ward_id' => ['sometimes', 'uuid'],
            'wardId' => ['sometimes', 'uuid'],
            'date_from' => ['sometimes', 'date_format:Y-m-d'],
            'dateFrom' => ['sometimes', 'date_format:Y-m-d'],
            'date_to' => ['sometimes', 'date_format:Y-m-d'],
            'dateTo' => ['sometimes', 'date_format:Y-m-d'],
            'page' => ['sometimes', 'integer', 'min:1'],
            'per_page' => ['sometimes', 'integer', 'between:1,100'],
            'perPage' => ['sometimes', 'integer', 'between:1,100'],
        ]);

        $direction = $validated['direction'] ?? 'consultant';
        $isResident = $direction === 'resident';

        Gate::authorize('viewAny', $isResident ? ResidentEvaluation::class : ConsultantEvaluation::class);

        $subjectId = $validated['subject_id'] ?? $validated['subjectId'] ?? null;
        $wardId = $validated['ward_id'] ?? $validated['wardId'] ?? null;
        $dateFrom = $validated['date_from'] ?? $validated['dateFrom'] ?? null;
        $dateTo = $validated['date_to'] ?? $validated['dateTo'] ?? null;
        $perPage = (int) ($validated['per_page'] ?? $validated['perPage'] ?? 25);

        $query = ($isResident ? ResidentEvaluation::query() : ConsultantEvaluation::query())
            ->with(['author', 'subject', 'ward'])
            ->when($subjectId, fn (Builder $q) => $q->where('subject_id', $subjectId))
            ->when($wardId, fn (Builder $q) => $q->where('ward_id', $wardId))
            ->when($dateFrom, fn (Builder $q) => $q->whereDate('evaluation_date', '>=', $dateFrom))
            ->when($dateTo, fn (Builder $q) => $q->whereDate('evaluation_date', '<=', $dateTo))
            ->orderByDesc('evaluation_date')
            ->orderByDesc('created_at');

        $paginator = $query->paginate($perPage)->withQueryString();

        $serialize = $isResident
            ? fn (ResidentEvaluation $evaluation) => $this->serializeResidentEvaluation($evaluation)
            : fn (ConsultantEvaluation $evaluation) => $this->serializeConsultantEvaluation($evaluation);

        return response()->json([
            'direction' => $direction,
            'data' => collect($paginator->items())->map($serialize)->values(),
            'meta' => [
                'currentPage' => $paginator->currentPage(),
                'lastPage' => $paginator->lastPage(),
                'perPage' => $paginator->perPage(),
                'total' => $paginator->total(),
            ],
        ]);
    }
}
