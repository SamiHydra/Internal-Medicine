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
use App\Support\HospitalClock;
use Illuminate\Database\QueryException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
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

    public function showBatch(StudentBatch $batch): JsonResponse
    {
        Gate::authorize('viewAny', TeachingSession::class);

        return response()->json($this->serializeBatch($batch->loadCount('students')));
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

        $batch = DB::transaction(function () use ($batch, $validated, $request): StudentBatch {
            $locked = StudentBatch::query()->lockForUpdate()->findOrFail($batch->id);

            // Cross-field check against the locked EFFECTIVE pair: an
            // inverted range would silently stop session generation.
            $effectiveStart = Carbon::parse($validated['startsOn'] ?? $locked->starts_on);
            $effectiveEnd = Carbon::parse($validated['endsOn'] ?? $locked->ends_on);

            if ($effectiveEnd->lessThanOrEqualTo($effectiveStart)) {
                throw ValidationException::withMessages([
                    'endsOn' => ['The batch end date must be after its start date.'],
                ]);
            }

            $old = $this->serializeBatch($locked);
            $locked->forceFill([
                ...(isset($validated['label']) ? ['label' => $validated['label']] : []),
                ...(isset($validated['startsOn']) ? ['starts_on' => $validated['startsOn']] : []),
                ...(isset($validated['endsOn']) ? ['ends_on' => $validated['endsOn']] : []),
                ...(array_key_exists('active', $validated) ? ['active' => (bool) $validated['active']] : []),
            ])->save();

            if (! $locked->active) {
                RepAssignment::query()
                    ->where('batch_id', $locked->id)
                    ->where('active', true)
                    ->lockForUpdate()
                    ->get()
                    ->each->forceFill(['active' => false])->each->save();
            }

            $locked->refresh();
            $this->auditService->record($request->user(), 'update', 'student_batch', $locked->id, $old, $this->serializeBatch($locked), $request);

            return $locked;
        });

        // serializeBatch reads students_count, which route-model binding does
        // not load. Without this the response reports studentCount 0 and any
        // client that trusts it shows an empty batch.
        return response()->json($this->serializeBatch($batch->loadCount('students')));
    }

    /** Historical batches are retained; DELETE performs an audited deactivation. */
    public function destroyBatch(Request $request, StudentBatch $batch): JsonResponse
    {
        Gate::authorize('manage', TeachingSession::class);

        DB::transaction(function () use ($batch, $request): void {
            $locked = StudentBatch::query()->lockForUpdate()->findOrFail($batch->id);
            $old = $this->serializeBatch($locked->loadCount('students'));
            $locked->forceFill(['active' => false])->save();

            RepAssignment::query()
                ->where('batch_id', $locked->id)
                ->where('active', true)
                ->lockForUpdate()
                ->get()
                ->each->forceFill(['active' => false])->each->save();

            $this->auditService->record($request->user(), 'deactivate', 'student_batch', $locked->id, $old, $this->serializeBatch($locked), $request);
        });

        return response()->json(null, 204);
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

    public function showStudent(Student $student): JsonResponse
    {
        Gate::authorize('viewAny', TeachingSession::class);

        return response()->json($this->serializeStudent($student->load('batch')));
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

    /** Historical attendance/evaluations remain linked; DELETE deactivates. */
    public function destroyStudent(Request $request, Student $student): JsonResponse
    {
        Gate::authorize('manage', TeachingSession::class);

        $old = $this->serializeStudent($student->load('batch'));
        $student->forceFill(['active' => false])->save();

        $this->auditService->record($request->user(), 'deactivate', 'student', $student->id, $old, $this->serializeStudent($student), $request);

        return response()->json(null, 204);
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

    public function showPlacement(SubgroupPlacement $placement): JsonResponse
    {
        Gate::authorize('viewAny', TeachingSession::class);

        return response()->json($this->serializePlacement($placement->load(['ward', 'batch'])));
    }

    public function updatePlacement(Request $request, SubgroupPlacement $placement): JsonResponse
    {
        Gate::authorize('manage', TeachingSession::class);

        $validated = $request->validate([
            'wardId' => ['sometimes', 'uuid', Rule::exists('wards', 'id')],
            'weekStartsOn' => ['sometimes', 'date'],
        ]);

        $weekStart = isset($validated['weekStartsOn'])
            ? Carbon::parse($validated['weekStartsOn'])->startOfWeek()
            : $placement->week_starts_on->copy();
        $weekEnd = $weekStart->copy()->endOfWeek();

        $duplicate = SubgroupPlacement::query()
            ->where('batch_id', $placement->batch_id)
            ->where('subgroup', $placement->subgroup)
            ->whereDate('week_starts_on', $weekStart->toDateString())
            ->where('id', '!=', $placement->id)
            ->exists();

        if ($duplicate) {
            throw ValidationException::withMessages([
                'weekStartsOn' => ['That subgroup already has a placement for this week.'],
            ]);
        }

        $old = $this->serializePlacement($placement->load(['ward', 'batch']));
        $oldWeekStart = $placement->week_starts_on->copy();
        $oldWeekEnd = $placement->week_ends_on->copy();

        $placement->forceFill([
            'ward_id' => $validated['wardId'] ?? $placement->ward_id,
            'week_starts_on' => $weekStart->toDateString(),
            'week_ends_on' => $weekEnd->toDateString(),
        ])->save();
        $placement->refresh()->load(['ward', 'batch']);

        $this->teachingService->generateRange($oldWeekStart, $oldWeekEnd);
        if (! $oldWeekStart->equalTo($weekStart)) {
            $this->teachingService->generateRange($weekStart, $weekEnd);
        }

        $this->auditService->record($request->user(), 'update', 'subgroup_placement', $placement->id, $old, $this->serializePlacement($placement), $request);

        return response()->json($this->serializePlacement($placement));
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
                ->map(fn (TeachingActivitySchedule $schedule) => $this->serializeSchedule($schedule)),
        ]);
    }

    public function storeSchedule(Request $request): JsonResponse
    {
        Gate::authorize('manage', TeachingSession::class);

        $validated = $request->validate([
            'cohort' => ['required', Rule::in(StudentBatch::COHORTS)],
            'activityType' => ['required', Rule::in(TeachingActivitySchedule::ACTIVITY_TYPES)],
            'weekday' => ['required', 'integer', 'between:1,7'],
            'scope' => ['required', Rule::in(['cohort', 'subgroup'])],
            'active' => ['sometimes', 'boolean'],
        ]);
        $this->assertScheduleScope($validated['activityType'], $validated['scope']);

        $duplicate = TeachingActivitySchedule::query()
            ->where('cohort', $validated['cohort'])
            ->where('activity_type', $validated['activityType'])
            ->where('weekday', $validated['weekday'])
            ->exists();

        if ($duplicate) {
            throw ValidationException::withMessages([
                'weekday' => ['That cohort already has this activity on the selected weekday.'],
            ]);
        }

        $schedule = TeachingActivitySchedule::query()->create([
            'cohort' => $validated['cohort'],
            'activity_type' => $validated['activityType'],
            'weekday' => $validated['weekday'],
            'scope' => $validated['scope'],
            'active' => $validated['active'] ?? true,
        ]);
        $today = HospitalClock::today();
        $this->teachingService->generateRange($today, $today->copy()->addDays(7));
        $this->auditService->record($request->user(), 'create', 'teaching_activity_schedule', $schedule->id, null, $this->serializeSchedule($schedule), $request);

        return response()->json($this->serializeSchedule($schedule), 201);
    }

    public function showSchedule(TeachingActivitySchedule $schedule): JsonResponse
    {
        Gate::authorize('viewAny', TeachingSession::class);

        return response()->json($this->serializeSchedule($schedule));
    }

    public function updateSchedule(Request $request, TeachingActivitySchedule $schedule): JsonResponse
    {
        Gate::authorize('manage', TeachingSession::class);

        $validated = $request->validate([
            'cohort' => ['sometimes', Rule::in(StudentBatch::COHORTS)],
            'activityType' => ['sometimes', Rule::in(TeachingActivitySchedule::ACTIVITY_TYPES)],
            'weekday' => ['sometimes', 'integer', 'between:1,7'],
            'scope' => ['sometimes', Rule::in(['cohort', 'subgroup'])],
            'active' => ['sometimes', 'boolean'],
        ]);

        $cohort = $validated['cohort'] ?? $schedule->cohort;
        $activityType = $validated['activityType'] ?? $schedule->activity_type;
        $weekday = $validated['weekday'] ?? $schedule->weekday;
        $scope = $validated['scope'] ?? $schedule->scope;
        $this->assertScheduleScope($activityType, $scope);

        $duplicate = TeachingActivitySchedule::query()
            ->where('cohort', $cohort)
            ->where('activity_type', $activityType)
            ->where('weekday', $weekday)
            ->where('id', '!=', $schedule->id)
            ->exists();

        if ($duplicate) {
            throw ValidationException::withMessages([
                'weekday' => ['That cohort already has this activity on the selected weekday.'],
            ]);
        }

        $old = $this->serializeSchedule($schedule);
        $schedule->forceFill([
            'cohort' => $cohort,
            'activity_type' => $activityType,
            'weekday' => $weekday,
            'scope' => $scope,
            'active' => array_key_exists('active', $validated) ? (bool) $validated['active'] : $schedule->active,
        ])->save();
        $today = HospitalClock::today();
        $this->teachingService->generateRange($today, $today->copy()->addDays(7));
        $this->auditService->record($request->user(), 'update', 'teaching_activity_schedule', $schedule->id, $old, $this->serializeSchedule($schedule), $request);

        return response()->json($this->serializeSchedule($schedule));
    }

    public function setScheduleActive(Request $request, TeachingActivitySchedule $schedule): JsonResponse
    {
        Gate::authorize('manage', TeachingSession::class);

        $validated = $request->validate(['active' => ['required', 'boolean']]);

        $schedule->forceFill(['active' => (bool) $validated['active']])->save();

        // A program change affects the days ahead; regenerate the coming week.
        $today = HospitalClock::today();
        $this->teachingService->generateRange($today, $today->copy()->addDays(7));

        $this->auditService->record($request->user(), 'set_active', 'teaching_activity_schedule', $schedule->id, null, [
            'active' => (bool) $validated['active'],
        ], $request);

        return response()->json(['id' => $schedule->id, 'active' => (bool) $schedule->active]);
    }

    /** Historical sessions retain the schedule context; DELETE deactivates. */
    public function destroySchedule(Request $request, TeachingActivitySchedule $schedule): JsonResponse
    {
        Gate::authorize('manage', TeachingSession::class);

        $old = $this->serializeSchedule($schedule);
        $schedule->forceFill(['active' => false])->save();
        $today = HospitalClock::today();
        $this->teachingService->generateRange($today, $today->copy()->addDays(7));
        $this->auditService->record($request->user(), 'deactivate', 'teaching_activity_schedule', $schedule->id, $old, $this->serializeSchedule($schedule), $request);

        return response()->json(null, 204);
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

        $assignment = $this->mutateRepAssignment(function () use ($validated, $request): RepAssignment {
            $this->lockRepBatches([$validated['batchId']]);
            $this->assertActiveBatchForRep($validated['batchId']);
            $user = User::query()->lockForUpdate()->findOrFail($validated['userId']);
            $this->assertEligibleRep($user);

            $assignment = RepAssignment::query()
                ->where('user_id', $user->id)
                ->where('batch_id', $validated['batchId'])
                ->where('scope', $validated['scope'])
                ->lockForUpdate()
                ->first();

            $this->assertActiveRepScopeAvailable(
                $validated['batchId'],
                $validated['scope'],
                $assignment?->id,
            );
            $this->assertActiveRepUserAvailable($user->id, $assignment?->id);

            if ($assignment !== null && $assignment->active) {
                return $assignment->load(['user', 'batch']);
            }

            if ($assignment === null) {
                $assignment = RepAssignment::query()->create([
                    'user_id' => $user->id,
                    'batch_id' => $validated['batchId'],
                    'scope' => $validated['scope'],
                    'active' => true,
                ]);
            } else {
                $assignment->forceFill(['active' => true])->save();
            }

            $assignment->load(['user', 'batch']);
            $this->auditService->record($request->user(), 'create', 'rep_assignment', $assignment->id, null, $this->serializeRepAssignment($assignment), $request);

            return $assignment;
        });

        return response()->json($this->serializeRepAssignment($assignment), 201);
    }

    public function showRepAssignment(RepAssignment $repAssignment): JsonResponse
    {
        Gate::authorize('viewAny', TeachingSession::class);

        return response()->json($this->serializeRepAssignment($repAssignment->load(['user', 'batch'])));
    }

    public function updateRepAssignment(Request $request, RepAssignment $repAssignment): JsonResponse
    {
        Gate::authorize('manage', TeachingSession::class);

        $validated = $request->validate([
            'userId' => ['sometimes', 'uuid', Rule::exists('users', 'id')],
            'batchId' => ['sometimes', 'uuid', Rule::exists('student_batches', 'id')],
            'scope' => ['sometimes', Rule::in(RepAssignment::SCOPES)],
            'active' => ['sometimes', 'boolean'],
        ]);

        $initialBatchIds = array_values(array_unique([
            $repAssignment->batch_id,
            $validated['batchId'] ?? $repAssignment->batch_id,
        ]));

        $repAssignment = $this->mutateRepAssignment(function () use ($repAssignment, $validated, $initialBatchIds, $request): RepAssignment {
            $this->lockRepBatches($initialBatchIds);
            $locked = RepAssignment::query()->lockForUpdate()->findOrFail($repAssignment->id);
            $this->assertRepAssignmentBatchIsFresh($locked, $initialBatchIds);

            $userId = $validated['userId'] ?? $locked->user_id;
            $batchId = $validated['batchId'] ?? $locked->batch_id;
            $scope = $validated['scope'] ?? $locked->scope;
            $active = array_key_exists('active', $validated) ? (bool) $validated['active'] : $locked->active;
            $user = User::query()->lockForUpdate()->findOrFail($userId);
            $this->assertEligibleRep($user);

            $duplicate = RepAssignment::query()
                ->where('user_id', $userId)
                ->where('batch_id', $batchId)
                ->where('scope', $scope)
                ->whereKeyNot($locked->id)
                ->lockForUpdate()
                ->first();

            if ($duplicate !== null) {
                throw ValidationException::withMessages([
                    'scope' => ['That representative already has this batch and scope assignment.'],
                ]);
            }

            if ($active) {
                $this->assertActiveBatchForRep($batchId);
                $this->assertActiveRepScopeAvailable($batchId, $scope, $locked->id);
                $this->assertActiveRepUserAvailable($userId, $locked->id);
            }

            $old = $this->serializeRepAssignment($locked->load(['user', 'batch']));
            $locked->forceFill([
                'user_id' => $userId,
                'batch_id' => $batchId,
                'scope' => $scope,
                'active' => $active,
            ])->save();
            $locked->refresh()->load(['user', 'batch']);
            $this->auditService->record($request->user(), 'update', 'rep_assignment', $locked->id, $old, $this->serializeRepAssignment($locked), $request);

            return $locked;
        });

        return response()->json($this->serializeRepAssignment($repAssignment));
    }

    public function setRepAssignmentActive(Request $request, RepAssignment $repAssignment): JsonResponse
    {
        Gate::authorize('manage', TeachingSession::class);

        $validated = $request->validate(['active' => ['required', 'boolean']]);

        $repAssignment = $this->mutateRepAssignment(function () use ($repAssignment, $validated, $request): RepAssignment {
            $initialBatchId = $repAssignment->batch_id;
            $this->lockRepBatches([$initialBatchId]);
            $locked = RepAssignment::query()->lockForUpdate()->findOrFail($repAssignment->id);
            $this->assertRepAssignmentBatchIsFresh($locked, [$initialBatchId]);

            $active = (bool) $validated['active'];
            if ($active) {
                $this->assertActiveBatchForRep($locked->batch_id);
                $user = User::query()->lockForUpdate()->findOrFail($locked->user_id);
                $this->assertEligibleRep($user);
                $this->assertActiveRepScopeAvailable($locked->batch_id, $locked->scope, $locked->id);
                $this->assertActiveRepUserAvailable($locked->user_id, $locked->id);
            }

            if ($locked->active !== $active) {
                $locked->forceFill(['active' => $active])->save();
                $this->auditService->record($request->user(), 'set_active', 'rep_assignment', $locked->id, null, [
                    'active' => $active,
                ], $request);
            }

            return $locked->refresh()->load(['user', 'batch']);
        });

        return response()->json($this->serializeRepAssignment($repAssignment));
    }

    /** Historical logs retain the assignment row; DELETE deactivates it. */
    public function destroyRepAssignment(Request $request, RepAssignment $repAssignment): JsonResponse
    {
        Gate::authorize('manage', TeachingSession::class);

        $this->mutateRepAssignment(function () use ($repAssignment, $request): void {
            $initialBatchId = $repAssignment->batch_id;
            $this->lockRepBatches([$initialBatchId]);
            $locked = RepAssignment::query()->lockForUpdate()->findOrFail($repAssignment->id);
            $this->assertRepAssignmentBatchIsFresh($locked, [$initialBatchId]);

            if (! $locked->active) {
                return;
            }

            $old = $this->serializeRepAssignment($locked->load(['user', 'batch']));
            $locked->forceFill(['active' => false])->save();
            $this->auditService->record($request->user(), 'deactivate', 'rep_assignment', $locked->id, $old, $this->serializeRepAssignment($locked), $request);
        });

        return response()->json(null, 204);
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

    private function serializeSchedule(TeachingActivitySchedule $schedule): array
    {
        return [
            'id' => $schedule->id,
            'cohort' => $schedule->cohort,
            'activityType' => $schedule->activity_type,
            'weekday' => $schedule->weekday,
            'scope' => $schedule->scope,
            'active' => (bool) $schedule->active,
        ];
    }

    private function assertScheduleScope(string $activityType, string $scope): void
    {
        $requiredScope = in_array($activityType, ['lecture', 'seminar'], true)
            ? 'cohort'
            : 'subgroup';

        if ($scope !== $requiredScope) {
            throw ValidationException::withMessages([
                'scope' => ["{$activityType} activities require {$requiredScope} scope."],
            ]);
        }
    }

    /**
     * @template T
     *
     * @param  callable(): T  $mutation
     * @return T
     */
    private function mutateRepAssignment(callable $mutation): mixed
    {
        try {
            return DB::transaction($mutation, 3);
        } catch (QueryException $exception) {
            $message = strtolower($exception->getMessage());
            if (! str_contains($message, 'unique') && ! str_contains($message, 'duplicate entry')) {
                throw $exception;
            }

            if (str_contains($message, 'active_user')) {
                throw ValidationException::withMessages([
                    'userId' => ['This representative already has an active assignment.'],
                ]);
            }

            throw ValidationException::withMessages([
                'scope' => ['This batch and scope already has an active representative.'],
            ]);
        }
    }

    /** @param list<string> $batchIds */
    private function lockRepBatches(array $batchIds): void
    {
        StudentBatch::query()
            ->whereIn('id', array_values(array_unique($batchIds)))
            ->orderBy('id')
            ->lockForUpdate()
            ->get();
    }

    /** @param list<string> $lockedBatchIds */
    private function assertRepAssignmentBatchIsFresh(RepAssignment $assignment, array $lockedBatchIds): void
    {
        if (! in_array($assignment->batch_id, $lockedBatchIds, true)) {
            throw ValidationException::withMessages([
                'assignment' => ['This representative assignment changed while it was being edited. Reload it and try again.'],
            ]);
        }
    }

    private function assertEligibleRep(User $user): void
    {
        if ($user->role_key !== 'student_rep' || ! $user->active) {
            throw ValidationException::withMessages([
                'userId' => ['Rep assignments require an active student representative account.'],
            ]);
        }
    }

    private function assertActiveBatchForRep(string $batchId): void
    {
        if (! StudentBatch::query()->whereKey($batchId)->where('active', true)->exists()) {
            throw ValidationException::withMessages([
                'batchId' => ['Representative assignments can be activated only for an active batch.'],
            ]);
        }
    }

    private function assertActiveRepScopeAvailable(string $batchId, string $scope, ?string $exceptId = null): void
    {
        $conflict = RepAssignment::query()
            ->where('batch_id', $batchId)
            ->where('scope', $scope)
            ->where('active', true)
            ->when($exceptId !== null, fn ($query) => $query->whereKeyNot($exceptId))
            ->lockForUpdate()
            ->first();

        if ($conflict !== null) {
            throw ValidationException::withMessages([
                'scope' => ['This batch and scope already has an active representative.'],
            ]);
        }
    }

    private function assertActiveRepUserAvailable(string $userId, ?string $exceptId = null): void
    {
        $conflict = RepAssignment::query()
            ->where('user_id', $userId)
            ->where('active', true)
            ->when($exceptId !== null, fn ($query) => $query->whereKeyNot($exceptId))
            ->lockForUpdate()
            ->first();

        if ($conflict !== null) {
            throw ValidationException::withMessages([
                'userId' => ['This representative already has an active assignment.'],
            ]);
        }
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
