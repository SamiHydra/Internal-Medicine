<?php

namespace App\Services\Academic;

use App\Models\Evaluation;
use App\Models\MorningAttendance;
use App\Models\MorningSession;
use App\Models\Student;
use App\Models\StudentAttendance;
use App\Models\TeachingSession;
use Illuminate\Support\Facades\Cache;
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
    private const CACHE_TTL_SECONDS = 300;

    /**
     * Morning punctuality: summary, per-session trend, per-person attendance
     * rates, and optionally one person's session-by-session history.
     *
     * @return array<string, mixed>
     */
    public function morning(?string $userId = null): array
    {
        $stamp = $this->stamp(MorningSession::query()) . '|' . MorningAttendance::query()->count();

        return $this->cached('morning:'.($userId ?? 'all'), $stamp, function () use ($userId): array {
            $sessions = MorningSession::query()
                ->orderByDesc('session_date')
                ->limit(60)
                ->get();

            $recorded = $sessions->where('status', 'recorded');
            $notRecorded = $sessions
                ->where('status', 'pending')
                ->filter(fn (MorningSession $session) => $session->session_date?->isPast() && ! $session->session_date->isToday());

            $result = [
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
                    ->values(),
                'people' => DB::table('morning_attendance')
                    ->join('users', 'users.id', '=', 'morning_attendance.user_id')
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
                    ->values(),
            ];

            if ($userId !== null) {
                $result['history'] = MorningAttendance::query()
                    ->with('session')
                    ->where('user_id', $userId)
                    ->get()
                    ->sortByDesc(fn (MorningAttendance $row) => $row->session?->session_date?->toDateString())
                    ->take(30)
                    ->map(fn (MorningAttendance $row) => [
                        'date' => $row->session?->session_date?->toDateString(),
                        'present' => (bool) $row->present,
                    ])
                    ->values();
            }

            return $result;
        });
    }

    /**
     * Teaching occurrence: held rate by activity type and batch, the
     * not-held reasons breakdown, and the pending backlog.
     *
     * @return array<string, mixed>
     */
    public function teaching(): array
    {
        return $this->cached('teaching', $this->stamp(TeachingSession::query()), function (): array {
            $sessions = TeachingSession::query()->with('batch')->get();

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

            return [
                'byActivity' => $sessions
                    ->groupBy('activity_type')
                    ->map(fn ($group, string $activityType) => ['activityType' => $activityType, ...$rate($group)])
                    ->values(),
                'byBatch' => $sessions
                    ->groupBy(fn (TeachingSession $session) => $session->batch?->label ?? '-')
                    ->map(fn ($group, string $label) => ['batchLabel' => $label, ...$rate($group)])
                    ->values(),
                'reasons' => $sessions
                    ->where('status', 'not_held')
                    ->groupBy(fn (TeachingSession $session) => trim((string) $session->reason))
                    ->map(fn ($group, string $reason) => ['reason' => $reason, 'count' => $group->count()])
                    ->sortByDesc('count')
                    ->take(10)
                    ->values(),
                // Past sessions nobody recorded: the follow-up list.
                'pendingBacklog' => $sessions
                    ->where('status', 'pending')
                    ->filter(fn (TeachingSession $session) => $session->scheduled_date?->isPast() && ! $session->scheduled_date->isToday())
                    ->count(),
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
        $stamp = Student::query()->count()
            .'|'.StudentAttendance::query()->count()
            .'|'.$this->stamp(Evaluation::query()->whereIn('form_key', ['student_weekly', 'student_final']));

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
                        ])->values(),
                        'finalRating' => $final?->answer('overall_rating'),
                    ];
                })
                ->values();

            return [
                'students' => $students,
                'batches' => $students
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
                    ->values(),
            ];
        });
    }

    private function stamp($query): string
    {
        $row = (clone $query)->selectRaw('count(*) as row_count, max(updated_at) as latest')->first();

        return ($row->row_count ?? 0).'|'.($row->latest ?? '');
    }

    /**
     * @param  callable(): array<string, mixed>  $build
     * @return array<string, mixed>
     */
    private function cached(string $operation, string $stamp, callable $build): array
    {
        return Cache::remember(
            sprintf('academic:ops:%s:%s', $operation, md5($stamp)),
            self::CACHE_TTL_SECONDS,
            $build,
        );
    }
}
