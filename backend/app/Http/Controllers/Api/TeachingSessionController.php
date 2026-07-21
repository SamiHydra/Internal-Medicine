<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\RepAssignment;
use App\Models\Student;
use App\Models\TeachingSession;
use App\Services\Academic\TeachingService;
use App\Services\Admin\AdminAuditService;
use App\Support\HospitalClock;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Gate;
use Illuminate\Validation\Rule;

/**
 * The undergraduate teaching surfaces (V2 Phase 5): the rep's held / not-held
 * log and the consultant's per-student attendance. Reps reach ONLY this
 * controller; the absence of any academic permission on the student_rep role
 * keeps every evaluation surface out of reach.
 */
class TeachingSessionController extends Controller
{
    public function __construct(
        private readonly TeachingService $teachingService,
        private readonly AdminAuditService $auditService,
    ) {}

    /** The rep's sessions for this week, limited to their recording scope. */
    public function mySessions(Request $request): JsonResponse
    {
        Gate::authorize('viewMine', TeachingSession::class);

        $assignments = RepAssignment::query()
            ->with('batch')
            ->where('user_id', $request->user()->id)
            ->where('active', true)
            ->whereHas('batch', fn ($query) => $query->where('active', true))
            ->get();

        if ($assignments->isEmpty()) {
            return response()->json(['data' => [], 'scope' => null]);
        }

        $weekStart = HospitalClock::today()->startOfWeek();
        $weekEnd = HospitalClock::today()->endOfWeek();

        $sessions = collect();

        foreach ($assignments as $assignment) {
            $sessions = $sessions->concat(
                TeachingSession::query()
                    ->with(['ward', 'batch'])
                    ->where('batch_id', $assignment->batch_id)
                    ->whereIn('activity_type', $assignment->recordableActivities())
                    ->when(
                        $assignment->scope === 'group',
                        fn (Builder $query) => $query->whereNull('subgroup'),
                        fn (Builder $query) => $query->where('subgroup', $assignment->subgroup()),
                    )
                    ->whereDate('scheduled_date', '>=', $weekStart->toDateString())
                    ->whereDate('scheduled_date', '<=', $weekEnd->toDateString())
                    ->orderBy('scheduled_date')
                    ->get(),
            );
        }

        // Cleanup normally removes obsolete pending rows when an admin edits
        // the schedule. Keep this read boundary defensive against an
        // out-of-band write or an interrupted reconciliation, while retaining
        // already-recorded history.
        $sessions = $sessions->filter(fn (TeachingSession $session) => $session->status !== 'pending'
            || $this->teachingService->isBackedByActiveSchedule($session));

        $first = $assignments->first();

        return response()->json([
            'scope' => [
                'batchId' => $first->batch_id,
                'batchLabel' => $first->batch?->label,
                'cohort' => $first->batch?->cohort,
                'scope' => $first->scope,
            ],
            'data' => $sessions
                ->unique('id')
                ->sortBy('scheduled_date')
                ->map(fn (TeachingSession $session) => $this->serializeSession($session))
                ->values(),
        ]);
    }

    /** A rep records whether the activity happened; a reason is required when it did not. */
    public function record(Request $request, TeachingSession $teachingSession): JsonResponse
    {
        Gate::authorize('record', $teachingSession);

        $validated = $request->validate([
            'status' => ['required', Rule::in(['held', 'not_held'])],
            'reason' => ['sometimes', 'nullable', 'string', 'max:1000'],
        ]);

        $previousStatus = $teachingSession->status;

        $session = $this->teachingService->record(
            $teachingSession,
            $validated['status'],
            $validated['reason'] ?? null,
            $request->user(),
        );

        // A not-held record is the start of a follow-up conversation, so the
        // reason and who gave it need to survive a later re-record.
        $this->auditService->record(
            $request->user(),
            'record',
            'teaching_session',
            $session->id,
            ['status' => $previousStatus],
            [
                'status' => $session->status,
                'reason' => $session->reason,
                'activityType' => $session->activity_type,
                'scheduledDate' => $session->scheduled_date?->toDateString(),
                'batchLabel' => $session->batch?->label,
                'subgroup' => $session->subgroup,
            ],
            $request,
        );

        return response()->json($this->serializeSession($session));
    }

    /** Today's sessions for the consultant recording attendance, rosters included. */
    public function today(Request $request): JsonResponse
    {
        Gate::authorize('viewToday', TeachingSession::class);

        $today = HospitalClock::today();
        $sessions = TeachingSession::query()
            ->with(['ward', 'batch', 'attendance'])
            ->whereDate('scheduled_date', $today->toDateString())
            ->whereIn('status', ['pending', 'held'])
            ->orderBy('activity_type')
            ->get()
            ->filter(fn (TeachingSession $session) => $session->status !== 'pending'
                || $this->teachingService->isBackedByActiveSchedule($session));

        return response()->json([
            'data' => $sessions->map(function (TeachingSession $session) {
                $recorded = $session->attendance->keyBy('student_id');

                return [
                    ...$this->serializeSession($session),
                    'roster' => $this->teachingService->rosterFor($session)->map(fn (Student $student) => [
                        'id' => $student->id,
                        'fullName' => $student->full_name,
                        'subgroup' => $student->subgroup,
                        'present' => $recorded->has($student->id)
                            ? (bool) $recorded[$student->id]->present
                            : null,
                    ])->values(),
                ];
            })->values(),
        ]);
    }

    /** The consultant who taught marks each student present or absent. */
    public function attendance(Request $request, TeachingSession $teachingSession): JsonResponse
    {
        Gate::authorize('recordAttendance', $teachingSession);

        $validated = $request->validate([
            'presence' => ['required', 'array', 'min:1'],
            'presence.*' => ['boolean'],
        ]);

        $session = $this->teachingService->recordAttendance(
            $teachingSession,
            $validated['presence'],
            $request->user(),
        );

        // Counts rather than the per-student map: attendance drives a student's
        // final result, so the trail records that a consultant marked the room
        // and how many were in it, while the roster itself stays in
        // student_attendance where it can be corrected.
        $presence = $validated['presence'];
        $this->auditService->record(
            $request->user(),
            'record_attendance',
            'teaching_session',
            $session->id,
            null,
            [
                'activityType' => $session->activity_type,
                'scheduledDate' => $session->scheduled_date?->toDateString(),
                'batchLabel' => $session->batch?->label,
                'subgroup' => $session->subgroup,
                'presentCount' => count(array_filter($presence)),
                'rosterCount' => count($presence),
            ],
            $request,
        );

        return response()->json($this->serializeSession($session));
    }

    /**
     * @return array<string, mixed>
     */
    private function serializeSession(TeachingSession $session): array
    {
        $session->loadMissing(['ward', 'batch']);

        return [
            'id' => $session->id,
            'batchId' => $session->batch_id,
            'batchLabel' => $session->batch?->label,
            'cohort' => $session->batch?->cohort,
            'subgroup' => $session->subgroup,
            'activityType' => $session->activity_type,
            'scheduledDate' => $session->scheduled_date?->toDateString(),
            'wardId' => $session->ward_id,
            'wardName' => $session->ward?->name,
            'status' => $session->status,
            'reason' => $session->reason,
            'recordedAt' => $session->recorded_at?->toJSON(),
        ];
    }
}
