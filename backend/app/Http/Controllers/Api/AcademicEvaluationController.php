<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Api\Concerns\SerializesAdminResources;
use App\Http\Controllers\Controller;
use App\Models\ConsultantEvaluation;
use App\Models\Evaluation;
use App\Models\EvaluationForm;
use App\Models\ResidentEvaluation;
use App\Models\Student;
use App\Models\SubgroupPlacement;
use App\Models\User;
use App\Models\Ward;
use App\Services\Academic\AcademicAnalyticsFilters;
use App\Services\Academic\AcademicAnalyticsService;
use App\Services\Academic\EvaluationFormService;
use App\Services\Academic\RosterService;
use App\Services\Admin\AdminAuditService;
use App\Support\HospitalClock;
use Closure;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Facades\Validator;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

/**
 * Peer evaluations, backed by the Phase 4 form engine: validation rules come
 * from the published form definition (admins edit forms without a developer),
 * answers land in the unified evaluations tables, and eligibility runs
 * through the roster (Phase 3). The legacy per-direction policy classes still
 * carry the authorization rules.
 */
class AcademicEvaluationController extends Controller
{
    use SerializesAdminResources;

    /** Raised by the in-transaction pre-check and by the unique-key backstop. */
    private const DUPLICATE_SUBMISSION_MESSAGE = 'You have already submitted this evaluation for that person on that date.';

    public function __construct(
        private readonly AcademicAnalyticsService $analytics,
        private readonly RosterService $roster,
        private readonly EvaluationFormService $forms,
        private readonly AdminAuditService $auditService,
    ) {}

    /**
     * Record that an evaluation was submitted - who, about whom, which form,
     * for which date. Deliberately NOT the answers: the trail exists to prove
     * a submission happened and to catch a mis-addressed one, and anyone
     * holding audit.view should not thereby read peer feedback content. The
     * answers stay in the evaluations tables behind the academic policies.
     */
    private function auditEvaluationSubmission(
        Request $request,
        string $entityType,
        Evaluation $evaluation,
        string $formKey,
        string $subjectName,
    ): void {
        $this->auditService->record(
            $request->user(),
            'submit',
            $entityType,
            $evaluation->id,
            null,
            [
                'formKey' => $formKey,
                'subjectName' => $subjectName,
                'evaluationDate' => $evaluation->evaluation_date?->toDateString(),
            ],
            $request,
        );
    }

    public function formOptions(Request $request): JsonResponse
    {
        // Second authz layer (the route also enforces permission:academic.submit).
        Gate::authorize('create', ConsultantEvaluation::class);

        $today = HospitalClock::today()->toDateString();
        $validated = $request->validate([
            'date' => ['sometimes', 'date', "before_or_equal:{$today}"],
        ]);

        $user = $request->user();
        $date = isset($validated['date']) ? Carbon::parse($validated['date']) : HospitalClock::today();
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

    /** The published form definition the submit UI renders from. */
    public function form(Request $request, string $key): JsonResponse
    {
        Gate::authorize('create', ConsultantEvaluation::class);

        // All four forms: consultants render the student forms on the
        // teaching page through this same endpoint.
        if (! in_array($key, EvaluationForm::KEYS, true)) {
            throw ValidationException::withMessages([
                'key' => ['Unknown evaluation form.'],
            ]);
        }

        return response()->json($this->serializeEvaluationForm($this->forms->published($key)));
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

        return $this->storeThroughForm($request, 'consultant_mdt', 'consultant', ConsultantEvaluation::class);
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

        return $this->storeThroughForm($request, 'resident_acgme', 'resident', ResidentEvaluation::class);
    }

    public function mySubmissions(Request $request): JsonResponse
    {
        // Second authz layer (the route also enforces permission:academic.submit).
        Gate::authorize('create', ConsultantEvaluation::class);

        $user = $request->user();

        $direction = match ($user->role_key) {
            'resident' => 'consultant',
            'consultant' => 'resident',
            default => null,
        };

        if ($direction === null) {
            return response()->json(['direction' => null, 'data' => []]);
        }

        $data = Evaluation::query()
            ->forKey($direction === 'consultant' ? 'consultant_mdt' : 'resident_acgme')
            ->where('author_id', $user->id)
            ->with(['author', 'subject', 'ward', 'answers'])
            ->orderByDesc('evaluation_date')
            ->orderByDesc('created_at')
            ->get()
            ->map(fn (Evaluation $evaluation) => $direction === 'consultant'
                ? $this->serializeConsultantEvaluation($evaluation)
                : $this->serializeResidentEvaluation($evaluation));

        return response()->json(['direction' => $direction, 'data' => $data->values()]);
    }

    /**
     * The authenticated resident/consultant's OWN received-evaluation summary.
     * Aggregates only (average score, indicator compliance, rating) - never the
     * identity of individual evaluators. subject_id is taken from the session, so
     * a user can only ever see their own performance.
     */
    public function myPerformance(Request $request): JsonResponse
    {
        Gate::authorize('create', ConsultantEvaluation::class);

        $user = $request->user();

        // A resident is the subject of resident_acgme rows; a consultant of
        // consultant_mdt rows. Anyone else has nothing to show.
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
     * Students a consultant can evaluate (V2 Phase 5). Deliberately NOT
     * ward-gated: consultants teach across the undergraduate program, so any
     * consultant may evaluate any active student. The current placement is
     * context, shown on the form and snapshotted at submission.
     */
    public function students(Request $request): JsonResponse
    {
        Gate::authorize('create', ConsultantEvaluation::class);

        if ($request->user()->role_key !== 'consultant') {
            return response()->json(['data' => []]);
        }

        $today = HospitalClock::today()->toDateString();

        $students = Student::query()
            ->with('batch')
            ->where('active', true)
            ->whereHas('batch', fn ($query) => $query->where('active', true))
            ->orderBy('full_name')
            ->get();

        $placements = SubgroupPlacement::query()
            ->with('ward')
            ->whereDate('week_starts_on', '<=', $today)
            ->whereDate('week_ends_on', '>=', $today)
            ->get()
            ->keyBy(fn (SubgroupPlacement $placement) => $placement->batch_id.'|'.$placement->subgroup);

        return response()->json([
            'data' => $students->map(function (Student $student) use ($placements) {
                $placement = $student->subgroup !== null
                    ? $placements->get($student->batch_id.'|'.$student->subgroup)
                    : null;

                return [
                    'id' => $student->id,
                    'fullName' => $student->full_name,
                    'batchLabel' => $student->batch?->label,
                    'cohort' => $student->batch?->cohort,
                    'subgroup' => $student->subgroup,
                    'currentWardName' => $placement?->ward?->name,
                ];
            })->values(),
        ]);
    }

    /**
     * A consultant evaluates a student through the Phase 4 form engine
     * (student_weekly at the end of each ward placement, student_final at
     * the end of the attachment). One-way by design: there is no route by
     * which a student or a rep evaluates anyone.
     */
    public function storeStudentEvaluation(Request $request): JsonResponse
    {
        Gate::authorize('create', ConsultantEvaluation::class);

        if ($request->user()->role_key !== 'consultant') {
            throw ValidationException::withMessages([
                'subjectId' => 'Only consultants may evaluate students.',
            ]);
        }

        $formKey = $request->input('formKey', $request->input('form_key'));

        if (! in_array($formKey, ['student_weekly', 'student_final'], true)) {
            throw ValidationException::withMessages([
                'formKey' => 'Choose the weekly or the final student evaluation.',
            ]);
        }

        $form = $this->forms->published($formKey);

        // Form rules spread FIRST so the header rules always win: a form
        // field sharing a header key must not weaken its validation.
        $today = HospitalClock::today()->toDateString();
        $validated = Validator::make($this->normalize($request), [
            ...$this->forms->validationRulesFor($form),
            'evaluation_date' => ['required', 'date', "before_or_equal:{$today}"],
            'student_id' => ['required', 'uuid', 'exists:students,id'],
        ])->validate();

        $student = Student::query()->findOrFail($validated['student_id']);
        $date = Carbon::parse($validated['evaluation_date']);

        // Snapshot the student's placement for that week (null when none:
        // the evaluation still stands, unplaced).
        $placement = $student->subgroup === null ? null : SubgroupPlacement::query()
            ->where('batch_id', $student->batch_id)
            ->where('subgroup', $student->subgroup)
            ->whereDate('week_starts_on', '<=', $date->toDateString())
            ->whereDate('week_ends_on', '>=', $date->toDateString())
            ->first();

        $evaluation = $this->submitGuardingUniqueness(function () use ($form, $formKey, $validated, $request, $student, $placement, $date): Evaluation {
            $this->assertNotAlreadySubmitted(
                $request->user()->id,
                'subject_student_id',
                $student->id,
                $validated['evaluation_date'],
                $formKey,
            );

            return $this->forms->store($form, $validated, [
                'author_id' => $request->user()->id,
                'subject_student_id' => $student->id,
                'evaluation_date' => $validated['evaluation_date'],
                'ward_id' => $placement?->ward_id,
                'placement_type' => $placement !== null ? 'ward' : null,
                'week_starts_on' => $formKey === 'student_weekly'
                    ? ($placement?->week_starts_on?->toDateString() ?? $date->copy()->startOfWeek()->toDateString())
                    : null,
            ]);
        });

        $this->auditEvaluationSubmission(
            $request,
            'student_evaluation',
            $evaluation,
            $formKey,
            $student->full_name,
        );

        return response()->json($this->serializeStudentEvaluation($evaluation), 201);
    }

    private function storeThroughForm(Request $request, string $formKey, string $direction, string $policyClass): JsonResponse
    {
        $form = $this->forms->published($formKey);

        // Form rules spread FIRST so the header rules always win: a form
        // field sharing a header key must not weaken its validation.
        $today = HospitalClock::today()->toDateString();
        $validated = Validator::make($this->normalize($request), [
            ...$this->forms->validationRulesFor($form),
            'evaluation_date' => ['required', 'date', "before_or_equal:{$today}"],
            // Accepted for backwards compatibility but IGNORED: the ward is
            // snapshotted server-side from the shared duty placement.
            'ward_id' => ['sometimes', 'nullable', 'uuid'],
            'subject_id' => ['required', 'uuid', 'exists:users,id'],
        ])->validate();

        $subject = User::query()->findOrFail($validated['subject_id']);
        $expectedRole = $direction === 'consultant' ? 'consultant' : 'resident';

        if ($subject->role_key !== $expectedRole) {
            throw ValidationException::withMessages([
                'subjectId' => "The selected subject must be a {$expectedRole}.",
            ]);
        }

        $placement = $this->assertPairedPlacement($request->user(), $subject, $validated['evaluation_date']);

        // Authorization in depth: the policy re-checks the same pairing rule.
        Gate::authorize('create', [$policyClass, $subject, $validated['evaluation_date']]);

        $evaluation = $this->submitGuardingUniqueness(function () use ($form, $formKey, $validated, $request, $subject, $placement): Evaluation {
            $this->assertNotAlreadySubmitted(
                $request->user()->id,
                'subject_user_id',
                $subject->id,
                $validated['evaluation_date'],
                $formKey,
            );

            return $this->forms->store($form, $validated, [
                'author_id' => $request->user()->id,
                'subject_user_id' => $subject->id,
                'evaluation_date' => $validated['evaluation_date'],
                'ward_id' => $placement['ward_ref_id'],
                'placement_type' => $placement['placement_type'],
            ]);
        });

        $this->auditEvaluationSubmission(
            $request,
            $direction === 'consultant' ? 'consultant_evaluation' : 'resident_evaluation',
            $evaluation,
            $formKey,
            $subject->full_name,
        );

        return response()->json(
            $direction === 'consultant'
                ? $this->serializeConsultantEvaluation($evaluation)
                : $this->serializeResidentEvaluation($evaluation),
            201,
        );
    }

    /**
     * Run a submission and translate the unique-key backstop into the same 422
     * the pre-check raises. assertNotAlreadySubmitted() is a plain read that
     * takes no lock and, with no row yet to lock, cannot serialise two
     * overlapping submissions (a double-click, or a client retry after a
     * timeout): both pass the check, and the loser hits
     * evaluations_author_subject_date_form_unique. Nothing maps that to a
     * response, so without this it surfaces as a 500.
     *
     * @param  \Closure(): Evaluation  $submit
     */
    private function submitGuardingUniqueness(Closure $submit): Evaluation
    {
        try {
            return DB::transaction($submit);
        } catch (UniqueConstraintViolationException) {
            throw ValidationException::withMessages([
                'subjectId' => self::DUPLICATE_SUBMISSION_MESSAGE,
            ]);
        }
    }

    /**
     * One author evaluates one subject once per date per form. Analytics
     * weights every row equally, so an unguarded repeat is an extra vote on
     * someone's performance record rather than a harmless duplicate.
     *
     * The database carries the same rule as a unique key; this check runs in
     * the same transaction as the insert so the key stays a backstop and
     * callers see a validation message instead of a 500.
     *
     * @param  'subject_user_id'|'subject_student_id'  $subjectColumn
     */
    private function assertNotAlreadySubmitted(
        string $authorId,
        string $subjectColumn,
        string $subjectId,
        string $date,
        string $formKey,
    ): void {
        $exists = Evaluation::query()
            ->where('author_id', $authorId)
            ->where($subjectColumn, $subjectId)
            ->whereDate('evaluation_date', $date)
            ->where('form_key', $formKey)
            ->exists();

        if ($exists) {
            throw ValidationException::withMessages([
                'subjectId' => self::DUPLICATE_SUBMISSION_MESSAGE,
            ]);
        }
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
     * snake_case (the canonical field keys), then validating the one form. The
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
