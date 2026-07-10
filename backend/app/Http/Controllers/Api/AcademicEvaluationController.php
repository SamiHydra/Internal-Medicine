<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Api\Concerns\SerializesAdminResources;
use App\Http\Controllers\Controller;
use App\Models\ConsultantEvaluation;
use App\Models\ResidentEvaluation;
use App\Models\User;
use App\Models\Ward;
use App\Services\Academic\AcademicAnalyticsFilters;
use App\Services\Academic\AcademicAnalyticsService;
use App\Services\Academic\RosterService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Facades\Validator;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

class AcademicEvaluationController extends Controller
{
    use SerializesAdminResources;

    /** Allowed values for the consultant-evaluation multi-selects. */
    private const MDT_PARTICIPANTS = ['consultant', 'fellow', 'internist', 'residents', 'interns', 'nurse', 'clinical_pharmacy'];

    private const SYSTEM_ISSUES = ['lab_delay', 'imaging_delay', 'staff_shortage', 'bed_issue', 'emr_interruption', 'communication_issue'];

    /** Allowed values for the resident-evaluation concerns multi-select. */
    private const CONCERNS = ['punctuality', 'preparation', 'medical_knowledge', 'clinical_reasoning', 'documentation', 'communication', 'professionalism', 'follow_through', 'time_management'];

    public function __construct(
        private readonly AcademicAnalyticsService $analytics,
        private readonly RosterService $roster,
    ) {}

    public function formOptions(Request $request): JsonResponse
    {
        // Second authz layer (the route also enforces permission:academic.submit).
        Gate::authorize('create', ConsultantEvaluation::class);

        $validated = $request->validate([
            'date' => ['sometimes', 'date', 'before_or_equal:today'],
        ]);

        $user = $request->user();
        $date = isset($validated['date']) ? Carbon::parse($validated['date']) : now();
        $oppositeRole = $this->oppositeRole($user->role_key);

        // Only the people the author actually overlaps with in a ward or
        // paired duty on that date. Rotation changes shift this automatically.
        $subjects = $oppositeRole === null
            ? collect()
            : $this->roster->peersFor($user, $date, $oppositeRole)
                ->map(fn (User $subject) => [
                    'id' => $subject->id,
                    'fullName' => $subject->full_name,
                ]);

        $wards = Ward::query()
            ->where('active', true)
            ->orderBy('name')
            ->get()
            ->map(fn (Ward $ward) => [
                'id' => $ward->id,
                'name' => $ward->name,
                'slug' => $ward->slug,
            ]);

        $placement = $this->roster->assignmentFor($user, $date);

        return response()->json([
            'date' => $date->toDateString(),
            'subjects' => $subjects->values(),
            'wards' => $wards->values(),
            'currentPlacement' => $placement === null ? null : [
                'dutyTypeName' => $placement->dutyType?->name,
                'wardId' => $placement->dutyType?->ward_id,
                'wardName' => $placement->dutyType?->ward?->name,
                'endsOn' => $placement->ends_on?->toDateString(),
            ],
        ]);
    }

    public function storeConsultantEvaluation(Request $request): JsonResponse
    {
        Gate::authorize('create', ConsultantEvaluation::class);

        // Direction guard: only a resident evaluates a consultant.
        if ($request->user()->role_key !== 'resident') {
            throw ValidationException::withMessages([
                'subjectId' => 'Only residents may submit consultant evaluations.',
            ]);
        }

        $validated = Validator::make($this->normalize($request), [
            'evaluation_date' => ['required', 'date', 'before_or_equal:today'],
            // Accepted for backwards compatibility but IGNORED: the ward is
            // snapshotted server-side from the shared duty placement.
            'ward_id' => ['sometimes', 'nullable', 'uuid'],
            'subject_id' => ['required', 'uuid', 'exists:users,id'],
            'senior_present' => ['required', 'boolean'],
            'senior_joined_at' => ['nullable', 'date_format:H:i'],
            'presence_minutes' => ['nullable', 'integer', 'between:0,600'],
            'all_patients_reviewed' => ['required', 'boolean'],
            'mgmt_plan_documented' => ['required', 'boolean'],
            'vte_assessed' => ['required', 'boolean'],
            'discharge_discussed' => ['required', 'boolean'],
            'med_review_done' => ['required', 'boolean'],
            'critical_labs_reviewed' => ['required', 'boolean'],
            'pct_patients_seen' => ['nullable', 'integer', 'between:0,100'],
            'round_delayed' => ['required', 'boolean'],
            'mdt_participants' => ['nullable', 'array'],
            'mdt_participants.*' => ['string', Rule::in(self::MDT_PARTICIPANTS)],
            'system_issues' => ['nullable', 'array'],
            'system_issues.*' => ['string', Rule::in(self::SYSTEM_ISSUES)],
            'comment' => ['nullable', 'string', 'max:2000'],
        ])->validate();

        $subject = User::query()->findOrFail($validated['subject_id']);
        if ($subject->role_key !== 'consultant') {
            throw ValidationException::withMessages([
                'subjectId' => 'The selected subject must be a consultant.',
            ]);
        }

        $placement = $this->assertPairedPlacement($request->user(), $subject, $validated['evaluation_date']);

        // Authorization in depth: the policy re-checks the same pairing rule.
        Gate::authorize('create', [ConsultantEvaluation::class, $subject, $validated['evaluation_date']]);

        $evaluation = ConsultantEvaluation::query()->create([
            'author_id' => $request->user()->id,
            'subject_id' => $subject->id,
            'ward_id' => $placement['legacy_ward_id'],
            'ward_ref_id' => $placement['ward_ref_id'],
            'placement_type' => $placement['placement_type'],
            'evaluation_date' => $validated['evaluation_date'],
            'senior_present' => $validated['senior_present'],
            'senior_joined_at' => $validated['senior_joined_at'] ?? null,
            'presence_minutes' => $validated['presence_minutes'] ?? null,
            'all_patients_reviewed' => $validated['all_patients_reviewed'],
            'mgmt_plan_documented' => $validated['mgmt_plan_documented'],
            'vte_assessed' => $validated['vte_assessed'],
            'discharge_discussed' => $validated['discharge_discussed'],
            'med_review_done' => $validated['med_review_done'],
            'critical_labs_reviewed' => $validated['critical_labs_reviewed'],
            'pct_patients_seen' => $validated['pct_patients_seen'] ?? null,
            'round_delayed' => $validated['round_delayed'],
            'mdt_participants' => $validated['mdt_participants'] ?? [],
            'system_issues' => $validated['system_issues'] ?? [],
            'comment' => $validated['comment'] ?? null,
        ]);

        return response()->json($this->serializeConsultantEvaluation($evaluation), 201);
    }

    public function storeResidentEvaluation(Request $request): JsonResponse
    {
        Gate::authorize('create', ResidentEvaluation::class);

        // Direction guard: only a consultant evaluates a resident.
        if ($request->user()->role_key !== 'consultant') {
            throw ValidationException::withMessages([
                'subjectId' => 'Only consultants may submit resident evaluations.',
            ]);
        }

        $validated = Validator::make($this->normalize($request), [
            'evaluation_date' => ['required', 'date', 'before_or_equal:today'],
            // Accepted for backwards compatibility but IGNORED: the ward is
            // snapshotted server-side from the shared duty placement.
            'ward_id' => ['sometimes', 'nullable', 'uuid'],
            'subject_id' => ['required', 'uuid', 'exists:users,id'],
            'on_time' => ['required', 'boolean'],
            'prepared' => ['required', 'boolean'],
            'presentation_clear' => ['required', 'boolean'],
            'clinical_reasoning' => ['required', 'boolean'],
            'management_plan' => ['required', 'boolean'],
            'documentation_timely' => ['required', 'boolean'],
            'communication' => ['required', 'boolean'],
            'professional' => ['required', 'boolean'],
            'responsive_feedback' => ['required', 'boolean'],
            'follow_through' => ['required', 'boolean'],
            'overall_rating' => ['required', 'integer', 'between:1,5'],
            'concerns' => ['nullable', 'array'],
            'concerns.*' => ['string', Rule::in(self::CONCERNS)],
            'comment' => ['nullable', 'string', 'max:2000'],
        ])->validate();

        $subject = User::query()->findOrFail($validated['subject_id']);
        if ($subject->role_key !== 'resident') {
            throw ValidationException::withMessages([
                'subjectId' => 'The selected subject must be a resident.',
            ]);
        }

        $placement = $this->assertPairedPlacement($request->user(), $subject, $validated['evaluation_date']);

        // Authorization in depth: the policy re-checks the same pairing rule.
        Gate::authorize('create', [ResidentEvaluation::class, $subject, $validated['evaluation_date']]);

        $evaluation = ResidentEvaluation::query()->create([
            'author_id' => $request->user()->id,
            'subject_id' => $subject->id,
            'ward_id' => $placement['legacy_ward_id'],
            'ward_ref_id' => $placement['ward_ref_id'],
            'placement_type' => $placement['placement_type'],
            'evaluation_date' => $validated['evaluation_date'],
            'on_time' => $validated['on_time'],
            'prepared' => $validated['prepared'],
            'presentation_clear' => $validated['presentation_clear'],
            'clinical_reasoning' => $validated['clinical_reasoning'],
            'management_plan' => $validated['management_plan'],
            'documentation_timely' => $validated['documentation_timely'],
            'communication' => $validated['communication'],
            'professional' => $validated['professional'],
            'responsive_feedback' => $validated['responsive_feedback'],
            'follow_through' => $validated['follow_through'],
            'overall_rating' => $validated['overall_rating'],
            'concerns' => $validated['concerns'] ?? [],
            'comment' => $validated['comment'] ?? null,
        ]);

        return response()->json($this->serializeResidentEvaluation($evaluation), 201);
    }

    public function mySubmissions(Request $request): JsonResponse
    {
        // Second authz layer (the route also enforces permission:academic.submit).
        Gate::authorize('create', ConsultantEvaluation::class);

        $user = $request->user();

        if ($user->role_key === 'resident') {
            $data = ConsultantEvaluation::query()
                ->where('author_id', $user->id)
                ->with(['author', 'subject', 'ward'])
                ->orderByDesc('evaluation_date')
                ->orderByDesc('created_at')
                ->get()
                ->map(fn (ConsultantEvaluation $evaluation) => $this->serializeConsultantEvaluation($evaluation));

            return response()->json(['direction' => 'consultant', 'data' => $data->values()]);
        }

        if ($user->role_key === 'consultant') {
            $data = ResidentEvaluation::query()
                ->where('author_id', $user->id)
                ->with(['author', 'subject', 'ward'])
                ->orderByDesc('evaluation_date')
                ->orderByDesc('created_at')
                ->get()
                ->map(fn (ResidentEvaluation $evaluation) => $this->serializeResidentEvaluation($evaluation));

            return response()->json(['direction' => 'resident', 'data' => $data->values()]);
        }

        return response()->json(['direction' => null, 'data' => []]);
    }

    /**
     * The authenticated resident/consultant's OWN received-evaluation summary.
     * Aggregates only (average score, indicator compliance, rating) — never the
     * identity of individual evaluators. subject_id is taken from the session, so
     * a user can only ever see their own performance.
     */
    public function myPerformance(Request $request): JsonResponse
    {
        Gate::authorize('create', ConsultantEvaluation::class);

        $user = $request->user();

        // A resident is the subject of ResidentEvaluations; a consultant of
        // ConsultantEvaluations. Anyone else has nothing to show.
        $direction = match ($user->role_key) {
            'resident' => 'resident',
            'consultant' => 'consultant',
            default => null,
        };

        if ($direction === null) {
            return response()->json(['direction' => null, 'summary' => null, 'trend' => null]);
        }

        $filters = new AcademicAnalyticsFilters(direction: $direction, subjectId: $user->id);

        return response()->json([
            'direction' => $direction,
            'summary' => $this->analytics->summary($filters),
            'trend' => $this->analytics->trend($filters),
        ]);
    }

    /**
     * The Phase 3 eligibility rule: author and subject must share a pairing
     * key (same ward, or same pairing group such as OPD) on the evaluation
     * date. Returns the resolved placement snapshot to store on the row.
     *
     * @return array{ward_ref_id: ?string, placement_type: string, legacy_ward_id: ?string}
     */
    private function assertPairedPlacement(User $author, User $subject, string $date): array
    {
        $placement = $this->roster->sharedPlacementFor($author, $subject, Carbon::parse($date));

        if ($placement === null) {
            throw ValidationException::withMessages([
                'subjectId' => 'You and this person were not assigned to the same ward or duty on that date.',
            ]);
        }

        return $placement;
    }

    private function oppositeRole(string $roleKey): ?string
    {
        return match ($roleKey) {
            'resident' => 'consultant',
            'consultant' => 'resident',
            default => null,
        };
    }

    /**
     * Accept snake_case AND camelCase input by normalizing every top-level key to
     * snake_case (the canonical column names), then validating the one form. The
     * multi-select values are plain strings, so only keys need converting.
     *
     * @return array<string, mixed>
     */
    private function normalize(Request $request): array
    {
        $data = [];
        foreach ($request->all() as $key => $value) {
            $data[Str::snake($key)] = $value;
        }

        return $data;
    }
}
