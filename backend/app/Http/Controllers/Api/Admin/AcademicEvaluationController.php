<?php

namespace App\Http\Controllers\Api\Admin;

use App\Http\Controllers\Api\Concerns\SerializesAdminResources;
use App\Http\Controllers\Controller;
use App\Models\ConsultantEvaluation;
use App\Models\Evaluation;
use App\Models\ResidentEvaluation;
use App\Models\User;
use App\Services\Academic\EvaluationFormService;
use App\Services\Admin\AdminAuditService;
use App\Support\Academic\EvaluationScoring;
use App\Support\HospitalClock;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Gate;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

class AcademicEvaluationController extends Controller
{
    use SerializesAdminResources;

    /** The external duties whose host departments send paper evaluations. */
    public const EXTERNAL_PLACEMENTS = ['icu', 'emergency', 'dermatology', 'radiology', 'psychiatry', 'zewditu', 'saint_peter'];

    public function __construct(
        private readonly AdminAuditService $auditService,
        private readonly EvaluationFormService $forms,
    ) {}

    /**
     * Paginated raw list for tables and the per-person detail page. The
     * `direction` filter selects which form's responses are read.
     */
    public function index(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'direction' => ['sometimes', Rule::in(['consultant', 'resident'])],
            'subject_id' => ['sometimes', 'uuid'],
            'subjectId' => ['sometimes', 'uuid'],
            // Filters to evaluations this person WROTE, the mirror of subject_id.
            'author_id' => ['sometimes', 'uuid'],
            'authorId' => ['sometimes', 'uuid'],
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
        $authorId = $validated['author_id'] ?? $validated['authorId'] ?? null;
        $wardId = $validated['ward_id'] ?? $validated['wardId'] ?? null;
        $dateFrom = $validated['date_from'] ?? $validated['dateFrom'] ?? null;
        $dateTo = $validated['date_to'] ?? $validated['dateTo'] ?? null;
        $perPage = (int) ($validated['per_page'] ?? $validated['perPage'] ?? 25);

        $query = Evaluation::query()
            ->forKey(EvaluationScoring::formKeyForDirection($direction))
            ->with(['author', 'subject', 'ward', 'answers'])
            ->when($subjectId, fn (Builder $q) => $q->where('subject_user_id', $subjectId))
            ->when($authorId, fn (Builder $q) => $q->where('author_id', $authorId))
            ->when($wardId, fn (Builder $q) => $q->where('ward_id', $wardId))
            ->when($dateFrom, fn (Builder $q) => $q->whereDate('evaluation_date', '>=', $dateFrom))
            ->when($dateTo, fn (Builder $q) => $q->whereDate('evaluation_date', '<=', $dateTo))
            ->orderByDesc('evaluation_date')
            ->orderByDesc('created_at');

        $paginator = $query->paginate($perPage)->withQueryString();

        $serialize = $isResident
            ? fn (Evaluation $evaluation) => $this->serializeResidentEvaluation($evaluation)
            : fn (Evaluation $evaluation) => $this->serializeConsultantEvaluation($evaluation);

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

    /**
     * Admin entry of an externally-sourced paper evaluation (V2 Phase 3): the
     * host department (ICU, Emergency, an external hospital, ...) evaluated
     * the resident on paper; an administrator types it in. The row carries the
     * external evaluator's name and department instead of an author account,
     * so no author_id is accepted, and no pairing check applies.
     */
    public function storeExternal(Request $request): JsonResponse
    {
        Gate::authorize('createExternal', ResidentEvaluation::class);

        $today = HospitalClock::today()->toDateString();
        $validated = $request->validate([
            'authorId' => ['prohibited'],
            'author_id' => ['prohibited'],
            'subjectId' => ['required', 'uuid', Rule::exists('users', 'id')],
            'evaluationDate' => ['required', 'date', "before_or_equal:{$today}"],
            'placement' => ['required', 'string', Rule::in(self::EXTERNAL_PLACEMENTS)],
            'evaluatorName' => ['required', 'string', 'max:255'],
            'evaluatorDepartment' => ['sometimes', 'nullable', 'string', 'max:255'],
            'onTime' => ['required', 'boolean'],
            'prepared' => ['required', 'boolean'],
            'presentationClear' => ['required', 'boolean'],
            'clinicalReasoning' => ['required', 'boolean'],
            'managementPlan' => ['required', 'boolean'],
            'documentationTimely' => ['required', 'boolean'],
            'communication' => ['required', 'boolean'],
            'professional' => ['required', 'boolean'],
            'responsiveFeedback' => ['required', 'boolean'],
            'followThrough' => ['required', 'boolean'],
            'overallRating' => ['required', 'integer', 'between:1,5'],
            'comment' => ['sometimes', 'nullable', 'string', 'max:2000'],
        ]);

        $subject = User::query()->findOrFail($validated['subjectId']);

        if ($subject->role_key !== 'resident') {
            throw ValidationException::withMessages([
                'subjectId' => ['External evaluations are recorded for residents.'],
            ]);
        }

        $form = $this->forms->published('resident_acgme');

        $evaluation = $this->forms->store($form, [
            'on_time' => $validated['onTime'],
            'prepared' => $validated['prepared'],
            'presentation_clear' => $validated['presentationClear'],
            'clinical_reasoning' => $validated['clinicalReasoning'],
            'management_plan' => $validated['managementPlan'],
            'documentation_timely' => $validated['documentationTimely'],
            'communication' => $validated['communication'],
            'professional' => $validated['professional'],
            'responsive_feedback' => $validated['responsiveFeedback'],
            'follow_through' => $validated['followThrough'],
            'overall_rating' => $validated['overallRating'],
            'comment' => $validated['comment'] ?? null,
        ], [
            'subject_user_id' => $subject->id,
            'evaluation_date' => $validated['evaluationDate'],
            'placement_type' => $validated['placement'],
            'external_evaluator_name' => $validated['evaluatorName'],
            'external_evaluator_department' => $validated['evaluatorDepartment'] ?? null,
            'entered_by_id' => $request->user()->id,
        ]);

        $this->auditService->record($request->user(), 'create_external', 'resident_evaluation', $evaluation->id, null, [
            'subjectId' => $subject->id,
            'placement' => $validated['placement'],
            'evaluatorName' => $validated['evaluatorName'],
        ], $request);

        return response()->json($this->serializeResidentEvaluation($evaluation), 201);
    }

    /**
     * Chronological "who evaluated whom" feed across both evaluation directions.
     * Evaluations are immutable, so this is a submission trail (no field diffs).
     * Admins see the evaluator identity - the anonymity rule only covers the
     * resident/consultant self-view.
     */
    public function audit(Request $request): JsonResponse
    {
        Gate::authorize('viewAny', ResidentEvaluation::class);
        Gate::authorize('viewAny', ConsultantEvaluation::class);

        $validated = $request->validate([
            'direction' => ['sometimes', Rule::in(['resident', 'consultant'])],
            'limit' => ['sometimes', 'integer', 'min:1', 'max:500'],
        ]);

        $limit = (int) ($validated['limit'] ?? 200);
        $direction = $validated['direction'] ?? null;

        $entries = collect();

        foreach (['resident', 'consultant'] as $feedDirection) {
            if ($direction !== null && $direction !== $feedDirection) {
                continue;
            }

            $entries = $entries->concat(
                Evaluation::query()
                    ->forKey(EvaluationScoring::formKeyForDirection($feedDirection))
                    ->with(['author', 'subject', 'ward', 'answers'])
                    ->orderByDesc('created_at')
                    ->limit($limit)
                    ->get()
                    ->map(fn (Evaluation $evaluation) => $this->serializeAcademicAuditEntry($evaluation, $feedDirection)),
            );
        }

        return response()->json([
            'data' => $entries
                ->sortByDesc('createdAt')
                ->take($limit)
                ->values(),
        ]);
    }

    /**
     * @return array<string, mixed>
     */
    private function serializeAcademicAuditEntry(Evaluation $evaluation, string $direction): array
    {
        $scoreItems = EvaluationScoring::itemsForDirection($direction);
        $indicatorsMet = collect($scoreItems)
            ->filter(fn (string $item) => (bool) $evaluation->answer($item))
            ->count();

        return [
            'id' => $evaluation->id,
            'direction' => $direction,
            'authorId' => $evaluation->author_id,
            'authorName' => $evaluation->author?->full_name ?? $evaluation->external_evaluator_name,
            'subjectId' => $evaluation->subject_user_id,
            'subjectName' => $evaluation->subject?->full_name,
            'wardId' => $evaluation->ward_id,
            'wardName' => $evaluation->ward?->name,
            'evaluationDate' => $evaluation->evaluation_date?->toJSON(),
            'createdAt' => $evaluation->created_at?->toJSON(),
            'overallRating' => $direction === 'resident' ? $evaluation->answer('overall_rating') : null,
            'indicatorsMet' => $indicatorsMet,
            'indicatorsTotal' => count($scoreItems),
        ];
    }
}
