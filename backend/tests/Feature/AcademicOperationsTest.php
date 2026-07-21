<?php

namespace Tests\Feature;

use App\Models\MorningAttendance;
use App\Models\MorningSession;
use App\Models\Notification;
use App\Models\RepAssignment;
use App\Models\ReportingPeriod;
use App\Models\Student;
use App\Models\StudentAttendance;
use App\Models\StudentBatch;
use App\Models\SubgroupPlacement;
use App\Models\TeachingSession;
use App\Models\User;
use App\Models\Ward;
use App\Services\Academic\AcademicOperationsAnalyticsService;
use App\Services\Academic\EvaluationFormService;
use App\Services\Reports\LeadershipDigestService;
use Database\Seeders\DepartmentSeeder;
use Database\Seeders\ReportTemplateSeeder;
use Database\Seeders\RoleSeeder;
use Illuminate\Cache\CacheManager;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Tests\TestCase;

/**
 * V2 Phase 7: operations analytics (morning punctuality, teaching occurrence,
 * student progress), the digest's academic block, and the two follow-up
 * notifications (rep end-of-day nudge, Friday placement gap alert).
 */
class AcademicOperationsTest extends TestCase
{
    use RefreshDatabase;

    private User $admin;

    protected function setUp(): void
    {
        parent::setUp();

        foreach ([RoleSeeder::class, ReportTemplateSeeder::class, DepartmentSeeder::class] as $seeder) {
            $this->seed($seeder);
        }

        // A Monday morning.
        $this->travelTo(Carbon::parse('2026-09-14 09:00:00'));
        $this->admin = User::factory()->role('admin', 'Administrator')->create();
    }

    protected function tearDown(): void
    {
        $this->travelBack();

        parent::tearDown();
    }

    public function test_operations_analytics_database_cache_hits_contain_only_plain_data(): void
    {
        /** @var CacheManager $cache */
        $cache = app('cache');
        $originalDriver = $cache->getDefaultDriver();
        $cache->setDefaultDriver('database');
        $cache->forgetDriver('database');

        try {
            $calls = [
                'morning' => fn (): array => app(AcademicOperationsAnalyticsService::class)->morning(),
                'teaching' => fn (): array => app(AcademicOperationsAnalyticsService::class)->teaching(),
                'students' => fn (): array => app(AcademicOperationsAnalyticsService::class)->students(),
            ];

            foreach ($calls as $operation => $call) {
                $first = $call();
                $second = $call();

                $this->assertSame($first, $second, "{$operation} changed on its cache hit.");
                $this->assertPlainCachePayload($second, $operation);
                $this->assertStringNotContainsString('__PHP_Incomplete_Class', serialize($second));
            }
        } finally {
            $cache->store('database')->flush();
            $cache->setDefaultDriver($originalDriver);
            $cache->forgetDriver('database');
        }
    }

    public function test_morning_analytics_report_punctuality_and_attendance_rates(): void
    {
        $person = User::factory()->role('resident', 'Resident')->create();

        // Two recorded sessions: one on time, one 20 minutes late; one
        // never-recorded session in the past.
        $onTime = MorningSession::query()->create([
            'session_date' => '2026-09-07',
            'scheduled_start_at' => '08:00',
            'status' => 'recorded',
            'started_on_time' => true,
            'recorded_at' => now(),
        ]);
        $late = MorningSession::query()->create([
            'session_date' => '2026-09-09',
            'scheduled_start_at' => '08:00',
            'status' => 'recorded',
            'started_on_time' => false,
            'actual_start_at' => '08:20',
            'recorded_at' => now(),
        ]);
        MorningSession::query()->create([
            'session_date' => '2026-09-11',
            'scheduled_start_at' => '08:00',
        ]);

        MorningAttendance::query()->create(['morning_session_id' => $onTime->id, 'user_id' => $person->id, 'present' => true]);
        MorningAttendance::query()->create(['morning_session_id' => $late->id, 'user_id' => $person->id, 'present' => false]);

        $response = $this->actingAs($this->admin)
            ->getJson('/api/academic/analytics/morning?userId='.$person->id)
            ->assertOk()
            ->json();

        $this->assertSame(2, $response['recordedCount']);
        $this->assertSame(1, $response['notRecordedCount']);
        // Whole-number floats serialize as JSON integers; compare loosely.
        $this->assertEquals(50, $response['onTimeRate']);
        $this->assertEquals(10, $response['avgDelayMinutes']);

        $personRow = collect($response['people'])->firstWhere('userId', $person->id);
        $this->assertEquals(50, $personRow['attendanceRate']);

        // The per-person history for the detail page.
        $this->assertCount(2, $response['history']);
        $this->assertSame([
            'type' => 'latest_sessions',
            'limit' => 60,
            'sessionCount' => 3,
            'fromDate' => '2026-09-07',
            'toDate' => '2026-09-11',
        ], $response['window']);

        // Non-admins cannot read the operations analytics.
        $resident = User::factory()->role('resident', 'Resident')->create();
        $this->actingAs($resident)->getJson('/api/academic/analytics/morning')->assertForbidden();
    }

    public function test_morning_analytics_uses_the_same_latest_session_window_for_every_section(): void
    {
        $person = User::factory()->role('resident', 'Resident')->create();

        $outside = MorningSession::query()->create([
            'session_date' => '2025-01-01',
            'scheduled_start_at' => '08:00',
            'status' => 'recorded',
            'started_on_time' => true,
            'recorded_at' => now(),
        ]);
        MorningAttendance::query()->create([
            'morning_session_id' => $outside->id,
            'user_id' => $person->id,
            'present' => true,
        ]);

        foreach (range(1, 60) as $day) {
            $session = MorningSession::query()->create([
                'session_date' => Carbon::parse('2026-01-01')->addDays($day)->toDateString(),
                'scheduled_start_at' => '08:00',
                'status' => 'recorded',
                'started_on_time' => false,
                'actual_start_at' => '08:10',
                'recorded_at' => now(),
            ]);
            MorningAttendance::query()->create([
                'morning_session_id' => $session->id,
                'user_id' => $person->id,
                'present' => false,
            ]);
        }

        $response = $this->actingAs($this->admin)
            ->getJson('/api/academic/analytics/morning?userId='.$person->id)
            ->assertOk()
            ->json();

        $this->assertSame(60, $response['window']['sessionCount']);
        $this->assertSame(60, $response['recordedCount']);
        $this->assertCount(60, $response['trend']);
        $this->assertCount(60, $response['history']);

        $personRow = collect($response['people'])->firstWhere('userId', $person->id);
        $this->assertSame(60, $personRow['expectedCount']);
        $this->assertSame(0, $personRow['presentCount']);
        $this->assertEquals(0, $personRow['attendanceRate']);
        $this->assertNotContains('2025-01-01', array_column($response['history'], 'date'));
    }

    private function assertPlainCachePayload(mixed $value, string $path): void
    {
        $this->assertNotInstanceOf(\__PHP_Incomplete_Class::class, $value, "Incomplete cache object at {$path}.");

        if (is_array($value)) {
            foreach ($value as $key => $item) {
                $this->assertPlainCachePayload($item, $path.'.'.$key);
            }

            return;
        }

        $this->assertTrue(is_scalar($value) || $value === null, sprintf(
            'Cache value at %s must be plain; %s found.',
            $path,
            get_debug_type($value),
        ));
    }

    public function test_teaching_analytics_report_held_rates_reasons_and_backlog(): void
    {
        $batch = StudentBatch::query()->create([
            'cohort' => 'C1',
            'label' => 'C1 2026-A',
            'starts_on' => '2026-09-01',
            'ends_on' => '2026-12-06',
        ]);

        $make = fn (string $activity, string $date, string $status, ?string $reason = null) => TeachingSession::query()->create([
            'batch_id' => $batch->id,
            'subgroup' => in_array($activity, ['bedside', 'teaching_round'], true) ? 'A' : null,
            'activity_type' => $activity,
            'scheduled_date' => $date,
            'status' => $status,
            'reason' => $reason,
        ]);

        $make('lecture', '2026-09-07', 'held');
        $make('lecture', '2026-09-08', 'held');
        $make('lecture', '2026-09-09', 'not_held', 'Lecturer unavailable');
        $make('bedside', '2026-09-07', 'not_held', 'Lecturer unavailable');
        $make('bedside', '2026-09-11', 'pending');
        $make('seminar', '2026-09-09', 'cancelled', 'Exam week');

        $secondBlock = StudentBatch::query()->create([
            'cohort' => 'C2',
            'label' => 'C2 2026-B',
            'starts_on' => '2026-09-01',
            'ends_on' => '2026-12-06',
        ]);
        TeachingSession::query()->create([
            'batch_id' => $secondBlock->id,
            'activity_type' => 'seminar',
            'scheduled_date' => '2026-09-10',
            'status' => 'not_held',
            'reason' => 'Room unavailable',
        ]);

        $response = $this->actingAs($this->admin)
            ->getJson('/api/academic/analytics/teaching')
            ->assertOk()
            ->json();

        $lectures = collect($response['byActivity'])->firstWhere('activityType', 'lecture');
        $this->assertSame(2, $lectures['held']);
        $this->assertSame(1, $lectures['notHeld']);
        $this->assertSame(66.7, $lectures['heldRate']);

        $this->assertSame(1, $response['pendingBacklog']);
        $this->assertSame('Lecturer unavailable', $response['reasons'][0]['reason']);
        $this->assertSame(2, $response['reasons'][0]['count']);

        $batchRow = collect($response['byBatch'])->firstWhere('batchLabel', 'C1 2026-A');
        $this->assertSame(2, $batchRow['held']);
        $this->assertSame($batch->id, $batchRow['batchId']);

        $c1Block = collect($response['blocks'])->firstWhere('batchId', $batch->id);
        $this->assertCount(2, $c1Block['missedSessions']);
        $this->assertSame('C1 2026-A', $c1Block['missedSessions'][0]['batchLabel']);
        $this->assertSame(1, $c1Block['pendingBacklog']);

        $c2Block = collect($response['blocks'])->firstWhere('batchId', $secondBlock->id);
        $this->assertSame(1, $c2Block['notHeld']);
        $this->assertSame('Room unavailable', $c2Block['missedSessions'][0]['reason']);
        $this->assertSame('C2 2026-B', $response['missedSessions'][0]['batchLabel']);
    }

    public function test_student_analytics_roll_up_attendance_and_evaluation_trajectories(): void
    {
        $batch = StudentBatch::query()->create([
            'cohort' => 'C1',
            'label' => 'C1 2026-A',
            'starts_on' => '2026-09-01',
            'ends_on' => '2026-12-06',
        ]);
        $student = Student::query()->create(['batch_id' => $batch->id, 'full_name' => 'Student One', 'subgroup' => 'A']);
        $consultant = User::factory()->role('consultant', 'Consultant')->create();

        $session = TeachingSession::query()->create([
            'batch_id' => $batch->id,
            'subgroup' => 'A',
            'activity_type' => 'bedside',
            'scheduled_date' => '2026-09-07',
            'status' => 'held',
        ]);
        StudentAttendance::query()->create([
            'teaching_session_id' => $session->id,
            'student_id' => $student->id,
            'present' => true,
            'recorded_by' => $consultant->id,
        ]);

        $forms = app(EvaluationFormService::class);
        foreach ([['2026-09-07', 3], ['2026-09-14', 4]] as [$week, $rating]) {
            $forms->store($forms->published('student_weekly'), [
                'attendance_reliable' => true,
                'participation_active' => true,
                'clinical_knowledge' => true,
                'skills_progress' => true,
                'professional_conduct' => true,
                'overall_rating' => $rating,
            ], [
                'author_id' => $consultant->id,
                'subject_student_id' => $student->id,
                'evaluation_date' => $week,
                'week_starts_on' => $week,
            ]);
        }
        $forms->store($forms->published('student_final'), [
            'knowledge_competent' => true,
            'skills_competent' => true,
            'professional_conduct' => true,
            'overall_rating' => 5,
        ], [
            'author_id' => $consultant->id,
            'subject_student_id' => $student->id,
            'evaluation_date' => '2026-09-14',
        ]);

        $response = $this->actingAs($this->admin)
            ->getJson('/api/academic/analytics/students')
            ->assertOk()
            ->json();

        $row = collect($response['students'])->firstWhere('id', $student->id);
        $this->assertEquals(100, $row['attendanceRate']);
        $this->assertSame(2, $row['weeklyEvaluationCount']);
        $this->assertSame(3.5, $row['weeklyAvgRating']);
        $this->assertSame(5, $row['finalRating']);
        $this->assertCount(2, $row['weeklyTrajectory']);

        $rollup = collect($response['batches'])->firstWhere('batchLabel', 'C1 2026-A');
        $this->assertSame(1, $rollup['studentCount']);
        $this->assertSame(1, $rollup['finalsRecorded']);
    }

    public function test_digest_carries_the_academic_block(): void
    {
        // The digest reads the most recent reporting period; the seeded test
        // DB has none, so create one covering this week.
        ReportingPeriod::query()->create([
            'week_start' => '2026-09-14',
            'week_end' => '2026-09-20',
            'deadline_at' => '2026-09-21 10:00:00',
            'month_label' => 'September 2026',
            'quarter_label' => 'Q3 2026',
            'year_num' => 2026,
        ]);

        MorningSession::query()->create([
            'session_date' => '2026-09-14',
            'scheduled_start_at' => '08:00',
            'status' => 'recorded',
            'started_on_time' => false,
            'actual_start_at' => '08:10',
            'recorded_at' => now(),
        ]);

        $batch = StudentBatch::query()->create([
            'cohort' => 'C1',
            'label' => 'C1 2026-A',
            'starts_on' => '2026-09-01',
            'ends_on' => '2026-12-06',
        ]);
        TeachingSession::query()->create([
            'batch_id' => $batch->id,
            'subgroup' => null,
            'activity_type' => 'lecture',
            'scheduled_date' => '2026-09-14',
            'status' => 'held',
        ]);

        $digest = app(LeadershipDigestService::class)->build();

        $this->assertTrue($digest['hasData']);
        $this->assertSame(1, $digest['academic']['morningRecorded']);
        $this->assertSame(0, $digest['academic']['morningOnTimeRate']);
        $this->assertSame(10, $digest['academic']['morningAvgDelayMinutes']);
        $this->assertSame(1, $digest['academic']['teachingHeld']);
        $this->assertSame(1, $digest['academic']['teachingExpected']);
    }

    public function test_rep_end_of_day_reminder_targets_only_the_scope_with_pending_sessions(): void
    {
        $batch = StudentBatch::query()->create([
            'cohort' => 'C1',
            'label' => 'C1 2026-A',
            'starts_on' => '2026-09-01',
            'ends_on' => '2026-12-06',
        ]);

        $groupRep = User::factory()->role('student_rep', 'Student representative')->create();
        $repA = User::factory()->role('student_rep', 'Student representative')->create();
        RepAssignment::query()->create(['user_id' => $groupRep->id, 'batch_id' => $batch->id, 'scope' => 'group']);
        RepAssignment::query()->create(['user_id' => $repA->id, 'batch_id' => $batch->id, 'scope' => 'subgroup_a']);

        // A pending lecture today (group scope) and a HELD bedside for A
        // (nothing pending in A's scope).
        TeachingSession::query()->create([
            'batch_id' => $batch->id,
            'subgroup' => null,
            'activity_type' => 'lecture',
            'scheduled_date' => now()->toDateString(),
            'status' => 'pending',
        ]);
        TeachingSession::query()->create([
            'batch_id' => $batch->id,
            'subgroup' => 'A',
            'activity_type' => 'bedside',
            'scheduled_date' => now()->toDateString(),
            'status' => 'held',
        ]);

        $this->artisan('academic:remind-reps')->expectsOutputToContain('sent: 1');

        $this->assertDatabaseHas('notifications', [
            'recipient_id' => $groupRep->id,
            'type' => 'teaching_log_reminder',
        ]);
        $this->assertDatabaseMissing('notifications', [
            'recipient_id' => $repA->id,
            'type' => 'teaching_log_reminder',
        ]);
    }

    public function test_friday_placement_check_alerts_admins_about_unplaced_subgroups(): void
    {
        $batch = StudentBatch::query()->create([
            'cohort' => 'C1',
            'label' => 'C1 2026-A',
            'starts_on' => '2026-09-01',
            'ends_on' => '2026-12-06',
        ]);

        // Subgroup A is placed for next week; B is not.
        SubgroupPlacement::query()->create([
            'batch_id' => $batch->id,
            'subgroup' => 'A',
            'ward_id' => Ward::query()->value('id'),
            'week_starts_on' => '2026-09-21',
            'week_ends_on' => '2026-09-27',
            'created_by' => $this->admin->id,
        ]);

        $this->artisan('academic:check-placements')->expectsOutputToContain('gaps found: 1');

        $this->assertDatabaseHas('notifications', [
            'recipient_id' => $this->admin->id,
            'type' => 'placement_gap',
        ]);

        $notification = Notification::query()->where('type', 'placement_gap')->firstOrFail();
        $this->assertStringContainsString('subgroup B', $notification->message);
        $this->assertStringNotContainsString('subgroup A', $notification->message);
    }
}
