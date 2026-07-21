<?php

namespace Tests\Feature;

use App\Http\Controllers\Api\Admin\UndergraduateAdminController;
use App\Models\DutyType;
use App\Models\Evaluation;
use App\Models\EvaluationForm;
use App\Models\MorningSession;
use App\Models\RepAssignment;
use App\Models\Section;
use App\Models\Student;
use App\Models\StudentBatch;
use App\Models\SubgroupPlacement;
use App\Models\TeachingActivitySchedule;
use App\Models\TeachingSession;
use App\Models\TransferRequest;
use App\Models\User;
use App\Models\Ward;
use App\Services\Academic\TeachingService;
use App\Support\Authorization\Permissions;
use Database\Seeders\DepartmentSeeder;
use Database\Seeders\DevAcademicDataSeeder;
use Database\Seeders\ReportTemplateSeeder;
use Database\Seeders\RoleSeeder;
use Illuminate\Database\QueryException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Validation\ValidationException;
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

    public function test_only_one_active_representative_can_be_created_for_each_batch_scope(): void
    {
        $batch = $this->makeBatch();
        $first = User::factory()->role('student_rep', 'Student representative')->create();
        $second = User::factory()->role('student_rep', 'Student representative')->create();

        $this->actingAs($this->admin)
            ->postJson('/api/admin/rep-assignments', [
                'userId' => $first->id,
                'batchId' => $batch->id,
                'scope' => 'group',
            ])
            ->assertCreated();

        $this->actingAs($this->admin)
            ->postJson('/api/admin/rep-assignments', [
                'userId' => $second->id,
                'batchId' => $batch->id,
                'scope' => 'group',
            ])
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['scope']);

        $this->assertSame(1, RepAssignment::query()
            ->where('batch_id', $batch->id)
            ->where('scope', 'group')
            ->where('active', true)
            ->count());

        // The generated-column unique index is the final guard for stale or
        // non-HTTP writers that bypass the controller locks.
        try {
            RepAssignment::query()->create([
                'user_id' => $second->id,
                'batch_id' => $batch->id,
                'scope' => 'group',
                'active' => true,
            ]);
            $this->fail('The database accepted a second active group representative.');
        } catch (QueryException $exception) {
            $this->assertStringContainsString('unique', strtolower($exception->getMessage()));
        }
    }

    public function test_representative_can_have_only_one_active_assignment_globally(): void
    {
        $firstBatch = $this->makeBatch('C1', 'C1 2026-A');
        $secondBatch = $this->makeBatch('C1', 'C1 2026-B');
        $rep = User::factory()->role('student_rep', 'Student representative')->create();

        $activeAssignmentId = $this->actingAs($this->admin)
            ->postJson('/api/admin/rep-assignments', [
                'userId' => $rep->id,
                'batchId' => $firstBatch->id,
                'scope' => 'group',
            ])
            ->assertCreated()
            ->json('id');

        $this->actingAs($this->admin)
            ->postJson('/api/admin/rep-assignments', [
                'userId' => $rep->id,
                'batchId' => $secondBatch->id,
                'scope' => 'subgroup_a',
            ])
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['userId']);

        try {
            RepAssignment::query()->create([
                'user_id' => $rep->id,
                'batch_id' => $secondBatch->id,
                'scope' => 'subgroup_a',
                'active' => true,
            ]);
            $this->fail('The database accepted a second active assignment for one representative.');
        } catch (QueryException $exception) {
            $this->assertStringContainsString('unique', strtolower($exception->getMessage()));
        }

        $inactive = RepAssignment::query()->create([
            'user_id' => $rep->id,
            'batch_id' => $secondBatch->id,
            'scope' => 'subgroup_a',
            'active' => false,
        ]);

        $this->actingAs($this->admin)
            ->patchJson("/api/admin/rep-assignments/{$inactive->id}", ['active' => true])
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['userId']);
        $this->actingAs($this->admin)
            ->patchJson("/api/admin/rep-assignments/{$inactive->id}/active", ['active' => true])
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['userId']);

        $this->assertFalse($inactive->refresh()->active);
        $this->assertSame(1, RepAssignment::query()
            ->where('user_id', $rep->id)
            ->where('active', true)
            ->count());

        $secondBatch->forceFill(['active' => false])->save();
        $this->actingAs($this->admin)
            ->patchJson("/api/admin/rep-assignments/{$activeAssignmentId}", ['batchId' => $secondBatch->id])
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['batchId']);
        $this->assertSame($firstBatch->id, RepAssignment::query()->findOrFail($activeAssignmentId)->batch_id);

        $otherRep = User::factory()->role('student_rep', 'Student representative')->create();
        $this->actingAs($this->admin)
            ->postJson('/api/admin/rep-assignments', [
                'userId' => $otherRep->id,
                'batchId' => $secondBatch->id,
                'scope' => 'subgroup_b',
            ])
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['batchId']);
    }

    public function test_update_and_reactivation_reject_an_occupied_batch_scope(): void
    {
        $batch = $this->makeBatch();
        $groupRep = User::factory()->role('student_rep', 'Student representative')->create();
        $subgroupRep = User::factory()->role('student_rep', 'Student representative')->create();
        $inactiveRep = User::factory()->role('student_rep', 'Student representative')->create();

        $group = RepAssignment::query()->create([
            'user_id' => $groupRep->id,
            'batch_id' => $batch->id,
            'scope' => 'group',
            'active' => true,
        ]);
        $subgroup = RepAssignment::query()->create([
            'user_id' => $subgroupRep->id,
            'batch_id' => $batch->id,
            'scope' => 'subgroup_a',
            'active' => true,
        ]);
        $inactive = RepAssignment::query()->create([
            'user_id' => $inactiveRep->id,
            'batch_id' => $batch->id,
            'scope' => 'group',
            'active' => false,
        ]);

        $this->actingAs($this->admin)
            ->patchJson("/api/admin/rep-assignments/{$subgroup->id}", ['scope' => 'group'])
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['scope']);
        $this->assertSame('subgroup_a', $subgroup->refresh()->scope);

        $this->actingAs($this->admin)
            ->patchJson("/api/admin/rep-assignments/{$inactive->id}/active", ['active' => true])
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['scope']);
        $this->assertFalse($inactive->refresh()->active);

        // Once the incumbent is deactivated, reactivation is legal and the
        // same invariant still leaves exactly one active row.
        $this->actingAs($this->admin)
            ->patchJson("/api/admin/rep-assignments/{$group->id}/active", ['active' => false])
            ->assertOk();
        $this->actingAs($this->admin)
            ->patchJson("/api/admin/rep-assignments/{$inactive->id}/active", ['active' => true])
            ->assertOk()
            ->assertJsonPath('active', true);

        $this->assertSame(1, RepAssignment::query()
            ->where('batch_id', $batch->id)
            ->where('scope', 'group')
            ->where('active', true)
            ->count());
    }

    public function test_update_reloads_stale_assignment_state_before_reactivation(): void
    {
        $batch = $this->makeBatch();
        $incumbent = User::factory()->role('student_rep', 'Student representative')->create();
        $candidate = User::factory()->role('student_rep', 'Student representative')->create();

        RepAssignment::query()->create([
            'user_id' => $incumbent->id,
            'batch_id' => $batch->id,
            'scope' => 'group',
            'active' => true,
        ]);
        $assignment = RepAssignment::query()->create([
            'user_id' => $candidate->id,
            'batch_id' => $batch->id,
            'scope' => 'subgroup_a',
            'active' => false,
        ]);
        $staleBoundModel = $assignment->fresh();

        // Simulate a route-bound model becoming stale before the controller
        // acquires its lock. The fresh row now targets the occupied scope.
        $assignment->forceFill(['scope' => 'group'])->save();

        $request = Request::create(
            "/api/admin/rep-assignments/{$assignment->id}",
            'PATCH',
            ['active' => true],
        );
        $request->setUserResolver(fn () => $this->admin);
        $this->actingAs($this->admin);

        try {
            app(UndergraduateAdminController::class)->updateRepAssignment($request, $staleBoundModel);
            $this->fail('A stale model bypassed the occupied-scope check.');
        } catch (ValidationException $exception) {
            $this->assertArrayHasKey('scope', $exception->errors());
        }

        $assignment->refresh();
        $this->assertSame('group', $assignment->scope);
        $this->assertFalse($assignment->active);
    }

    public function test_dev_seeder_rerun_reactivates_stable_rep_after_deactivating_competitor(): void
    {
        $batch = $this->makeBatch();
        $stableRep = User::factory()->role('student_rep', 'Student representative')->create([
            'email' => 'student.rep.group@stpaulos.local',
            'active' => true,
        ]);
        $alternateRep = User::factory()->role('student_rep', 'Student representative')->create();
        $stable = RepAssignment::query()->create([
            'user_id' => $stableRep->id,
            'batch_id' => $batch->id,
            'scope' => 'group',
            'active' => false,
        ]);
        $alternate = RepAssignment::query()->create([
            'user_id' => $alternateRep->id,
            'batch_id' => $batch->id,
            'scope' => 'group',
            'active' => true,
        ]);

        $method = new \ReflectionMethod(DevAcademicDataSeeder::class, 'ensureStableRepresentativeAssignment');
        $seeder = app(DevAcademicDataSeeder::class);

        // Invoke twice to model a true rerun from the previously problematic
        // inactive-stable/active-alternate state and then its settled state.
        $method->invoke($seeder, $batch, 'group');
        $method->invoke($seeder, $batch, 'group');

        $this->assertTrue($stable->refresh()->active);
        $this->assertFalse($alternate->refresh()->active);
        $this->assertSame(1, RepAssignment::query()
            ->where('batch_id', $batch->id)
            ->where('scope', 'group')
            ->where('active', true)
            ->count());
        $this->assertSame('student.rep.group', $stableRep->refresh()->username);
    }

    public function test_dev_seeder_activates_stable_rep_only_for_the_current_batch(): void
    {
        $historicalBatch = $this->makeBatch('C1', 'C1 Historical');
        $currentBatch = $this->makeBatch('C1', 'C1 Current');
        $stableRep = User::factory()->role('student_rep', 'Student representative')->create([
            'email' => 'student.rep.group@stpaulos.local',
            'active' => true,
        ]);
        $historical = RepAssignment::query()->create([
            'user_id' => $stableRep->id,
            'batch_id' => $historicalBatch->id,
            'scope' => 'group',
            'active' => true,
        ]);

        $method = new \ReflectionMethod(DevAcademicDataSeeder::class, 'ensureStableRepresentativeAssignment');
        $seeder = app(DevAcademicDataSeeder::class);
        $method->invoke($seeder, $historicalBatch, 'group', false);
        $current = $method->invoke($seeder, $currentBatch, 'group', true);

        $this->assertFalse($historical->refresh()->active);
        $this->assertTrue($current->refresh()->active);
        $this->assertSame($currentBatch->id, RepAssignment::query()
            ->where('user_id', $stableRep->id)
            ->where('active', true)
            ->sole()
            ->batch_id);
    }

    public function test_dev_seeder_retires_legacy_generated_rep_login_without_deleting_history(): void
    {
        $batch = $this->makeBatch();
        $legacyRep = User::factory()->role('student_rep', 'Student representative')->create([
            'email' => "demo.batch{$batch->id}.r1@stpaulos.local",
            'username' => "demo.batch{$batch->id}.r1",
            'active' => true,
        ]);
        $legacyAssignment = RepAssignment::query()->create([
            'user_id' => $legacyRep->id,
            'batch_id' => $batch->id,
            'scope' => 'group',
            'active' => true,
        ]);
        $unrelatedRep = User::factory()->role('student_rep', 'Student representative')->create([
            'email' => 'student.rep.group@stpaulos.local',
            'username' => 'student.rep.group',
            'active' => true,
        ]);

        $method = new \ReflectionMethod(DevAcademicDataSeeder::class, 'retireLegacyRepresentativeAccounts');
        $method->invoke(app(DevAcademicDataSeeder::class));

        $this->assertFalse($legacyRep->refresh()->active);
        $this->assertFalse($legacyAssignment->refresh()->active);
        $this->assertTrue($unrelatedRep->refresh()->active);
        $this->assertDatabaseHas('users', ['id' => $legacyRep->id]);
        $this->assertDatabaseHas('rep_assignments', ['id' => $legacyAssignment->id]);
    }

    public function test_batch_deactivation_atomically_revokes_representative_scope(): void
    {
        $batch = $this->makeBatch();
        app(TeachingService::class)->generateSessions(Carbon::parse('2026-09-14'));
        $rep = $this->makeRep($batch, 'group');
        $assignment = RepAssignment::query()->where('user_id', $rep->id)->firstOrFail();
        $lecture = TeachingSession::query()->where('batch_id', $batch->id)->where('activity_type', 'lecture')->firstOrFail();

        $this->actingAs($rep)
            ->getJson('/api/teaching/my-sessions')
            ->assertOk();
        $this->actingAs($rep)
            ->getJson('/api/workspace')
            ->assertOk()
            ->assertJsonPath('academic.repScope.batchId', $batch->id);

        $this->actingAs($this->admin)
            ->deleteJson("/api/admin/student-batches/{$batch->id}")
            ->assertNoContent();

        $this->assertFalse($batch->refresh()->active);
        $this->assertFalse($assignment->refresh()->active);

        $this->actingAs($this->admin)
            ->patchJson("/api/admin/rep-assignments/{$assignment->id}/active", ['active' => true])
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['batchId']);
        $this->assertFalse($assignment->refresh()->active);

        // Even an out-of-band write cannot restore authority for an inactive
        // batch because every operational read also checks batch.active.
        $assignment->forceFill(['active' => true])->save();
        $this->actingAs($rep)
            ->getJson('/api/teaching/my-sessions')
            ->assertForbidden();
        $this->actingAs($rep)
            ->postJson("/api/teaching/sessions/{$lecture->id}/record", ['status' => 'held'])
            ->assertForbidden();
        $this->actingAs($rep)
            ->getJson('/api/workspace')
            ->assertOk()
            ->assertJsonPath('academic.repScope', null);
    }

    public function test_batch_update_deactivation_also_revokes_representative_scope(): void
    {
        $batch = $this->makeBatch();
        $rep = $this->makeRep($batch, 'group');
        $assignment = RepAssignment::query()->where('user_id', $rep->id)->firstOrFail();

        $this->actingAs($this->admin)
            ->patchJson("/api/admin/student-batches/{$batch->id}", ['active' => false])
            ->assertOk()
            ->assertJsonPath('active', false);

        $this->assertFalse($assignment->refresh()->active);
        $this->actingAs($rep)
            ->getJson('/api/teaching/my-sessions')
            ->assertForbidden();
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
            'section_id' => Section::query()->where('slug', 'nephrology')->value('id'),
        ]);
        $transferRequest = TransferRequest::query()->create([
            'user_id' => $consultant->id,
            'from_section_id' => Section::query()->where('slug', 'nephrology')->value('id'),
            'to_section_id' => Section::query()->where('slug', 'cardiology')->value('id'),
        ]);
        $formId = EvaluationForm::query()->where('key', 'consultant_mdt')->value('id');

        // Asserted against the live route list, not a hand-maintained one:
        // every AUTHENTICATED /api/academic and /api/admin/academic route must
        // refuse a rep. (The public self-registration endpoint shares the
        // prefix but sits outside auth:sanctum.)
        $routes = collect(app('router')->getRoutes()->getRoutes())
            ->filter(fn ($route) => (str_starts_with($route->uri(), 'api/academic')
                    || str_starts_with($route->uri(), 'api/admin/academic'))
                && in_array('auth:sanctum', $route->gatherMiddleware(), true));

        $this->assertNotEmpty($routes);

        $morningSession = MorningSession::query()->create([
            'session_date' => '2026-09-14',
            'scheduled_start_at' => '08:00',
        ]);

        $bindings = [
            '{key}' => 'consultant_mdt',
            '{transferRequest}' => $transferRequest->id,
            '{evaluationForm}' => $formId,
            '{ward}' => Ward::query()->value('id'),
            '{section}' => Section::query()->value('id'),
            '{dutyType}' => DutyType::query()->value('id'),
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
                'csv' => 'Alem Kebede,ETS0101,A
Alem Kebede,ETS0202,B
Alem Kebede,ETS0101,A',
            ])
            ->assertCreated()
            ->assertJsonPath('created', 2)
            ->assertJsonPath('skipped', 1);

        // Name-only lines fall back to name dedupe.
        $this->actingAs($this->admin)
            ->postJson('/api/admin/students/import', [
                'batchId' => $batch->id,
                'csv' => 'Birtukan Mengistu
Birtukan Mengistu',
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

    public function test_placement_save_and_delete_re_snapshot_the_weeks_pending_sessions(): void
    {
        $batch = $this->makeBatch();
        $ward = Ward::query()->where('slug', 'pulmonology_ward')->firstOrFail();
        app(TeachingService::class)->generateSessions(Carbon::parse('2026-09-14'));

        $bedside = TeachingSession::query()
            ->where('batch_id', $batch->id)
            ->where('activity_type', 'bedside')
            ->where('subgroup', 'A')
            ->firstOrFail();
        $this->assertNull($bedside->ward_id);

        // Saving the week's placement re-points the pending session.
        $placementId = $this->actingAs($this->admin)
            ->postJson('/api/admin/subgroup-placements', [
                'batchId' => $batch->id,
                'subgroup' => 'A',
                'wardId' => $ward->id,
                'weekStartsOn' => '2026-09-14',
            ])
            ->assertCreated()
            ->json('id');

        $this->assertSame($ward->id, $bedside->refresh()->ward_id);

        // Deleting it re-snapshots back to no ward.
        $this->actingAs($this->admin)
            ->deleteJson("/api/admin/subgroup-placements/{$placementId}")
            ->assertNoContent();

        $this->assertNull($bedside->refresh()->ward_id);
    }

    public function test_deactivating_a_schedule_row_stops_future_generation(): void
    {
        $this->makeBatch();

        $lectureRow = TeachingActivitySchedule::query()
            ->where('cohort', 'C1')
            ->where('weekday', 1)
            ->where('activity_type', 'lecture')
            ->firstOrFail();

        $this->actingAs($this->admin)
            ->patchJson("/api/admin/teaching-schedules/{$lectureRow->id}/active", ['active' => false])
            ->assertOk()
            ->assertJsonPath('active', false);

        // Monday generation now yields only the two bedside rows.
        app(TeachingService::class)->generateSessions(Carbon::parse('2026-09-21'));
        $this->assertSame(
            0,
            TeachingSession::query()
                ->where('activity_type', 'lecture')
                ->whereDate('scheduled_date', '2026-09-21')
                ->count(),
        );
    }

    public function test_schedule_deactivation_reconciles_pending_rows_and_preserves_recorded_history(): void
    {
        $batch = $this->makeBatch();
        $service = app(TeachingService::class);
        $service->generateRange(Carbon::parse('2026-09-14'), Carbon::parse('2026-09-21'));

        $today = TeachingSession::query()
            ->where('batch_id', $batch->id)
            ->where('activity_type', 'lecture')
            ->whereDate('scheduled_date', '2026-09-14')
            ->firstOrFail();
        $nextWeek = TeachingSession::query()
            ->where('batch_id', $batch->id)
            ->where('activity_type', 'lecture')
            ->whereDate('scheduled_date', '2026-09-21')
            ->firstOrFail();
        $rep = $this->makeRep($batch, 'group');

        $this->actingAs($rep)
            ->postJson("/api/teaching/sessions/{$today->id}/record", ['status' => 'held'])
            ->assertOk();

        $lectureRow = TeachingActivitySchedule::query()
            ->where('cohort', 'C1')
            ->where('weekday', 1)
            ->where('activity_type', 'lecture')
            ->firstOrFail();

        $this->actingAs($this->admin)
            ->patchJson("/api/admin/teaching-schedules/{$lectureRow->id}/active", ['active' => false])
            ->assertOk();

        $this->assertDatabaseHas('teaching_sessions', [
            'id' => $today->id,
            'status' => 'held',
        ]);
        $this->assertDatabaseMissing('teaching_sessions', ['id' => $nextWeek->id]);
    }

    public function test_obsolete_pending_teaching_rows_are_hidden_and_cannot_be_recorded(): void
    {
        $batch = $this->makeBatch();
        $student = Student::query()->create([
            'batch_id' => $batch->id,
            'full_name' => 'Schedule Guard Student',
            'external_id' => 'SG-001',
            'subgroup' => 'A',
        ]);
        $rep = $this->makeRep($batch, 'group');
        $consultant = User::factory()->role('consultant', 'Consultant')->create();

        // This row deliberately simulates an out-of-band write after cleanup:
        // Monday seminars are not part of C1's active program.
        $obsolete = TeachingSession::query()->create([
            'batch_id' => $batch->id,
            'subgroup' => null,
            'activity_type' => 'seminar',
            'scheduled_date' => '2026-09-14',
        ]);

        $this->actingAs($rep)
            ->getJson('/api/teaching/my-sessions')
            ->assertOk()
            ->assertJsonMissing(['id' => $obsolete->id]);
        $this->actingAs($rep)
            ->postJson("/api/teaching/sessions/{$obsolete->id}/record", ['status' => 'held'])
            ->assertForbidden();
        $this->actingAs($consultant)
            ->getJson('/api/teaching/today')
            ->assertOk()
            ->assertJsonMissing(['id' => $obsolete->id]);
        $this->actingAs($consultant)
            ->putJson("/api/teaching/sessions/{$obsolete->id}/attendance", [
                'presence' => [$student->id => true],
            ])
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['session']);

        $this->assertDatabaseMissing('student_attendance', [
            'teaching_session_id' => $obsolete->id,
        ]);
        $this->assertSame('pending', $obsolete->refresh()->status);
    }

    public function test_admin_resource_lifecycle_routes_are_complete_and_history_safe(): void
    {
        $batch = $this->makeBatch();
        $student = Student::query()->create([
            'batch_id' => $batch->id,
            'full_name' => 'Lifecycle Student',
            'external_id' => 'LC-001',
            'subgroup' => 'A',
        ]);
        $ward = Ward::query()->where('slug', 'nephrology_ward')->firstOrFail();
        $otherWard = Ward::query()->where('id', '!=', $ward->id)->firstOrFail();

        $this->actingAs($this->admin)
            ->getJson("/api/admin/student-batches/{$batch->id}")
            ->assertOk()
            ->assertJsonPath('studentCount', 1);
        $this->actingAs($this->admin)
            ->getJson("/api/admin/students/{$student->id}")
            ->assertOk()
            ->assertJsonPath('externalId', 'LC-001');

        $placementId = $this->actingAs($this->admin)
            ->postJson('/api/admin/subgroup-placements', [
                'batchId' => $batch->id,
                'subgroup' => 'A',
                'wardId' => $ward->id,
                'weekStartsOn' => '2026-09-14',
            ])
            ->assertCreated()
            ->json('id');
        $this->actingAs($this->admin)
            ->getJson("/api/admin/subgroup-placements/{$placementId}")
            ->assertOk()
            ->assertJsonPath('wardId', $ward->id);
        $this->actingAs($this->admin)
            ->patchJson("/api/admin/subgroup-placements/{$placementId}", ['wardId' => $otherWard->id])
            ->assertOk()
            ->assertJsonPath('wardId', $otherWard->id);

        $scheduleCombination = collect(StudentBatch::COHORTS)
            ->crossJoin(TeachingActivitySchedule::ACTIVITY_TYPES, range(1, 7))
            ->first(fn (array $parts) => ! TeachingActivitySchedule::query()
                ->where('cohort', $parts[0])
                ->where('activity_type', $parts[1])
                ->where('weekday', $parts[2])
                ->exists());
        $this->assertNotNull($scheduleCombination);
        [$cohort, $activityType, $weekday] = $scheduleCombination;
        $scope = in_array($activityType, ['lecture', 'seminar'], true) ? 'cohort' : 'subgroup';

        $scheduleId = $this->actingAs($this->admin)
            ->postJson('/api/admin/teaching-schedules', [
                'cohort' => $cohort,
                'activityType' => $activityType,
                'weekday' => $weekday,
                'scope' => $scope,
            ])
            ->assertCreated()
            ->json('id');
        $this->actingAs($this->admin)
            ->getJson("/api/admin/teaching-schedules/{$scheduleId}")
            ->assertOk();
        $this->actingAs($this->admin)
            ->patchJson("/api/admin/teaching-schedules/{$scheduleId}", ['active' => false])
            ->assertOk()
            ->assertJsonPath('active', false);
        $this->actingAs($this->admin)
            ->deleteJson("/api/admin/teaching-schedules/{$scheduleId}")
            ->assertNoContent();

        $rep = User::factory()->role('student_rep', 'Student representative')->create();
        $assignmentId = $this->actingAs($this->admin)
            ->postJson('/api/admin/rep-assignments', [
                'userId' => $rep->id,
                'batchId' => $batch->id,
                'scope' => 'group',
            ])
            ->assertCreated()
            ->json('id');
        $this->actingAs($this->admin)
            ->getJson("/api/admin/rep-assignments/{$assignmentId}")
            ->assertOk()
            ->assertJsonPath('scope', 'group');
        $this->actingAs($this->admin)
            ->patchJson("/api/admin/rep-assignments/{$assignmentId}", ['scope' => 'subgroup_a'])
            ->assertOk()
            ->assertJsonPath('scope', 'subgroup_a');
        $this->actingAs($this->admin)
            ->deleteJson("/api/admin/rep-assignments/{$assignmentId}")
            ->assertNoContent();
        $this->assertFalse(RepAssignment::query()->findOrFail($assignmentId)->active);

        $this->actingAs($this->admin)
            ->deleteJson("/api/admin/students/{$student->id}")
            ->assertNoContent();
        $this->actingAs($this->admin)
            ->deleteJson("/api/admin/student-batches/{$batch->id}")
            ->assertNoContent();

        $this->assertFalse($student->refresh()->active);
        $this->assertFalse($batch->refresh()->active);

        $nurse = User::factory()->role('nurse', 'Nurse')->create();
        $this->actingAs($nurse)
            ->getJson("/api/admin/student-batches/{$batch->id}")
            ->assertForbidden();
    }
}
