<?php

namespace Tests\Feature;

use App\Models\Evaluation;
use App\Models\RepAssignment;
use App\Models\Student;
use App\Models\StudentBatch;
use App\Models\SubgroupPlacement;
use App\Models\TeachingSession;
use App\Models\User;
use App\Models\Ward;
use App\Services\Academic\TeachingService;
use App\Support\Authorization\Permissions;
use Database\Seeders\DepartmentSeeder;
use Database\Seeders\ReportTemplateSeeder;
use Database\Seeders\RoleSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Tests\TestCase;

class UndergraduateModuleTest extends TestCase
{
    use RefreshDatabase;

    private User $admin;

    protected function setUp(): void
    {
        parent::setUp();

        foreach ([RoleSeeder::class, ReportTemplateSeeder::class, DepartmentSeeder::class] as $seeder) {
            $this->seed($seeder);
        }

        // A Monday, so weekday-based generation is deterministic.
        $this->travelTo(Carbon::parse('2026-09-14 09:00:00'));
        $this->admin = User::factory()->role('admin', 'Administrator')->create();
    }

    protected function tearDown(): void
    {
        $this->travelBack();

        parent::tearDown();
    }

    private function makeBatch(string $cohort = 'C1', string $label = 'C1 2026-A'): StudentBatch
    {
        return StudentBatch::query()->create([
            'cohort' => $cohort,
            'label' => $label,
            'starts_on' => '2026-09-14',
            'ends_on' => $cohort === 'C1' ? '2026-12-06' : '2026-11-08',
        ]);
    }

    private function makeRep(StudentBatch $batch, string $scope): User
    {
        $rep = User::factory()->role('student_rep', 'Student representative')->create();

        RepAssignment::query()->create([
            'user_id' => $rep->id,
            'batch_id' => $batch->id,
            'scope' => $scope,
        ]);

        return $rep;
    }

    // ---- Session generation ----

    public function test_generation_is_idempotent_and_matches_the_weekly_programs(): void
    {
        $batch = $this->makeBatch();
        $service = app(TeachingService::class);

        // Monday for C1: lecture (cohort) + bedside (per subgroup) = 3 rows.
        $this->assertSame(3, $service->generateSessions(Carbon::parse('2026-09-14')));
        $this->assertSame(0, $service->generateSessions(Carbon::parse('2026-09-14')));

        // Wednesday for C1: lecture + seminar (both cohort) = 2 rows.
        $this->assertSame(2, $service->generateSessions(Carbon::parse('2026-09-16')));

        // Saturday: nothing scheduled.
        $this->assertSame(0, $service->generateSessions(Carbon::parse('2026-09-19')));

        // A C2 batch on a Wednesday: bedside only (per subgroup) = 2 rows.
        $c2 = $this->makeBatch('C2', 'C2 2026-A');
        $this->assertSame(2, $service->generateSessions(Carbon::parse('2026-09-16')));
        $this->assertSame(2, TeachingSession::query()->where('batch_id', $c2->id)->count());
    }

    public function test_overlapping_c1_batches_generate_independent_sessions(): void
    {
        $first = $this->makeBatch('C1', 'C1 2026-A');
        $second = $this->makeBatch('C1', 'C1 2026-B');

        app(TeachingService::class)->generateSessions(Carbon::parse('2026-09-14'));

        foreach ([$first, $second] as $batch) {
            $this->assertSame(3, TeachingSession::query()->where('batch_id', $batch->id)->count());
        }
    }

    public function test_sessions_snapshot_the_subgroup_placement_ward_and_survive_without_one(): void
    {
        $batch = $this->makeBatch();
        $ward = Ward::query()->where('slug', 'nephrology_ward')->firstOrFail();

        SubgroupPlacement::query()->create([
            'batch_id' => $batch->id,
            'subgroup' => 'A',
            'ward_id' => $ward->id,
            'week_starts_on' => '2026-09-14',
            'week_ends_on' => '2026-09-20',
            'created_by' => $this->admin->id,
        ]);

        app(TeachingService::class)->generateSessions(Carbon::parse('2026-09-14'));

        $bedsideA = TeachingSession::query()->where('subgroup', 'A')->where('activity_type', 'bedside')->firstOrFail();
        $bedsideB = TeachingSession::query()->where('subgroup', 'B')->where('activity_type', 'bedside')->firstOrFail();

        $this->assertSame($ward->id, $bedsideA->ward_id);
        // No placement for B: the session still appears, unplaced.
        $this->assertNull($bedsideB->ward_id);
    }

    // ---- Rep recording scope ----

    public function test_rep_scopes_are_enforced_when_recording(): void
    {
        $batch = $this->makeBatch();
        app(TeachingService::class)->generateSessions(Carbon::parse('2026-09-14'));

        $groupRep = $this->makeRep($batch, 'group');
        $repA = $this->makeRep($batch, 'subgroup_a');

        $lecture = TeachingSession::query()->where('activity_type', 'lecture')->firstOrFail();
        $bedsideA = TeachingSession::query()->where('subgroup', 'A')->where('activity_type', 'bedside')->firstOrFail();
        $bedsideB = TeachingSession::query()->where('subgroup', 'B')->where('activity_type', 'bedside')->firstOrFail();

        // The group rep records lectures, never bedside.
        $this->actingAs($groupRep)
            ->postJson("/api/teaching/sessions/{$lecture->id}/record", ['status' => 'held'])
            ->assertOk()
            ->assertJsonPath('status', 'held');
        $this->actingAs($groupRep)
            ->postJson("/api/teaching/sessions/{$bedsideA->id}/record", ['status' => 'held'])
            ->assertForbidden();

        // Subgroup rep A records A's bedside, never B's.
        $this->actingAs($repA)
            ->postJson("/api/teaching/sessions/{$bedsideA->id}/record", ['status' => 'held'])
            ->assertOk();
        $this->actingAs($repA)
            ->postJson("/api/teaching/sessions/{$bedsideB->id}/record", ['status' => 'held'])
            ->assertForbidden();

        // A rep of ANOTHER batch has no reach into this one.
        $otherBatch = $this->makeBatch('C1', 'C1 2026-B');
        $stranger = $this->makeRep($otherBatch, 'group');
        $this->actingAs($stranger)
            ->postJson("/api/teaching/sessions/{$lecture->id}/record", ['status' => 'held'])
            ->assertForbidden();
    }

    public function test_not_held_requires_a_reason_and_my_sessions_lists_only_the_scope(): void
    {
        $batch = $this->makeBatch();
        app(TeachingService::class)->generateSessions(Carbon::parse('2026-09-14'));

        $groupRep = $this->makeRep($batch, 'group');
        $lecture = TeachingSession::query()->where('activity_type', 'lecture')->firstOrFail();

        $this->actingAs($groupRep)
            ->postJson("/api/teaching/sessions/{$lecture->id}/record", ['status' => 'not_held'])
            ->assertStatus(422)
            ->assertJsonValidationErrors(['reason']);

        $this->actingAs($groupRep)
            ->postJson("/api/teaching/sessions/{$lecture->id}/record", [
                'status' => 'not_held',
                'reason' => 'Lecturer called to theatre.',
            ])
            ->assertOk()
            ->assertJsonPath('status', 'not_held');

        // my-sessions carries only lecture/seminar rows for a group rep.
        $mine = $this->actingAs($groupRep)->getJson('/api/teaching/my-sessions')->assertOk()->json();
        $this->assertSame('group', $mine['scope']['scope']);
        $this->assertNotContains('bedside', array_column($mine['data'], 'activityType'));
    }

    // ---- Attendance ----

    public function test_consultant_attendance_flips_a_pending_session_to_held(): void
    {
        $batch = $this->makeBatch();
        app(TeachingService::class)->generateSessions(Carbon::parse('2026-09-14'));

        Student::query()->create(['batch_id' => $batch->id, 'full_name' => 'Student One', 'subgroup' => 'A']);
        Student::query()->create(['batch_id' => $batch->id, 'full_name' => 'Student Two', 'subgroup' => 'A']);
        Student::query()->create(['batch_id' => $batch->id, 'full_name' => 'Student Other', 'subgroup' => 'B']);

        $consultant = User::factory()->role('consultant', 'Consultant')->create();

        $today = $this->actingAs($consultant)->getJson('/api/teaching/today')->assertOk()->json('data');
        $bedsideA = collect($today)->first(fn (array $session) => $session['activityType'] === 'bedside' && $session['subgroup'] === 'A');

        // The roster is the subgroup, not the whole batch.
        $this->assertCount(2, $bedsideA['roster']);

        $presence = collect($bedsideA['roster'])->mapWithKeys(fn (array $student) => [$student['id'] => true])->all();
        $firstStudentId = array_key_first($presence);
        $presence[$firstStudentId] = false;

        $this->actingAs($consultant)
            ->putJson("/api/teaching/sessions/{$bedsideA['id']}/attendance", ['presence' => $presence])
            ->assertOk()
            ->assertJsonPath('status', 'held');

        $this->assertDatabaseHas('student_attendance', [
            'teaching_session_id' => $bedsideA['id'],
            'student_id' => $firstStudentId,
            'present' => false,
        ]);

        // A rep cannot touch attendance (no studentAttendance.record permission).
        $rep = $this->makeRep($batch, 'group');
        $this->actingAs($rep)
            ->putJson("/api/teaching/sessions/{$bedsideA['id']}/attendance", ['presence' => $presence])
            ->assertForbidden();
    }

    // ---- Admin oversight ----

    public function test_admin_cancel_requires_a_reason_and_import_builds_the_roster(): void
    {
        $batch = $this->makeBatch();
        app(TeachingService::class)->generateSessions(Carbon::parse('2026-09-14'));
        $lecture = TeachingSession::query()->where('activity_type', 'lecture')->firstOrFail();

        $this->actingAs($this->admin)
            ->postJson("/api/admin/teaching-sessions/{$lecture->id}/cancel", [])
            ->assertStatus(422);

        $this->actingAs($this->admin)
            ->postJson("/api/admin/teaching-sessions/{$lecture->id}/cancel", ['reason' => 'Exam week'])
            ->assertOk()
            ->assertJsonPath('status', 'cancelled');

        $this->assertDatabaseHas('admin_audit_logs', [
            'entity_type' => 'teaching_session',
            'action' => 'cancel',
        ]);

        $this->actingAs($this->admin)
            ->postJson('/api/admin/students/import', [
                'batchId' => $batch->id,
                'csv' => "Alem Kebede,ETS0101,A\nBirtukan Mengistu,ETS0102,B\nAlem Kebede,ETS0101,A\n\n",
            ])
            ->assertCreated()
            ->assertJsonPath('created', 2)
            ->assertJsonPath('skipped', 1);

        $this->assertSame(2, Student::query()->where('batch_id', $batch->id)->count());
    }

    // ---- Student evaluations ----

    public function test_any_consultant_evaluates_any_student_and_weekly_prefills_the_placement(): void
    {
        $batch = $this->makeBatch();
        $ward = Ward::query()->where('slug', 'pulmonology_ward')->firstOrFail();
        $student = Student::query()->create(['batch_id' => $batch->id, 'full_name' => 'Student One', 'subgroup' => 'A']);

        SubgroupPlacement::query()->create([
            'batch_id' => $batch->id,
            'subgroup' => 'A',
            'ward_id' => $ward->id,
            'week_starts_on' => '2026-09-14',
            'week_ends_on' => '2026-09-20',
            'created_by' => $this->admin->id,
        ]);

        // The consultant has NO duty assignment at all: students are not
        // ward-gated (the client ruled any consultant may evaluate any student).
        $consultant = User::factory()->role('consultant', 'Consultant')->create();

        $options = $this->actingAs($consultant)->getJson('/api/academic/students')->assertOk()->json('data');
        $this->assertSame($student->id, $options[0]['id']);
        $this->assertSame($ward->name, $options[0]['currentWardName']);

        $response = $this->actingAs($consultant)
            ->postJson('/api/academic/student-evaluations', [
                'formKey' => 'student_weekly',
                'studentId' => $student->id,
                'evaluationDate' => '2026-09-14',
                'attendance_reliable' => true,
                'participation_active' => true,
                'clinical_knowledge' => true,
                'skills_progress' => false,
                'professional_conduct' => true,
                'overall_rating' => 4,
                'comment' => 'Solid week.',
            ])
            ->assertCreated()
            ->assertJsonPath('wardName', $ward->name)
            ->assertJsonPath('weekStartsOn', '2026-09-14')
            ->assertJsonPath('subjectName', 'Student One');

        $evaluation = Evaluation::query()->findOrFail($response->json('id'));
        $this->assertSame('student_weekly', $evaluation->form_key);
        $this->assertSame($student->id, $evaluation->subject_student_id);
        $this->assertNull($evaluation->subject_user_id);

        // Residents cannot evaluate students.
        $resident = User::factory()->role('resident', 'Resident')->create();
        $this->actingAs($resident)
            ->postJson('/api/academic/student-evaluations', [
                'formKey' => 'student_final',
                'studentId' => $student->id,
                'evaluationDate' => '2026-09-14',
                'knowledge_competent' => true,
                'skills_competent' => true,
                'professional_conduct' => true,
                'overall_rating' => 4,
            ])
            ->assertStatus(422);
    }

    // ---- The structural rep guarantee ----

    public function test_student_rep_role_never_carries_an_academic_permission(): void
    {
        foreach ([
            Permissions::ACADEMIC_SUBMIT,
            Permissions::ACADEMIC_VIEW,
            Permissions::ACADEMIC_MANAGE,
        ] as $permission) {
            $this->assertFalse(
                Permissions::roleHas('student_rep', $permission),
                "student_rep must never hold {$permission}",
            );
        }
    }

    public function test_student_rep_receives_403_on_every_academic_evaluation_endpoint(): void
    {
        $batch = $this->makeBatch();
        $rep = $this->makeRep($batch, 'group');

        // Real ids for parameterized routes, so route-model binding succeeds
        // and it is the AUTHORIZATION layer that answers, not a 404.
        $consultant = User::factory()->role('consultant', 'Consultant')->create([
            'section_id' => \App\Models\Section::query()->where('slug', 'nephrology')->value('id'),
        ]);
        $transferRequest = \App\Models\TransferRequest::query()->create([
            'user_id' => $consultant->id,
            'from_section_id' => \App\Models\Section::query()->where('slug', 'nephrology')->value('id'),
            'to_section_id' => \App\Models\Section::query()->where('slug', 'cardiology')->value('id'),
        ]);
        $formId = \App\Models\EvaluationForm::query()->where('key', 'consultant_mdt')->value('id');

        // Asserted against the live route list, not a hand-maintained one:
        // every AUTHENTICATED /api/academic and /api/admin/academic route must
        // refuse a rep. (The public self-registration endpoint shares the
        // prefix but sits outside auth:sanctum.)
        $routes = collect(app('router')->getRoutes()->getRoutes())
            ->filter(fn ($route) => (str_starts_with($route->uri(), 'api/academic')
                    || str_starts_with($route->uri(), 'api/admin/academic'))
                && in_array('auth:sanctum', $route->gatherMiddleware(), true));

        $this->assertNotEmpty($routes);

        $morningSession = \App\Models\MorningSession::query()->create([
            'session_date' => '2026-09-14',
            'scheduled_start_at' => '08:00',
        ]);

        $bindings = [
            '{key}' => 'consultant_mdt',
            '{transferRequest}' => $transferRequest->id,
            '{evaluationForm}' => $formId,
            '{ward}' => Ward::query()->value('id'),
            '{section}' => \App\Models\Section::query()->value('id'),
            '{dutyType}' => \App\Models\DutyType::query()->value('id'),
            '{morningSession}' => $morningSession->id,
        ];

        foreach ($routes as $route) {
            $uri = '/'.str_replace(array_keys($bindings), array_values($bindings), $route->uri());
            $method = collect($route->methods())->first(fn (string $m) => $m !== 'HEAD');

            $status = $this->actingAs($rep)->json($method, $uri)->getStatusCode();

            $this->assertSame(
                403,
                $status,
                "student_rep reached {$method} {$uri} (got {$status})",
            );
        }
    }

    // ---- Review-pass regressions ----

    public function test_import_dedupes_on_external_id_when_present_and_name_otherwise(): void
    {
        $batch = $this->makeBatch();

        // Two distinct students sharing a name are told apart by their
        // registrar ids; the exact same line is still skipped.
        $this->actingAs($this->admin)
            ->postJson('/api/admin/students/import', [
                'batchId' => $batch->id,
                'csv' => "Alem Kebede,ETS0101,A
Alem Kebede,ETS0202,B
Alem Kebede,ETS0101,A",
            ])
            ->assertCreated()
            ->assertJsonPath('created', 2)
            ->assertJsonPath('skipped', 1);

        // Name-only lines fall back to name dedupe.
        $this->actingAs($this->admin)
            ->postJson('/api/admin/students/import', [
                'batchId' => $batch->id,
                'csv' => "Birtukan Mengistu
Birtukan Mengistu",
            ])
            ->assertCreated()
            ->assertJsonPath('created', 1)
            ->assertJsonPath('skipped', 1);
    }

    public function test_batch_dates_cannot_be_inverted_through_a_partial_update(): void
    {
        $batch = $this->makeBatch();

        // Moving startsOn past the stored endsOn would silently halt session
        // generation for the batch.
        $this->actingAs($this->admin)
            ->patchJson("/api/admin/student-batches/{$batch->id}", [
                'startsOn' => '2027-01-01',
            ])
            ->assertStatus(422)
            ->assertJsonValidationErrors(['endsOn']);

        $this->actingAs($this->admin)
            ->patchJson("/api/admin/student-batches/{$batch->id}", [
                'endsOn' => '2026-01-01',
            ])
            ->assertStatus(422);

        // A consistent pair still updates fine.
        $this->actingAs($this->admin)
            ->patchJson("/api/admin/student-batches/{$batch->id}", [
                'startsOn' => '2026-09-21',
                'endsOn' => '2026-12-13',
            ])
            ->assertOk();
    }
}
