<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\MorningRosterOverride;
use App\Models\MorningSession;
use App\Models\User;
use App\Services\Academic\MorningSessionService;
use App\Services\Admin\AdminAuditService;
use App\Support\HospitalClock;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;
use Illuminate\Validation\Rule;

/**
 * Morning sessions (V2 Phase 6). The recorder surface (today + record) sits
 * under /academic; the oversight surface (list, correction, cancel, roster
 * overrides) under /admin. The form is deliberately minimal: one on-time
 * toggle, the actual start when off, one present toggle per expected person.
 */
class MorningSessionController extends Controller
{
    public function __construct(
        private readonly MorningSessionService $morningSessions,
        private readonly AdminAuditService $auditService,
    ) {}

    /** Today's session with the auto-generated roster (or recorded snapshot). */
    public function today(Request $request): JsonResponse
    {
        Gate::authorize('viewToday', MorningSession::class);

        $today = HospitalClock::today();
        $session = MorningSession::query()
            ->whereDate('session_date', $today->toDateString())
            ->first();

        // Only someone allowed to operate the recorder surface may trigger the
        // lazy-open fallback. Other academics receive a safe availability state
        // without creating data or seeing the expected-person roster.
        if (
            $session === null
            && ($this->morningSessions->isRecorder($request->user())
                || $request->user()->can('manage', MorningSession::class))
        ) {
            $session = $this->morningSessions->openFor($today);
        }

        if ($session === null) {
            return response()->json([
                'session' => null,
                'isSessionDay' => $this->morningSessions->isSessionDay($today),
                'canRecord' => false,
            ]);
        }

        $canRecord = $request->user()->can('record', $session);

        return response()->json([
            'session' => $this->serialize($session, withPeople: $canRecord),
            'isSessionDay' => true,
            'canRecord' => $canRecord,
        ]);
    }

    public function record(Request $request, MorningSession $morningSession): JsonResponse
    {
        Gate::authorize('record', $morningSession);

        $validated = $request->validate([
            'startedOnTime' => ['required', 'boolean'],
            'actualStartAt' => ['sometimes', 'nullable', 'regex:/^\d{2}:\d{2}$/'],
            // `present` (not required): everyone-absent is a legal recording.
            'presence' => ['present', 'array'],
            'presence.*' => ['boolean'],
        ]);

        $session = $this->morningSessions->record(
            $morningSession,
            (bool) $validated['startedOnTime'],
            $validated['actualStartAt'] ?? null,
            $validated['presence'],
            $request->user(),
        );

        // The primary daily write, and previously the only morning path with
        // no trail: a correction was audited but the original recording was
        // not, so "who first said this started late" was unanswerable.
        $presence = $validated['presence'];
        $this->auditService->record(
            $request->user(),
            'record',
            'morning_session',
            $session->id,
            null,
            [
                'sessionDate' => $session->session_date?->toDateString(),
                'startedOnTime' => $session->started_on_time,
                'actualStartAt' => $session->actual_start_at !== null
                    ? substr((string) $session->actual_start_at, 0, 5)
                    : null,
                'delayMinutes' => $session->delayMinutes(),
                'presentCount' => count(array_filter($presence)),
                'expectedCount' => count($presence),
            ],
            $request,
        );

        return response()->json($this->serialize($session, withPeople: true));
    }

    // ---- Admin oversight ----

    public function index(Request $request): JsonResponse
    {
        Gate::authorize('viewAny', MorningSession::class);

        $validated = $request->validate([
            'status' => ['sometimes', Rule::in(MorningSession::STATUSES)],
            'dateFrom' => ['sometimes', 'date'],
            'dateTo' => ['sometimes', 'date'],
        ]);

        $sessions = MorningSession::query()
            ->with('recordedBy')
            ->withCount(['attendance', 'attendance as present_count' => fn ($query) => $query->where('present', true)])
            ->when(isset($validated['status']), fn ($query) => $query->where('status', $validated['status']))
            ->when(isset($validated['dateFrom']), fn ($query) => $query->whereDate('session_date', '>=', $validated['dateFrom']))
            ->when(isset($validated['dateTo']), fn ($query) => $query->whereDate('session_date', '<=', $validated['dateTo']))
            ->orderByDesc('session_date')
            ->limit(120)
            ->get();

        return response()->json([
            'data' => $sessions->map(fn (MorningSession $session) => $this->serialize($session)),
        ]);
    }

    /** Admin correction of a recorded (or missed) session, any day. */
    public function update(Request $request, MorningSession $morningSession): JsonResponse
    {
        Gate::authorize('manage', $morningSession);

        $validated = $request->validate([
            'startedOnTime' => ['required', 'boolean'],
            'actualStartAt' => ['sometimes', 'nullable', 'regex:/^\d{2}:\d{2}$/'],
            'presence' => ['present', 'array'],
            'presence.*' => ['boolean'],
        ]);

        $before = $this->serialize($morningSession);

        $session = $this->morningSessions->record(
            $morningSession,
            (bool) $validated['startedOnTime'],
            $validated['actualStartAt'] ?? null,
            $validated['presence'],
            $request->user(),
        );

        $this->auditService->record($request->user(), 'correct', 'morning_session', $session->id, $before, $this->serialize($session), $request);

        return response()->json($this->serialize($session, withPeople: true));
    }

    public function cancel(Request $request, MorningSession $morningSession): JsonResponse
    {
        Gate::authorize('cancel', $morningSession);

        $validated = $request->validate([
            'reason' => ['required', 'string', 'max:1000'],
        ]);

        $session = DB::transaction(function () use ($morningSession, $validated, $request): MorningSession {
            $result = $this->morningSessions->cancel($morningSession, $validated['reason'], $request->user());

            if ($result['transitioned']) {
                $this->auditService->record($request->user(), 'cancel', 'morning_session', $result['session']->id, null, [
                    'reason' => trim($validated['reason']),
                ], $request);
            }

            return $result['session'];
        });

        return response()->json($this->serialize($session));
    }

    // ---- Roster overrides (admin) ----

    public function overrides(): JsonResponse
    {
        Gate::authorize('viewAny', MorningSession::class);

        return response()->json([
            'data' => MorningRosterOverride::query()
                ->with('user')
                ->orderByDesc('created_at')
                ->limit(100)
                ->get()
                ->map(fn (MorningRosterOverride $override) => [
                    'id' => $override->id,
                    'userId' => $override->user_id,
                    'userName' => $override->user?->full_name,
                    'action' => $override->action,
                    'startsOn' => $override->starts_on?->toDateString(),
                    'endsOn' => $override->ends_on?->toDateString(),
                ]),
        ]);
    }

    public function storeOverride(Request $request): JsonResponse
    {
        Gate::authorize('manage', MorningSession::class);

        $validated = $request->validate([
            'userId' => ['required', 'uuid', Rule::exists('users', 'id')],
            'action' => ['required', Rule::in(['include', 'exclude'])],
            'startsOn' => ['required', 'date'],
            'endsOn' => ['sometimes', 'nullable', 'date', 'after_or_equal:startsOn'],
        ]);

        $override = MorningRosterOverride::query()->create([
            'user_id' => $validated['userId'],
            'action' => $validated['action'],
            'starts_on' => $validated['startsOn'],
            'ends_on' => $validated['endsOn'] ?? null,
            'created_by' => $request->user()->id,
        ]);

        $this->auditService->record($request->user(), 'create', 'morning_roster_override', $override->id, null, [
            'userId' => $override->user_id,
            'action' => $override->action,
            'startsOn' => $override->starts_on?->toDateString(),
            'endsOn' => $override->ends_on?->toDateString(),
        ], $request);

        return response()->json(['id' => $override->id], 201);
    }

    public function destroyOverride(Request $request, MorningRosterOverride $override): JsonResponse
    {
        Gate::authorize('manage', MorningSession::class);

        $override->delete();

        $this->auditService->record($request->user(), 'delete', 'morning_roster_override', $override->id, [
            'userId' => $override->user_id,
            'action' => $override->action,
        ], null, $request);

        return response()->json(null, 204);
    }

    /**
     * @return array<string, mixed>
     */
    private function serialize(MorningSession $session, bool $withPeople = false): array
    {
        $payload = [
            'id' => $session->id,
            'sessionDate' => $session->session_date?->toDateString(),
            'scheduledStartAt' => substr((string) $session->scheduled_start_at, 0, 5),
            'actualStartAt' => $session->actual_start_at !== null ? substr((string) $session->actual_start_at, 0, 5) : null,
            'startedOnTime' => $session->started_on_time,
            'status' => $session->status,
            'reason' => $session->reason,
            'delayMinutes' => $session->delayMinutes(),
            'recordedByName' => $session->recordedBy?->full_name,
            'recordedAt' => $session->recorded_at?->toJSON(),
            'attendanceCount' => (int) ($session->attendance_count ?? 0),
            'presentCount' => (int) ($session->present_count ?? 0),
        ];

        if ($withPeople) {
            if ($session->status === 'recorded') {
                // The snapshot, immune to later roster changes.
                $payload['people'] = $session->attendance()
                    ->with('user')
                    ->get()
                    ->sortBy(fn ($row) => $row->user?->full_name)
                    ->map(fn ($row) => [
                        'userId' => $row->user_id,
                        'fullName' => $row->user?->full_name,
                        'role' => $row->user?->role_key,
                        'present' => (bool) $row->present,
                    ])
                    ->values();
            } else {
                $payload['people'] = $this->morningSessions->roster($session->session_date)
                    ->map(fn (User $user) => [
                        'userId' => $user->id,
                        'fullName' => $user->full_name,
                        'role' => $user->role_key,
                        'present' => null,
                    ])
                    ->values();
            }
        }

        return $payload;
    }
}
