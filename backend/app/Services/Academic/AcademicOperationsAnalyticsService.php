<?php

namespace App\Services\Academic;

use App\Models\Evaluation;
use App\Models\MorningAttendance;
use App\Models\MorningSession;
use App\Models\Student;
use App\Models\StudentAttendance;
use App\Models\StudentBatch;
use App\Models\TeachingSession;
use App\Services\Academic\Concerns\CachesByContentStamp;
use Illuminate\Support\Facades\DB;

/**
 * Phase 7 analytics over the academic OPERATIONS tables: morning punctuality,
 * teaching occurrence, and student progress. Same caching discipline as the
 * evaluation analytics (guide 7.3/10): every result sits behind a short
 * content-stamp-keyed cache, so writes are visible on the next read and idle
 * dashboards never re-fold. No new polled endpoints anywhere.
 */
final class AcademicOperationsAnalyticsService
{
    use CachesByContentStamp;

    private const MORNING_SESSION_LIMIT = 60;

    /**
     * Morning punctuality: summary, per-session trend, per-person attendance
     * rates, and optionally one person's session-by-session history.
     *
     * @return array<string, mixed>
     */
    public function morning(?string $userId = null): array
    {
        $stamp = $this->contentStamp(MorningSession::query())
            .'|'.$this->contentStamp(MorningAttendance::query());

        return $this->cached('morning:'.($userId ?? 'all'), $stamp, function () use ($userId): array {
            $sessions = MorningSession::query()
                ->orderByDesc('session_date')
                ->orderByDesc('id')
                ->limit(self::MORNING_SESSION_LIMIT)
                ->get();

            $sessionIds = $sessions->pluck('id');

            $recorded = $sessions->where('status', 'recorded');
            $notRecorded = $sessions
                ->where('status', 'pending')
                ->filter(fn (MorningSession $session) => $session->session_date?->isPast() && ! $session->session_date->isToday());

            $result = [
                'window' => [
                    'type' => 'latest_sessions',
                    'limit' => self::MORNING_SESSION_LIMIT,
                    'sessionCount' => $sessions->count(),
                    'fromDate' => $sessions->min(fn (MorningSession $session) => $session->session_date?->toDateString()),
                    'toDate' => $sessions->max(fn (MorningSession $session) => $session->session_date?->toDateString()),
                ],
                'recordedCount' => $recorded->count(),
                'notRecordedCount' => $notRecorded->count(),
                'cancelledCount' => $sessions->where('status', 'cancelled')->count(),
                'onTimeRate' => $recorded->count()
                    ? round($recorded->avg(fn (MorningSession $session) => $session->started_on_time ? 100 : 0), 1)
                    : 0.0,
                'avgDelayMinutes' => $recorded->count()
                    ? round($recorded->avg(fn (MorningSession $session) => $session->delayMinutes() ?? 0), 1)
                    : 0.0,
                'trend' => $sessions
                    ->sortBy(fn (MorningSession $session) => $session->session_date?->toDateString())
                    ->map(fn (MorningSession $session) => [
                        'date' => $session->session_date?->toDateString(),
                        'status' => $session->status,
                        'delayMinutes' => $session->delayMinutes(),
                    ])
                    ->values()
                    ->all(),
                'people' => DB::table('morning_attendance')
                    ->join('users', 'users.id', '=', 'morning_attendance.user_id')
                    ->whereIn('morning_attendance.morning_session_id', $sessionIds)
                    ->selectRaw('morning_attendance.user_id, users.full_name, count(*) as expected, sum(case when present then 1 else 0 end) as present')
                    ->groupBy('morning_attendance.user_id', 'users.full_name')
                    ->orderByDesc(DB::raw('count(*)'))
                    ->limit(200)
                    ->get()
                    ->map(fn ($row) => [
                        'userId' => $row->user_id,
                        'fullName' => $row->full_name,
                        'expectedCount' => (int) $row->expected,
                        'presentCount' => (int) $row->present,
                        'attendanceRate' => $row->expected > 0 ? round($row->present / $row->expected * 100, 1) : 0.0,
                    ])
                    ->sortByDesc('attendanceRate')
                    ->values()
                    ->all(),
            ];

            if ($userId !== null) {
                $result['history'] = MorningAttendance::query()
                    ->with('session')
                    ->where('user_id', $userId)
                    ->whereIn('morning_session_id', $sessionIds)
                    ->get()
                    ->sortByDesc(fn (MorningAttendance $row) => $row->session?->session_date?->toDateString())
                    ->map(fn (MorningAttendance $row) => [
                        'date' => $row->session?->session_date?->toDateString(),
                        'present' => (bool) $row->present,
                    ])
                    ->values()
                    ->all();
            }

            return $result;
        });
    }

    /**
     * Teaching occurrence: held rate by activity type and block, individual
     * missed sessions with their block identity, and the pending backlog.
     *
     * @return array<string, mixed>
     */
    public function teaching(): array
    {
        $stamp = $this->contentStamp(TeachingSession::query())
            .'|'.$this->contentStamp(StudentBatch::query());

        return $this->cached('teaching', $stamp, function (): array {
            $sessions = TeachingSession::query()->with('batch')->get();
            $blocks = StudentBatch::query()
                ->orderByDesc('active')
                ->orderByDesc('starts_on')
                ->orderBy('label')
                ->get();

            $rate = function ($group): array {
                $held = $group->where('status', 'held')->count();
                $notHeld = $group->where('status', 'not_held')->count();
                $decided = $held + $notHeld;

                return [
                    'held' => $held,
                    'notHeld' => $notHeld,
                    'cancelled' => $group->where('status', 'cancelled')->count(),
                    'pending' => $group->where('status', 'pending')->count(),
                    'heldRate' => $decided > 0 ? round($held / $decided * 100, 1) : null,
                ];
            };

            $byActivity = fn ($group): array => $group
                ->groupBy('activity_type')
                ->map(fn ($activityGroup, string $activityType) => [
                    'activityType' => $activityType,
                    ...$rate($activityGroup),
                ])
                ->sortBy('activityType')
                ->values()
                ->all();

            $reasons = fn ($group): array => $group
                ->where('status', 'not_held')
                ->groupBy(fn (TeachingSession $session) => trim((string) $session->reason))
                ->map(fn ($reasonGroup, string $reason) => [
                    'reason' => $reason,
                    'count' => $reasonGroup->count(),
                ])
                ->sortByDesc('count')
                ->take(10)
                ->values()
                ->all();

            $missedSessions = fn ($group): array => $group
                ->where('status', 'not_held')
                ->sortByDesc(fn (TeachingSession $session) => $session->scheduled_date?->toDateString())
                ->map(fn (TeachingSession $session) => [
                    'id' => $session->id,
                    'batchId' => $session->batch_id,
                    'batchLabel' => $session->batch?->label ?? 'Unknown block',
                    'activityType' => $session->activity_type,
                    'subgroup' => $session->subgroup,
                    'scheduledDate' => $session->scheduled_date?->toDateString(),
                    'reason' => trim((string) $session->reason),
                ])
                ->values()
                ->all();

            $pendingBacklog = fn ($group): int => $group
                ->where('status', 'pending')
                ->filter(fn (TeachingSession $session) => $session->scheduled_date?->isPast() && ! $session->scheduled_date->isToday())
                ->count();

            $blockBreakdown = $blocks
                ->map(function (StudentBatch $block) use ($sessions, $rate, $byActivity, $reasons, $missedSessions, $pendingBacklog): array {
                    $blockSessions = $sessions->where('batch_id', $block->id);

                    return [
                        'batchId' => $block->id,
                        'batchLabel' => $block->label,
                        'cohort' => $block->cohort,
                        'startsOn' => $block->starts_on?->toDateString(),
                        'endsOn' => $block->ends_on?->toDateString(),
                        'active' => (bool) $block->active,
                        ...$rate($blockSessions),
                        'byActivity' => $byActivity($blockSessions),
                        'reasons' => $reasons($blockSessions),
                        'missedSessions' => $missedSessions($blockSessions),
                        'pendingBacklog' => $pendingBacklog($blockSessions),
                    ];
                })
                ->values();

            return [
                'byActivity' => $byActivity($sessions),
                'byBatch' => $blockBreakdown
                    ->map(fn (array $block) => [
                        'batchId' => $block['batchId'],
                        'batchLabel' => $block['batchLabel'],
                        ...$rate($sessions->where('batch_id', $block['batchId'])),
                    ])
                    ->all(),
                'blocks' => $blockBreakdown->all(),
                'reasons' => $reasons($sessions),
                'missedSessions' => $missedSessions($sessions),
                // Past sessions nobody recorded: the follow-up list.
                'pendingBacklog' => $pendingBacklog($sessions),
            ];
        });
    }

    /**
     * Student progress: per-student attendance rate, weekly evaluation
     * trajectory (average rating), the final rating, and a per-batch rollup.
     *
     * @return array<string, mixed>
     */
    public function students(): array
    {
        $stamp = $this->contentStamp(Student::query())
            .'|'.$this->contentStamp(StudentBatch::query())
            .'|'.$this->contentStamp(StudentAttendance::query())
            .'|'.$this->contentStamp(Evaluation::query()->whereIn('form_key', ['student_weekly', 'student_final']));

        return $this->cached('students', $stamp, function (): array {
            $attendance = DB::table('student_attendance')
                ->selectRaw('student_id, count(*) as expected, sum(case when present then 1 else 0 end) as present')
                ->groupBy('student_id')
                ->get()
                ->keyBy('student_id');

            $evaluations = Evaluation::query()
                ->with('answers')
                ->whereIn('form_key', ['student_weekly', 'student_final'])
                ->whereNotNull('subject_student_id')
                ->orderBy('evaluation_date')
                ->get()
                ->groupBy('subject_student_id');

            $students = Student::query()
                ->with('batch')
                ->where('active', true)
                ->orderBy('full_name')
                ->get()
                ->map(function (Student $student) use ($attendance, $evaluations) {
                    $rows = $attendance->get($student->id);
                    $evals = $evaluations->get($student->id, collect());
                    $weekly = $evals->where('form_key', 'student_weekly');
                    $final = $evals->where('form_key', 'student_final')->last();

                    $weeklyRatings = $weekly
                        ->map(fn (Evaluation $evaluation) => $evaluation->answer('overall_rating'))
                        ->filter(fn ($rating) => $rating !== null)
                        ->map(fn ($rating) => (int) $rating);

                    return [
                        'id' => $student->id,
                        'fullName' => $student->full_name,
                        'batchLabel' => $student->batch?->label,
                        'cohort' => $student->batch?->cohort,
                        'subgroup' => $student->subgroup,
                        'attendanceRate' => $rows && $rows->expected > 0
                            ? round($rows->present / $rows->expected * 100, 1)
                            : null,
                        'weeklyEvaluationCount' => $weekly->count(),
                        'weeklyAvgRating' => $weeklyRatings->count() ? round($weeklyRatings->avg(), 2) : null,
                        'weeklyTrajectory' => $weekly->map(fn (Evaluation $evaluation) => [
                            'weekStartsOn' => $evaluation->week_starts_on?->toDateString(),
                            'rating' => $evaluation->answer('overall_rating'),
                        ])->values()->all(),
                        'finalRating' => $final?->answer('overall_rating'),
                    ];
                })
                ->values()
                ->all();

            return [
                'students' => $students,
                'batches' => collect($students)
                    ->groupBy('batchLabel')
                    ->map(function ($group, $label) {
                        $rates = $group->pluck('attendanceRate')->filter(fn ($rate) => $rate !== null);
                        $weekly = $group->pluck('weeklyAvgRating')->filter(fn ($avg) => $avg !== null);

                        return [
                            'batchLabel' => $label,
                            'studentCount' => $group->count(),
                            'avgAttendanceRate' => $rates->count() ? round($rates->avg(), 1) : null,
                            'avgWeeklyRating' => $weekly->count() ? round($weekly->avg(), 2) : null,
                            'finalsRecorded' => $group->filter(fn ($student) => $student['finalRating'] !== null)->count(),
                        ];
                    })
                    ->values()
                    ->all(),
            ];
        });
    }

    /**
     * @param  callable(): array<string, mixed>  $build
     * @return array<string, mixed>
     */
    private function cached(string $operation, string $stamp, callable $build): array
    {
        return $this->rememberByStamp('academic:ops', $operation, $stamp, $build);
    }
}
