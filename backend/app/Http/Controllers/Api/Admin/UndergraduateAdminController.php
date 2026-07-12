<?php

namespace App\Http\Controllers\Api\Admin;

use App\Http\Controllers\Controller;
use App\Models\RepAssignment;
use App\Models\Student;
use App\Models\StudentBatch;
use App\Models\SubgroupPlacement;
use App\Models\TeachingActivitySchedule;
use App\Models\TeachingSession;
use App\Models\User;
use App\Services\Academic\TeachingService;
use App\Services\Admin\AdminAuditService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Gate;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

/**
 * Admin management of the undergraduate module (V2 Phase 5): batches,
 * student rosters (with paste import), weekly subgroup placements, rep
 * assignments, the activity schedule, and the teaching-session oversight
 * board. Placement and schedule edits regenerate the affected pending
 * sessions so the reps' log stays truthful.
 */
class UndergraduateAdminController extends Controller
{
    public function __construct(
        private readonly TeachingService $teachingService,
        private readonly AdminAuditService $auditService,
    ) {}

    // ---- Batches ----

    public function batches(): JsonResponse
    {
        Gate::authorize('viewAny', TeachingSession::class);

        return response()->json([
            'data' => StudentBatch::query()
                ->withCount('students')
                ->orderByDesc('starts_on')
                ->get()
                ->map(fn (StudentBatch $batch) => $this->serializeBatch($batch)),
        ]);
    }

    public function storeBatch(Request $request): JsonResponse
    {
        Gate::authorize('manage', TeachingSession::class);

        $validated = $request->validate([
            'cohort' => ['required', Rule::in(StudentBatch::COHORTS)],
            'label' => ['required', 'string', 'max:64', Rule::unique('student_batches', 'label')],
            'startsOn' => ['required', 'date'],
            'endsOn' => ['required', 'date', 'after:startsOn'],
        ]);

        $batch = StudentBatch::query()->create([
            'cohort' => $validated['cohort'],
            'label' => $validated['label'],
            'starts_on' => $validated['startsOn'],
            'ends_on' => $validated['endsOn'],
        ]);

        $this->auditService->record($request->user(), 'create', 'student_batch', $batch->id, null, $this->serializeBatch($batch), $request);

        return response()->json($this->serializeBatch($batch), 201);
    }

    public function updateBatch(Request $request, StudentBatch $batch): JsonResponse
    {
        Gate::authorize('manage', TeachingSession::class);

        $validated = $request->validate([
            'label' => ['sometimes', 'string', 'max:64', Rule::unique('student_batches', 'label')->ignore($batch->id)],
            'startsOn' => ['sometimes', 'date'],
            'endsOn' => ['sometimes', 'date'],
            'active' => ['sometimes', 'boolean'],
        ]);

        // Cross-field check against the EFFECTIVE pair (validated value or the
        // stored one): an inverted range would silently stop every session
        // generation for the batch.
        $effectiveStart = Carbon::parse($validated['startsOn'] ?? $batch->starts_on);
        $effectiveEnd = Carbon::parse($validated['endsOn'] ?? $batch->ends_on);

        if ($effectiveEnd->lessThanOrEqualTo($effectiveStart)) {
            throw ValidationException::withMessages([
                'endsOn' => ['The batch end date must be after its start date.'],
            ]);
        }

        $old = $this->serializeBatch($batch);
        $batch->forceFill([
            ...(isset($validated['label']) ? ['label' => $validated['label']] : []),
            ...(isset($validated['startsOn']) ? ['starts_on' => $validated['startsOn']] : []),
            ...(isset($validated['endsOn']) ? ['ends_on' => $validated['endsOn']] : []),
            ...(array_key_exists('active', $validated) ? ['active' => (bool) $validated['active']] : []),
        ])->save();
        $batch->refresh();

        $this->auditService->record($request->user(), 'update', 'student_batch', $batch->id, $old, $this->serializeBatch($batch), $request);

        return response()->json($this->serializeBatch($batch));
    }

    // ---- Students ----

    public function students(Request $request): JsonResponse
    {
        Gate::authorize('viewAny', TeachingSession::class);

        $validated = $request->validate([
            'batchId' => ['sometimes', 'uuid'],
        ]);

        return response()->json([
            'data' => Student::query()
                ->with('batch')
                ->when(isset($validated['batchId']), fn ($query) => $query->where('batch_id', $validated['batchId']))
                ->orderBy('full_name')
                ->get()
                ->map(fn (Student $student) => $this->serializeStudent($student)),
        ]);
    }

    public function storeStudent(Request $request): JsonResponse
    {
        Gate::authorize('manage', TeachingSession::class);

        $validated = $request->validate([
            'batchId' => ['required', 'uuid', Rule::exists('student_batches', 'id')],
            'fullName' => ['required', 'string', 'max:255'],
            'externalId' => ['sometimes', 'nullable', 'string', 'max:64'],
            'subgroup' => ['sometimes', 'nullable', Rule::in(['A', 'B'])],
        ]);

        $student = Student::query()->create([
            'batch_id' => $validated['batchId'],
            'full_name' => $validated['fullName'],
            'external_id' => $validated['externalId'] ?? null,
            'subgroup' => $validated['subgroup'] ?? null,
        ]);

        $this->auditService->record($request->user(), 'create', 'student', $student->id, null, $this->serializeStudent($student), $request);

        return response()->json($this->serializeStudent($student), 201);
    }

    public function updateStudent(Request $request, Student $student): JsonResponse
    {
        Gate::authorize('manage', TeachingSession::class);

        $validated = $request->validate([
            'fullName' => ['sometimes', 'string', 'max:255'],
            'externalId' => ['sometimes', 'nullable', 'string', 'max:64'],
            'subgroup' => ['sometimes', 'nullable', Rule::in(['A', 'B'])],
            'active' => ['sometimes', 'boolean'],
        ]);

        $old = $this->serializeStudent($student);
        $student->forceFill([
            ...(isset($validated['fullName']) ? ['full_name' => $validated['fullName']] : []),
            ...(array_key_exists('externalId', $validated) ? ['external_id' => $validated['externalId']] : []),
            ...(array_key_exists('subgroup', $validated) ? ['subgroup' => $validated['subgroup']] : []),
            ...(array_key_exists('active', $validated) ? ['active' => (bool) $validated['active']] : []),
        ])->save();
        $student->refresh();

        $this->auditService->record($request->user(), 'update', 'student', $student->id, $old, $this->serializeStudent($student), $request);

        return response()->json($this->serializeStudent($student));
    }

    /**
     * Paste import: one student per line, `Full Name[,external_id][,A|B]`.
     * Commas inside names are not supported (the registrar list is
     * name-first), which keeps the format explainable on the page itself.
     */
    public function importStudents(Request $request): JsonResponse
    {
        Gate::authorize('manage', TeachingSession::class);

        $validated = $request->validate([
            'batchId' => ['required', 'uuid', Rule::exists('student_batches', 'id')],
            'csv' => ['required', 'string', 'max:100000'],
        ]);

        $created = 0;
        $skipped = 0;

        // One roster read up front (a paste can be hundreds of lines); the
        // sets grow as lines create students so in-payload duplicates dedupe
        // exactly like pre-existing rows.
        $roster = Student::query()
            ->where('batch_id', $validated['batchId'])
            ->get(['external_id', 'full_name']);
        $knownExternalIds = $roster->pluck('external_id')->filter()->flip();
        $knownNames = $roster->pluck('full_name')->flip();

        foreach (preg_split('/\r\n|\r|\n/', $validated['csv']) as $line) {
            $parts = array_map('trim', explode(',', $line));
            $fullName = $parts[0] ?? '';

            if ($fullName === '') {
                continue;
            }

            $subgroup = null;
            $externalId = null;

            foreach (array_slice($parts, 1) as $part) {
                if (in_array(strtoupper($part), ['A', 'B'], true)) {
                    $subgroup = strtoupper($part);
                } elseif ($part !== '') {
                    $externalId = $part;
                }
            }

            // Dedupe by registrar id when the line carries one (two distinct
            // students can share a name); name-only is the fallback.
            $exists = $externalId !== null
                ? $knownExternalIds->has($externalId)
                : $knownNames->has($fullName);

            if ($exists) {
                $skipped++;

                continue;
            }

            Student::query()->create([
                'batch_id' => $validated['batchId'],
                'full_name' => $fullName,
                'external_id' => $externalId,
                'subgroup' => $subgroup,
            ]);
            $created++;

            if ($externalId !== null) {
                $knownExternalIds->put($externalId, true);
            }
            $knownNames->put($fullName, true);
        }

        $this->auditService->record($request->user(), 'import', 'student', $validated['batchId'], null, [
            'created' => $created,
            'skipped' => $skipped,
        ], $request);

        return response()->json(['created' => $created, 'skipped' => $skipped], 201);
    }

    // ---- Subgroup placements ----

    public function placements(Request $request): JsonResponse
    {
        Gate::authorize('viewAny', TeachingSession::class);

        $validated = $request->validate([
            'batchId' => ['sometimes', 'uuid'],
        ]);

        return response()->json([
            'data' => SubgroupPlacement::query()
                ->with(['ward', 'batch'])
                ->when(isset($validated['batchId']), fn ($query) => $query->where('batch_id', $validated['batchId']))
                ->orderByDesc('week_starts_on')
                ->limit(200)
                ->get()
                ->map(fn (SubgroupPlacement $placement) => $this->serializePlacement($placement)),
        ]);
    }

    public function storePlacement(Request $request): JsonResponse
    {
        Gate::authorize('manage', TeachingSession::class);

        $validated = $request->validate([
            'batchId' => ['required', 'uuid', Rule::exists('student_batches', 'id')],
            'subgroup' => ['required', Rule::in(['A', 'B'])],
            'wardId' => ['required', 'uuid', Rule::exists('wards', 'id')],
            'weekStartsOn' => ['required', 'date'],
        ]);

        $weekStart = Carbon::parse($validated['weekStartsOn'])->startOfWeek();
        $weekEnd = $weekStart->copy()->endOfWeek();

        // Weekly movement is manual and one ward per subgroup-week: saving a
        // week again re-points it.
        $placement = SubgroupPlacement::query()->updateOrCreate(
            [
                'batch_id' => $validated['batchId'],
                'subgroup' => $validated['subgroup'],
                'week_starts_on' => $weekStart->toDateString(),
            ],
            [
                'ward_id' => $validated['wardId'],
                'week_ends_on' => $weekEnd->toDateString(),
                'created_by' => $request->user()->id,
            ],
        );

        // Re-snapshot the week's pending sessions to the (possibly new) ward.
        $this->teachingService->generateRange($weekStart, $weekEnd);

        $this->auditService->record($request->user(), 'save', 'subgroup_placement', $placement->id, null, $this->serializePlacement($placement->load(['ward', 'batch'])), $request);

        return response()->json($this->serializePlacement($placement), 201);
    }

    public function destroyPlacement(Request $request, SubgroupPlacement $placement): JsonResponse
    {
        Gate::authorize('manage', TeachingSession::class);

        $old = $this->serializePlacement($placement->load(['ward', 'batch']));
        $weekStart = $placement->week_starts_on->copy();
        $weekEnd = $placement->week_ends_on->copy();
        $placement->delete();

        // Mirror storePlacement: the week's pending sessions re-snapshot
        // (to no ward now), so the reps' log stays truthful.
        $this->teachingService->generateRange($weekStart, $weekEnd);

        $this->auditService->record($request->user(), 'delete', 'subgroup_placement', $placement->id, $old, null, $request);

        return response()->json(null, 204);
    }

    // ---- Activity schedules ----

    public function schedules(): JsonResponse
    {
        Gate::authorize('viewAny', TeachingSession::class);

        return response()->json([
            'data' => TeachingActivitySchedule::query()
                ->orderBy('cohort')
                ->orderBy('weekday')
                ->get()
                ->map(fn (TeachingActivitySchedule $schedule) => [
                    'id' => $schedule->id,
                    'cohort' => $schedule->cohort,
                    'activityType' => $schedule->activity_type,
                    'weekday' => $schedule->weekday,
                    'scope' => $schedule->scope,
                    'active' => (bool) $schedule->active,
                ]),
        ]);
    }

    public function setScheduleActive(Request $request, TeachingActivitySchedule $schedule): JsonResponse
    {
        Gate::authorize('manage', TeachingSession::class);

        $validated = $request->validate(['active' => ['required', 'boolean']]);

        $schedule->forceFill(['active' => (bool) $validated['active']])->save();

        // A program change affects the days ahead; regenerate the coming week.
        $this->teachingService->generateRange(now(), now()->addDays(7));

        $this->auditService->record($request->user(), 'set_active', 'teaching_activity_schedule', $schedule->id, null, [
            'active' => (bool) $validated['active'],
        ], $request);

        return response()->json(['id' => $schedule->id, 'active' => (bool) $schedule->active]);
    }

    // ---- Rep assignments ----

    public function repAssignments(): JsonResponse
    {
        Gate::authorize('viewAny', TeachingSession::class);

        return response()->json([
            'data' => RepAssignment::query()
                ->with(['user', 'batch'])
                ->orderByDesc('created_at')
                ->get()
                ->map(fn (RepAssignment $assignment) => $this->serializeRepAssignment($assignment)),
        ]);
    }

    public function storeRepAssignment(Request $request): JsonResponse
    {
        Gate::authorize('manage', TeachingSession::class);

        $validated = $request->validate([
            'userId' => ['required', 'uuid', Rule::exists('users', 'id')],
            'batchId' => ['required', 'uuid', Rule::exists('student_batches', 'id')],
            'scope' => ['required', Rule::in(RepAssignment::SCOPES)],
        ]);

        $user = User::query()->findOrFail($validated['userId']);

        if ($user->role_key !== 'student_rep' || ! $user->active) {
            throw ValidationException::withMessages([
                'userId' => ['Rep assignments require an active student representative account.'],
            ]);
        }

        $assignment = RepAssignment::query()->updateOrCreate(
            ['user_id' => $user->id, 'batch_id' => $validated['batchId'], 'scope' => $validated['scope']],
            ['active' => true],
        );
        $assignment->load(['user', 'batch']);

        $this->auditService->record($request->user(), 'create', 'rep_assignment', $assignment->id, null, $this->serializeRepAssignment($assignment), $request);

        return response()->json($this->serializeRepAssignment($assignment), 201);
    }

    public function setRepAssignmentActive(Request $request, RepAssignment $repAssignment): JsonResponse
    {
        Gate::authorize('manage', TeachingSession::class);

        $validated = $request->validate(['active' => ['required', 'boolean']]);

        $repAssignment->forceFill(['active' => (bool) $validated['active']])->save();

        $this->auditService->record($request->user(), 'set_active', 'rep_assignment', $repAssignment->id, null, [
            'active' => (bool) $validated['active'],
        ], $request);

        return response()->json($this->serializeRepAssignment($repAssignment->load(['user', 'batch'])));
    }

    // ---- Session oversight ----

    public function sessions(Request $request): JsonResponse
    {
        Gate::authorize('viewAny', TeachingSession::class);

        $validated = $request->validate([
            'batchId' => ['sometimes', 'uuid'],
            'status' => ['sometimes', Rule::in(TeachingSession::STATUSES)],
            'dateFrom' => ['sometimes', 'date'],
            'dateTo' => ['sometimes', 'date'],
        ]);

        return response()->json([
            'data' => TeachingSession::query()
                ->with(['ward', 'batch', 'recordedBy'])
                ->withCount('attendance')
                ->when(isset($validated['batchId']), fn ($query) => $query->where('batch_id', $validated['batchId']))
                ->when(isset($validated['status']), fn ($query) => $query->where('status', $validated['status']))
                ->when(isset($validated['dateFrom']), fn ($query) => $query->whereDate('scheduled_date', '>=', $validated['dateFrom']))
                ->when(isset($validated['dateTo']), fn ($query) => $query->whereDate('scheduled_date', '<=', $validated['dateTo']))
                ->orderByDesc('scheduled_date')
                ->limit(300)
                ->get()
                ->map(fn (TeachingSession $session) => [
                    'id' => $session->id,
                    'batchLabel' => $session->batch?->label,
                    'cohort' => $session->batch?->cohort,
                    'subgroup' => $session->subgroup,
                    'activityType' => $session->activity_type,
                    'scheduledDate' => $session->scheduled_date?->toDateString(),
                    'wardName' => $session->ward?->name,
                    'status' => $session->status,
                    'reason' => $session->reason,
                    'recordedByName' => $session->recordedBy?->full_name,
                    'attendanceCount' => (int) ($session->attendance_count ?? 0),
                ]),
        ]);
    }

    /** Cancelled sessions (holidays, exam weeks) never distort occurrence stats. */
    public function cancelSession(Request $request, TeachingSession $teachingSession): JsonResponse
    {
        Gate::authorize('manage', TeachingSession::class);

        $validated = $request->validate([
            'reason' => ['required', 'string', 'max:1000'],
        ]);

        $session = $this->teachingService->record($teachingSession, 'cancelled', $validated['reason'], $request->user());

        $this->auditService->record($request->user(), 'cancel', 'teaching_session', $session->id, null, [
            'reason' => $validated['reason'],
        ], $request);

        return response()->json(['id' => $session->id, 'status' => $session->status]);
    }

    // ---- Serialization ----

    private function serializeBatch(StudentBatch $batch): array
    {
        return [
            'id' => $batch->id,
            'cohort' => $batch->cohort,
            'label' => $batch->label,
            'startsOn' => $batch->starts_on?->toDateString(),
            'endsOn' => $batch->ends_on?->toDateString(),
            'active' => (bool) $batch->active,
            'studentCount' => (int) ($batch->students_count ?? 0),
        ];
    }

    private function serializeStudent(Student $student): array
    {
        return [
            'id' => $student->id,
            'batchId' => $student->batch_id,
            'batchLabel' => $student->batch?->label,
            'fullName' => $student->full_name,
            'externalId' => $student->external_id,
            'subgroup' => $student->subgroup,
            'active' => (bool) $student->active,
        ];
    }

    private function serializePlacement(SubgroupPlacement $placement): array
    {
        return [
            'id' => $placement->id,
            'batchId' => $placement->batch_id,
            'batchLabel' => $placement->batch?->label,
            'subgroup' => $placement->subgroup,
            'wardId' => $placement->ward_id,
            'wardName' => $placement->ward?->name,
            'weekStartsOn' => $placement->week_starts_on?->toDateString(),
            'weekEndsOn' => $placement->week_ends_on?->toDateString(),
        ];
    }

    private function serializeRepAssignment(RepAssignment $assignment): array
    {
        return [
            'id' => $assignment->id,
            'userId' => $assignment->user_id,
            'userName' => $assignment->user?->full_name,
            'batchId' => $assignment->batch_id,
            'batchLabel' => $assignment->batch?->label,
            'scope' => $assignment->scope,
            'active' => (bool) $assignment->active,
        ];
    }
}
