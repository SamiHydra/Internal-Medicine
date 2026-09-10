<?php

namespace Tests\Feature;

use App\Models\ActionItem;
use App\Models\Department;
use App\Models\DutyAssignment;
use App\Models\DutyType;
use App\Models\Evaluation;
use App\Models\EvaluationForm;
use App\Models\Report;
use App\Models\ReportAssignment;
use App\Models\ReportingPeriod;
use App\Models\ReportTemplate;
use App\Models\Section;
use App\Models\StudentBatch;
use App\Models\SubgroupPlacement;
use App\Models\TransferRequest;
use App\Models\User;
use App\Models\Ward;
use App\Services\Academic\TransferService;
use Database\Seeders\DepartmentSeeder;
use Database\Seeders\ReportFieldDefinitionSeeder;
use Database\Seeders\ReportTemplateSeeder;
use Database\Seeders\RoleSeeder;
use Illuminate\Database\QueryException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;
use Tests\TestCase;

/**
 * Pre-server hardening, priority 9: every invalid state the platform must
 * never hold is attempted here through the real endpoints first and then,
 * where a state is only reachable by a direct write, against the schema
 * itself. Each test names the layer that refused the write (request
 * validation, service/domain guard, database constraint) so a regression in
 * one layer is visible even while another still catches it.
 *
 * Engine note: the suite runs on SQLite; the deployment runs on MariaDB.
 * Foreign keys and unique indexes behave identically on both. The `enum()`
 * columns are a native ENUM on MariaDB (rejected under the strict SQL mode
 * Laravel enables) and a CHECK constraint on SQLite, which survives only
 * while the table is never rebuilt by a later foreign-key migration; the
 * status probes below therefore also pin that the CHECK is still present.
 */
class DataIntegrityInvariantsTest extends TestCase
{
    use RefreshDatabase;

    /** One valid inpatient value (a Monday total) so report writes pass validation. */
    private const VALUES = ['total_patient_days' => ['dailyValues' => ['monday' => 12]]];

    private User $superadmin;

    private User $admin;

    private User $nurse;

    private Department $department;

    private ReportTemplate $template;

    private ReportAssignment $assignment;

    private ReportingPeriod $period;

    protected function setUp(): void
    {
        parent::setUp();

        foreach ([RoleSeeder::class, ReportTemplateSeeder::class, DepartmentSeeder::class, ReportFieldDefinitionSeeder::class] as $seeder) {
            $this->seed($seeder);
        }

        $this->superadmin = User::factory()->role('superadmin', 'Maintenance')->create();
        $this->admin = User::factory()->role('admin', 'Administrator')->create(['full_name' => 'Admin One']);
        $this->nurse = User::factory()->create([
            'full_name' => 'Hana Abera',
            'email' => 'hana@example.test',
            'username' => 'hana.abera',
        ]);

        $this->template = ReportTemplate::query()->where('slug', 'inpatient_weekly')->firstOrFail();
        $this->department = Department::query()->where('slug', 'gi_neuro_inpatient')->firstOrFail();

        $this->assignment = ReportAssignment::query()->create([
            'nurse_id' => $this->nurse->id,
            'department_id' => $this->department->id,
            'template_id' => $this->template->id,
            'active' => true,
            'approved_at' => now(),
        ]);

        // A week that has already started, so the future-period rule (QA-009)
        // does not interfere with what these tests are about.
        $weekStart = Carbon::now('Africa/Nairobi')->startOfWeek()->subWeek();
        $this->period = ReportingPeriod::query()->create([
            'week_start' => $weekStart->toDateString(),
            'week_end' => $weekStart->copy()->addDays(6)->toDateString(),
            'deadline_at' => $weekStart->copy()->addWeek()->setTime(10, 0),
            'month_label' => $weekStart->format('M Y'),
            'quarter_label' => sprintf('Q%d %d', $weekStart->quarter, $weekStart->year),
            'year_num' => $weekStart->year,
        ]);
    }

    // ---- 1. A report without an assignment ----

    /**
     * Request: an unknown assignment id is a 404 from the route's findOrFail.
     * Domain: retiring an assignment is a soft deactivate (active=false), so
     * its reports keep their parent. DB: reports.assignment_id is a foreign
     * key (reports_assignment_id_foreign).
     *
     * Known DB-level gap, documented rather than asserted: that foreign key
     * is ON DELETE CASCADE, so a raw `DELETE FROM report_assignments` would
     * remove the reports silently. No application path hard-deletes an
     * assignment (the model has no destroy route), which is why the cascade
     * has never fired, but a restrict action would be the safer contract.
     */
    public function test_a_report_cannot_exist_without_an_assignment(): void
    {
        $this->actingAs($this->nurse)
            ->postJson('/api/reports', [
                'assignmentId' => (string) Str::uuid(),
                'reportingPeriodId' => $this->period->id,
                'values' => self::VALUES,
            ])
            ->assertNotFound();
        $this->assertDatabaseCount('reports', 0);

        $this->assertWriteIsRejected(
            fn () => DB::table('reports')->insert($this->rawReportRow(['assignment_id' => (string) Str::uuid()])),
            'reports.assignment_id accepted a value that references no assignment.',
        );
        $this->assertDatabaseCount('reports', 0);

        $report = $this->createReport();

        $this->actingAs($this->admin)
            ->deleteJson("/api/admin/assignments/{$this->assignment->id}")
            ->assertOk()
            ->assertJsonPath('active', false);

        $this->assertDatabaseHas('report_assignments', ['id' => $this->assignment->id, 'active' => false]);
        $this->assertDatabaseHas('reports', ['id' => $report->id, 'assignment_id' => $this->assignment->id]);
    }

    // ---- 2. Duplicate active assignment ----

    /**
     * Domain: the store endpoint is an updateOrCreate keyed on the natural key,
     * so a repeat POST re-points the existing row (200) instead of inserting.
     * DB: report_assignments_nurse_id_department_id_template_id_unique.
     */
    public function test_a_duplicate_assignment_for_the_same_nurse_department_and_template_collapses_to_one_row(): void
    {
        $nurse = User::factory()->create(['email' => 'second.nurse@example.test', 'username' => 'second.nurse']);
        $payload = [
            'nurseId' => $nurse->id,
            'departmentId' => $this->department->slug,
            'templateId' => $this->template->slug,
        ];

        $first = $this->actingAs($this->admin)->postJson('/api/admin/assignments', $payload)->assertCreated();
        $second = $this->actingAs($this->admin)->postJson('/api/admin/assignments', $payload)->assertOk();

        $this->assertSame($first->json('id'), $second->json('id'));
        $this->assertSame(1, ReportAssignment::query()->where('nurse_id', $nurse->id)->count());
        $this->assertTrue((bool) ReportAssignment::query()->where('nurse_id', $nurse->id)->value('active'));

        $this->assertWriteIsRejected(
            fn () => DB::table('report_assignments')->insert([
                'id' => (string) Str::uuid(),
                'nurse_id' => $nurse->id,
                'department_id' => $this->department->id,
                'template_id' => $this->template->id,
                'active' => true,
                'approved_at' => now(),
                'created_at' => now(),
                'updated_at' => now(),
            ]),
            'report_assignments accepted a second row for the same nurse, department and template.',
        );
        $this->assertSame(1, ReportAssignment::query()->where('nurse_id', $nurse->id)->count());
    }

    // ---- 3. Invalid role relationship ----

    /**
     * Request: UserController::ASSIGNABLE_ROLES (admin, nurse, student_rep)
     * is the Rule::in on both store and update, so `superadmin` (Maintenance
     * is DB-only by design) and any unknown key are 422s. DB: the
     * users.role_key foreign key to roles.role_key refuses a key that has no
     * roles row, on both engines.
     */
    public function test_a_user_cannot_hold_a_role_outside_the_roles_table(): void
    {
        foreach (['superadmin', 'doctor_admin', 'bogus_role'] as $role) {
            $this->actingAs($this->superadmin)
                ->postJson('/api/admin/users', [
                    'fullName' => 'Role Probe',
                    'email' => "role.probe.{$role}@example.test",
                    'password' => 'StPaul2026!Strong#Probe',
                    'role' => $role,
                ])
                ->assertStatus(422)
                ->assertJsonValidationErrors('role');
        }

        foreach (['superadmin', 'bogus_role'] as $role) {
            $this->actingAs($this->superadmin)
                ->patchJson("/api/admin/users/{$this->nurse->id}", ['role' => $role])
                ->assertStatus(422)
                ->assertJsonValidationErrors('role');
        }

        $this->assertSame(1, User::query()->where('role_key', 'superadmin')->count());
        $this->assertSame('nurse', $this->nurse->fresh()->role_key);

        $this->assertWriteIsRejected(
            fn () => DB::table('users')->where('id', $this->nurse->id)->update(['role_key' => 'bogus_role']),
            'users.role_key accepted a key that has no roles row.',
        );
        $this->assertSame('nurse', $this->nurse->fresh()->role_key);
    }

    // ---- 4. Student representative with clinical access ----

    /**
     * The reverse direction of RoleTransitionAuthorizationTest (which proves
     * a nurse cannot be converted while assignments are live and that a stale
     * assignment never grants access): here an existing student_rep, and
     * every other non-nurse role, is refused a department assignment.
     * Request/domain: ReportAssignmentController::store's role check (422).
     * DB: none; report_assignments.nurse_id only requires a users row, so the
     * controller guard and the report policies are the two layers.
     */
    public function test_a_student_representative_cannot_be_given_a_clinical_assignment(): void
    {
        $rep = User::factory()->role('student_rep', 'Student representative')->create();
        $resident = User::factory()->role('resident', 'Resident')->create();

        foreach ([$rep, $resident, $this->admin] as $account) {
            $this->actingAs($this->admin)
                ->postJson('/api/admin/assignments', [
                    'nurseId' => $account->id,
                    'departmentId' => $this->department->slug,
                    'templateId' => $this->template->slug,
                ])
                ->assertStatus(422)
                ->assertJsonValidationErrors('nurse_id');
        }

        $this->assertSame(0, ReportAssignment::query()->whereIn('nurse_id', [$rep->id, $resident->id, $this->admin->id])->count());

        // A student_rep cannot even reach the report surfaces with a live
        // assignment planted underneath them (policy layer, in depth).
        ReportAssignment::query()->create([
            'nurse_id' => $rep->id,
            'department_id' => $this->department->id,
            'template_id' => $this->template->id,
            'active' => true,
            'approved_at' => now(),
        ]);
        $planted = ReportAssignment::query()->where('nurse_id', $rep->id)->firstOrFail();

        $this->actingAs($rep)
            ->postJson('/api/reports', [
                'assignmentId' => $planted->id,
                'reportingPeriodId' => $this->period->id,
                'values' => self::VALUES,
            ])
            ->assertForbidden();
        $this->actingAs($rep)->getJson('/api/workspace')->assertOk()->assertJsonCount(0, 'state.assignments');
        $this->assertDatabaseCount('reports', 0);
    }

    // ---- 5. Evaluation author/subject pairing ----

    /**
     * Request: evaluation_date must be before_or_equal today. Domain: the
     * author must hold the opposite role of the form's direction (so an
     * author can never be their own subject: the subject role check refuses
     * it), the subject must hold the expected role, and author and subject
     * must share a duty placement on the evaluation date (RosterService).
     * DB: the evaluations_enforce_sources_* triggers pin exactly one subject
     * and exactly one evaluator source; there is no author <> subject check
     * at the schema level (documented gap; unreachable through the API).
     */
    public function test_an_evaluation_with_an_invalid_author_subject_pairing_is_refused(): void
    {
        [$resident, $consultant] = $this->placeAcademicPair();
        $peerResident = User::factory()->role('resident', 'Resident')->create();
        $this->placeOnGastroWard($peerResident);

        $date = now()->subDays(3)->toDateString();

        // A resident evaluating themselves.
        $this->actingAs($resident)
            ->postJson('/api/academic/consultant-evaluations', $this->consultantEvaluationPayload($resident->id, $date))
            ->assertStatus(422)
            ->assertJsonValidationErrors('subjectId');

        // A consultant evaluation whose subject is not a consultant.
        $this->actingAs($resident)
            ->postJson('/api/academic/consultant-evaluations', $this->consultantEvaluationPayload($peerResident->id, $date))
            ->assertStatus(422)
            ->assertJsonValidationErrors('subjectId');

        // A consultant evaluating themselves through the resident form.
        $this->actingAs($consultant)
            ->postJson('/api/academic/resident-evaluations', $this->residentEvaluationPayload($consultant->id, $date))
            ->assertStatus(422)
            ->assertJsonValidationErrors('subjectId');

        // A date in the future.
        $this->actingAs($resident)
            ->postJson('/api/academic/consultant-evaluations', $this->consultantEvaluationPayload($consultant->id, now()->addDays(2)->toDateString()))
            ->assertStatus(422)
            ->assertJsonValidationErrors('evaluation_date');

        // A date on which the two were not placed together.
        $this->actingAs($resident)
            ->postJson('/api/academic/consultant-evaluations', $this->consultantEvaluationPayload($consultant->id, now()->subDays(60)->toDateString()))
            ->assertStatus(422)
            ->assertJsonValidationErrors('subjectId');

        $this->assertDatabaseCount('evaluations', 0);

        // Control: the same payload with a valid pairing goes through, so the
        // refusals above are the guards and not a broken fixture.
        $this->actingAs($resident)
            ->postJson('/api/academic/consultant-evaluations', $this->consultantEvaluationPayload($consultant->id, $date))
            ->assertCreated();
        $this->assertDatabaseCount('evaluations', 1);

        // DB: the header trigger refuses a row with two subjects or no author source.
        $form = EvaluationForm::query()->where('key', 'consultant_mdt')->where('status', 'published')->firstOrFail();
        $this->assertWriteIsRejected(
            fn () => DB::table('evaluations')->insert([
                'id' => (string) Str::uuid(),
                'form_id' => $form->id,
                'form_key' => 'consultant_mdt',
                'author_id' => null,
                'external_evaluator_name' => null,
                'subject_user_id' => $consultant->id,
                'evaluation_date' => $date,
                'created_at' => now(),
                'updated_at' => now(),
            ]),
            'evaluations accepted a row with neither an author nor an external evaluator.',
        );
        $this->assertDatabaseCount('evaluations', 1);
    }

    // ---- 6. Duplicate placement and roster rows ----

    /**
     * Placements. Domain: storePlacement looks the subgroup-week up first and
     * re-points it (QA-010). DB: subgroup_placements_batch_id_subgroup_week_starts_on_unique,
     * translated to a 422 if the lookup ever misses.
     *
     * Roster. Domain: RosterService::bulkAssign carves the person's monthly
     * window before writing (so one person is one monthly row per month) and
     * deletes an identical daily row before re-inserting it; createAssignment
     * refuses an overlapping monthly row outright
     * (RosterTest::test_overlap_guard_rejects_second_monthly_assignment_but_accepts_stacked_daily).
     * DB: none, by design (the duty_assignments migration explains that daily
     * duties legitimately stack on a service month).
     */
    public function test_duplicate_placements_and_roster_rows_collapse_to_one_row(): void
    {
        $batch = StudentBatch::query()->create([
            'cohort' => 'C1',
            'label' => 'C1 2026-A',
            'starts_on' => '2026-09-14',
            'ends_on' => '2026-12-06',
        ]);
        $nephrologyWard = Ward::query()->where('slug', 'nephrology_ward')->firstOrFail();
        $gastroWard = Ward::query()->where('slug', 'gastro_neurology_ward')->firstOrFail();
        $placement = ['batchId' => $batch->id, 'subgroup' => 'A', 'weekStartsOn' => '2026-09-14'];

        $this->actingAs($this->admin)
            ->postJson('/api/admin/subgroup-placements', [...$placement, 'wardId' => $nephrologyWard->id])
            ->assertCreated();
        $this->actingAs($this->admin)
            ->postJson('/api/admin/subgroup-placements', [...$placement, 'wardId' => $gastroWard->id])
            ->assertCreated();

        $rows = SubgroupPlacement::query()->where('batch_id', $batch->id)->where('subgroup', 'A')->get();
        $this->assertCount(1, $rows);
        $this->assertSame($gastroWard->id, $rows->first()->ward_id);

        // Probe the unique index with the value exactly as stored. MariaDB
        // normalises every DATE literal, but SQLite compares the raw string
        // and Eloquent writes date casts with a time component (the QA-010
        // root cause), so '2026-09-14' would slip past the index here while
        // '2026-09-14 00:00:00' would not.
        $storedWeekStart = DB::table('subgroup_placements')->where('id', $rows->first()->id)->value('week_starts_on');
        $this->assertWriteIsRejected(
            fn () => DB::table('subgroup_placements')->insert([
                'id' => (string) Str::uuid(),
                'batch_id' => $batch->id,
                'subgroup' => 'A',
                'ward_id' => $nephrologyWard->id,
                'week_starts_on' => $storedWeekStart,
                'week_ends_on' => '2026-09-20',
                'created_by' => $this->admin->id,
                'created_at' => now(),
                'updated_at' => now(),
            ]),
            'subgroup_placements accepted a second row for the same subgroup and week.',
        );
        $this->assertSame(1, SubgroupPlacement::query()->where('batch_id', $batch->id)->where('subgroup', 'A')->count());

        $consultant = User::factory()->role('consultant', 'Consultant')->create();
        $wardService = DutyType::query()->where('slug', 'nephrology_ward_service')->firstOrFail();
        $dialysis = DutyType::query()->where('slug', 'dialysis')->firstOrFail();
        $transition = DutyType::query()->where('slug', 'transition_ward_duty')->firstOrFail();

        // The same person twice in one month save: the later cell wins, one row.
        $this->actingAs($this->admin)
            ->putJson('/api/admin/roster/2026/10', [
                'assignments' => [
                    ['userId' => $consultant->id, 'dutyTypeId' => $wardService->id],
                    ['userId' => $consultant->id, 'dutyTypeId' => $dialysis->id],
                ],
            ])
            ->assertOk();
        $this->assertSame(1, DutyAssignment::query()->where('user_id', $consultant->id)->count());
        $this->assertDatabaseHas('duty_assignments', ['user_id' => $consultant->id, 'duty_type_id' => $dialysis->id]);

        // Saving the same month again replaces rather than stacks.
        $this->actingAs($this->admin)
            ->putJson('/api/admin/roster/2026/10', [
                'assignments' => [['userId' => $consultant->id, 'dutyTypeId' => $wardService->id]],
            ])
            ->assertOk();
        $this->assertSame(1, DutyAssignment::query()->where('user_id', $consultant->id)->count());

        // The same daily duty on the same day twice is one row.
        foreach ([1, 2] as $attempt) {
            $this->actingAs($this->admin)
                ->postJson('/api/admin/roster/daily', [
                    'userId' => $consultant->id,
                    'dutyTypeId' => $transition->id,
                    'date' => '2026-10-05',
                ])
                ->assertCreated();
        }
        $this->assertSame(1, DutyAssignment::query()
            ->where('user_id', $consultant->id)
            ->where('duty_type_id', $transition->id)
            ->count());
        $this->assertSame(2, DutyAssignment::query()->where('user_id', $consultant->id)->count());
    }

    // ---- 7. Orphan evidence ----

    /**
     * Domain: there is no endpoint that deletes an action item, and evidence
     * is only ever written against a route-bound item. DB:
     * action_item_evidence.action_item_id is a cascading foreign key, so a
     * dangling id is refused and a removed item takes its evidence rows with
     * it. Files on disk are not covered by the cascade (documented; no
     * application path deletes an item).
     */
    public function test_evidence_cannot_outlive_or_precede_its_action_item(): void
    {
        Storage::fake('local');

        $itemId = $this->actingAs($this->admin)
            ->postJson('/api/admin/action-items', ['title' => 'Integrity probe', 'severity' => 'medium'])
            ->assertCreated()
            ->json('id');

        $evidenceId = $this->actingAs($this->admin)
            ->post("/api/admin/action-items/{$itemId}/evidence", [
                'file' => UploadedFile::fake()->create('evidence.pdf', 12, 'application/pdf'),
            ], ['Accept' => 'application/json'])
            ->assertCreated()
            ->json('id');
        $this->assertDatabaseHas('action_item_evidence', ['id' => $evidenceId, 'action_item_id' => $itemId]);

        $this->assertWriteIsRejected(
            fn () => DB::table('action_item_evidence')->insert([
                'id' => (string) Str::uuid(),
                'action_item_id' => (string) Str::uuid(),
                'uploaded_by' => $this->admin->id,
                'original_name' => 'orphan.pdf',
                'disk' => 'local',
                'file_path' => 'action-items/orphan/orphan.pdf',
                'mime_type' => 'application/pdf',
                'size_bytes' => 1,
                'created_at' => now(),
            ]),
            'action_item_evidence accepted a row whose action item does not exist.',
        );

        // Evidence cannot be detached from its item through the API either:
        // the route pair must match, so another item's id is a 404.
        $otherItemId = $this->actingAs($this->admin)
            ->postJson('/api/admin/action-items', ['title' => 'Other item', 'severity' => 'low'])
            ->assertCreated()
            ->json('id');
        $this->actingAs($this->admin)
            ->deleteJson("/api/admin/action-items/{$otherItemId}/evidence/{$evidenceId}")
            ->assertNotFound();
        $this->assertDatabaseHas('action_item_evidence', ['id' => $evidenceId]);

        ActionItem::query()->findOrFail($itemId)->delete();

        $this->assertDatabaseMissing('action_item_evidence', ['id' => $evidenceId]);
        $this->assertSame(0, DB::table('action_item_evidence')->where('action_item_id', $itemId)->count());
    }

    // ---- 8. Invalid transfer state ----

    /**
     * Policy: decide()/cancel() are false once a request has left `pending`
     * (403). Domain: TransferService::assertPending refuses the same
     * transition with a 422 for callers that bypass the policy. DB:
     * transfer_requests.status is an enum (native on MariaDB, a CHECK on
     * SQLite; the table has never been rebuilt so the CHECK is intact).
     */
    public function test_a_transfer_request_cannot_leave_a_decided_state(): void
    {
        $nephrology = Section::query()->where('slug', 'nephrology')->firstOrFail();
        $cardiology = Section::query()->where('slug', 'cardiology')->firstOrFail();
        $consultant = User::factory()->role('consultant', 'Consultant')->create(['section_id' => $nephrology->id]);
        $file = fn () => TransferRequest::query()->findOrFail(
            $this->actingAs($consultant)
                ->postJson('/api/academic/transfer-requests', ['toSectionId' => $cardiology->id])
                ->assertCreated()
                ->json('id'),
        );

        $rejected = $file();
        $this->actingAs($this->admin)->postJson("/api/admin/transfer-requests/{$rejected->id}/reject")->assertOk();
        $this->actingAs($this->admin)
            ->postJson("/api/admin/transfer-requests/{$rejected->id}/approve", ['immediate' => true])
            ->assertForbidden();
        $this->actingAs($consultant)->postJson("/api/academic/transfer-requests/{$rejected->id}/cancel")->assertForbidden();
        $this->assertSame('rejected', $rejected->fresh()->status);
        $this->assertSame($nephrology->id, $consultant->fresh()->section_id);

        $approved = $file();
        $this->actingAs($this->admin)
            ->postJson("/api/admin/transfer-requests/{$approved->id}/approve", ['effectiveOn' => now()->addDays(10)->toDateString()])
            ->assertOk()
            ->assertJsonPath('status', 'approved');
        $this->actingAs($consultant)->postJson("/api/academic/transfer-requests/{$approved->id}/cancel")->assertForbidden();
        $this->actingAs($this->admin)->postJson("/api/admin/transfer-requests/{$approved->id}/reject")->assertForbidden();
        $this->assertSame('approved', $approved->fresh()->status);

        try {
            app(TransferService::class)->approve($rejected, $this->admin, now()->addDays(10));
            $this->fail('The service approved a rejected transfer request.');
        } catch (ValidationException $exception) {
            $this->assertArrayHasKey('request', $exception->errors());
        }

        try {
            app(TransferService::class)->cancel($approved, $consultant);
            $this->fail('The service cancelled an approved transfer request.');
        } catch (ValidationException $exception) {
            $this->assertArrayHasKey('request', $exception->errors());
        }

        $this->assertWriteIsRejected(
            fn () => DB::table('transfer_requests')->where('id', $approved->id)->update(['status' => 'bogus_state']),
            'transfer_requests.status accepted a value outside its enum.',
        );
        $this->assertSame('approved', $approved->fresh()->status);
    }

    // ---- 9. Referenced structure deletion ----

    /**
     * Every delete endpoint must answer a reference with a 422 that points at
     * "deactivate instead", never with the database's own refusal (a 500) and
     * never by silently cascading or nulling the reference away.
     *
     * Departments and templates: ReferenceDataController::assert*IsSafeToDelete.
     * Wards and sections: AcademicStructureController::destroyWard/destroySection,
     * which this test extends to the references the schema also carries:
     * transfer_requests (restrict) for sections, subgroup_placements
     * (restrict) plus the evaluation and teaching-session ward snapshots
     * (null-on-delete) for wards.
     */
    public function test_a_referenced_structure_is_refused_deletion_instead_of_failing_or_cascading(): void
    {
        $this->actingAs($this->admin)
            ->deleteJson("/api/admin/departments/{$this->department->slug}")
            ->assertStatus(422)
            ->assertJsonValidationErrors('department');
        $this->actingAs($this->admin)
            ->deleteJson("/api/admin/templates/{$this->template->slug}")
            ->assertStatus(422)
            ->assertJsonValidationErrors('template');

        $nephrology = Section::query()->where('slug', 'nephrology')->firstOrFail();
        $nephrologyWard = Ward::query()->where('slug', 'nephrology_ward')->firstOrFail();
        $this->actingAs($this->admin)
            ->deleteJson("/api/admin/academic/sections/{$nephrology->id}")
            ->assertStatus(422)
            ->assertJsonValidationErrors('section');
        $this->actingAs($this->admin)
            ->deleteJson("/api/admin/academic/wards/{$nephrologyWard->id}")
            ->assertStatus(422)
            ->assertJsonValidationErrors('ward');

        // A brand-new section whose only reference is a transfer request.
        $probeSectionId = $this->actingAs($this->admin)
            ->postJson('/api/admin/academic/sections', ['name' => 'Integrity Probe Section'])
            ->assertCreated()
            ->json('id');
        $consultant = User::factory()->role('consultant', 'Consultant')->create(['section_id' => $nephrology->id]);
        $this->actingAs($consultant)
            ->postJson('/api/academic/transfer-requests', ['toSectionId' => $probeSectionId])
            ->assertCreated();
        $this->actingAs($this->admin)
            ->deleteJson("/api/admin/academic/sections/{$probeSectionId}")
            ->assertStatus(422)
            ->assertJsonValidationErrors('section');
        $this->assertDatabaseHas('sections', ['id' => $probeSectionId]);
        $this->assertDatabaseHas('transfer_requests', ['to_section_id' => $probeSectionId]);

        // A brand-new ward whose only reference is a subgroup placement.
        $placementWardId = $this->actingAs($this->admin)
            ->postJson('/api/admin/academic/wards', ['name' => 'Integrity Probe Placement Ward'])
            ->assertCreated()
            ->json('id');
        $batch = StudentBatch::query()->create([
            'cohort' => 'C1',
            'label' => 'C1 2026-A',
            'starts_on' => '2026-09-14',
            'ends_on' => '2026-12-06',
        ]);
        SubgroupPlacement::query()->create([
            'batch_id' => $batch->id,
            'subgroup' => 'A',
            'ward_id' => $placementWardId,
            'week_starts_on' => '2026-09-14',
            'week_ends_on' => '2026-09-20',
            'created_by' => $this->admin->id,
        ]);
        $this->actingAs($this->admin)
            ->deleteJson("/api/admin/academic/wards/{$placementWardId}")
            ->assertStatus(422)
            ->assertJsonValidationErrors('ward');
        $this->assertDatabaseHas('wards', ['id' => $placementWardId]);

        // A brand-new ward whose only reference is an evaluation's ward snapshot.
        $snapshotWardId = $this->actingAs($this->admin)
            ->postJson('/api/admin/academic/wards', ['name' => 'Integrity Probe Snapshot Ward'])
            ->assertCreated()
            ->json('id');
        [$resident, $evaluatedConsultant] = $this->placeAcademicPair();
        $form = EvaluationForm::query()->where('key', 'consultant_mdt')->where('status', 'published')->firstOrFail();
        $evaluation = Evaluation::query()->create([
            'form_id' => $form->id,
            'form_key' => 'consultant_mdt',
            'author_id' => $resident->id,
            'subject_user_id' => $evaluatedConsultant->id,
            'evaluation_date' => now()->subDays(3)->toDateString(),
            'ward_id' => $snapshotWardId,
        ]);
        $this->actingAs($this->admin)
            ->deleteJson("/api/admin/academic/wards/{$snapshotWardId}")
            ->assertStatus(422)
            ->assertJsonValidationErrors('ward');
        $this->assertDatabaseHas('wards', ['id' => $snapshotWardId]);
        $this->assertSame($snapshotWardId, $evaluation->fresh()->ward_id);

        // The unreferenced ward and section can still be deleted: the guards
        // must not turn every delete into a refusal.
        $freeWardId = $this->actingAs($this->admin)
            ->postJson('/api/admin/academic/wards', ['name' => 'Integrity Probe Free Ward'])
            ->assertCreated()
            ->json('id');
        $this->actingAs($this->admin)->deleteJson("/api/admin/academic/wards/{$freeWardId}")->assertNoContent();
        $freeSectionId = $this->actingAs($this->admin)
            ->postJson('/api/admin/academic/sections', ['name' => 'Integrity Probe Free Section'])
            ->assertCreated()
            ->json('id');
        $this->actingAs($this->admin)->deleteJson("/api/admin/academic/sections/{$freeSectionId}")->assertNoContent();
    }

    // ---- 10. Invalid report status ----

    /**
     * DB: reports.status is an enum (MariaDB native; SQLite CHECK, intact
     * because only index migrations have touched the table). Domain: the lock
     * transition writes status and locked_at together inside one transaction
     * (ReportLockingService::setLockState), and Report::isLocked() keys off
     * locked_at rather than the status string.
     *
     * Known DB-level gap, documented rather than asserted: nothing at the
     * schema level ties status = 'locked' to a non-null locked_at (a CHECK
     * or a trigger would), so a direct write can produce that pair.
     */
    public function test_a_report_status_outside_the_workflow_states_is_refused(): void
    {
        $report = $this->createReport();

        $this->assertWriteIsRejected(
            fn () => DB::table('reports')->where('id', $report->id)->update(['status' => 'bogus_status']),
            'reports.status accepted a value outside its enum.',
        );
        $this->assertWriteIsRejected(
            fn () => DB::table('reports')->insert($this->rawReportRow([
                'status' => 'bogus_status',
                'reporting_period_id' => $this->createPeriod(Carbon::now('Africa/Nairobi')->startOfWeek()->subWeeks(2))->id,
            ])),
            'reports.status accepted an insert outside its enum.',
        );
        $this->assertSame('draft', $report->fresh()->status);

        $this->actingAs($this->nurse)
            ->postJson("/api/reports/{$report->id}/submit", ['values' => self::VALUES])
            ->assertOk()
            ->assertJsonPath('status', 'submitted');
        $this->actingAs($this->admin)->postJson("/api/reports/{$report->id}/lock")->assertOk();

        $locked = $report->fresh();
        $this->assertSame('locked', $locked->status);
        $this->assertNotNull($locked->locked_at);

        $this->actingAs($this->admin)->postJson("/api/reports/{$report->id}/unlock")->assertOk();

        $unlocked = $report->fresh();
        $this->assertNotSame('locked', $unlocked->status);
        $this->assertNull($unlocked->locked_at);
    }

    // ---- 11. Locked report edit (covered elsewhere) ----

    /**
     * Already proven by ReportWorkflowTest; this pins the reference so the
     * coverage cannot be renamed away without this suite noticing.
     */
    public function test_locked_report_edits_are_covered_by_the_workflow_suite(): void
    {
        foreach ([
            'test_locked_reports_reject_save_attempts',
            'test_a_stale_revision_against_a_locked_report_reports_the_lock',
        ] as $method) {
            $this->assertTrue(
                method_exists(ReportWorkflowTest::class, $method),
                "ReportWorkflowTest::{$method} is the locked-report edit coverage this invariant relies on.",
            );
        }
    }

    // ---- 12. Two reports for one assignment and period ----

    /**
     * Domain: ReportSubmissionService::save reads the existing row under
     * lockForUpdate before deciding to create, so a repeat POST updates it.
     * DB: reports_assignment_id_reporting_period_id_unique catches the
     * concurrent-looking direct insert the service lock cannot see.
     */
    public function test_two_reports_for_the_same_assignment_and_period_cannot_coexist(): void
    {
        $payload = [
            'assignmentId' => $this->assignment->id,
            'reportingPeriodId' => $this->period->id,
            'values' => self::VALUES,
        ];

        $first = $this->actingAs($this->nurse)->postJson('/api/reports', $payload)->assertCreated();
        $second = $this->actingAs($this->nurse)->postJson('/api/reports', $payload)->assertCreated();

        $this->assertSame($first->json('id'), $second->json('id'));
        $this->assertDatabaseCount('reports', 1);

        $this->assertWriteIsRejected(
            fn () => DB::table('reports')->insert($this->rawReportRow()),
            'reports accepted a second row for the same assignment and reporting period.',
        );
        $this->assertDatabaseCount('reports', 1);
    }

    // ---- Fixture helpers ----

    private function createReport(): Report
    {
        return Report::query()->create([
            'assignment_id' => $this->assignment->id,
            'department_id' => $this->department->id,
            'template_id' => $this->template->id,
            'reporting_period_id' => $this->period->id,
            'status' => 'draft',
            'created_by' => $this->nurse->id,
            'updated_by' => $this->nurse->id,
        ]);
    }

    private function createPeriod(Carbon $weekStart): ReportingPeriod
    {
        return ReportingPeriod::query()->create([
            'week_start' => $weekStart->toDateString(),
            'week_end' => $weekStart->copy()->addDays(6)->toDateString(),
            'deadline_at' => $weekStart->copy()->addWeek()->setTime(10, 0),
            'month_label' => $weekStart->format('M Y'),
            'quarter_label' => sprintf('Q%d %d', $weekStart->quarter, $weekStart->year),
            'year_num' => $weekStart->year,
        ]);
    }

    /**
     * @param  array<string, mixed>  $overrides
     * @return array<string, mixed>
     */
    private function rawReportRow(array $overrides = []): array
    {
        return [
            'id' => (string) Str::uuid(),
            'assignment_id' => $this->assignment->id,
            'department_id' => $this->department->id,
            'template_id' => $this->template->id,
            'reporting_period_id' => $this->period->id,
            'status' => 'draft',
            'created_by' => $this->nurse->id,
            'updated_by' => $this->nurse->id,
            'created_at' => now(),
            'updated_at' => now(),
            ...$overrides,
        ];
    }

    /**
     * A resident and a consultant placed together on the GI/Neurology ward
     * service around today, the shape AcademicEvaluationApiTest uses.
     *
     * @return array{0: User, 1: User}
     */
    private function placeAcademicPair(): array
    {
        $resident = User::factory()->role('resident', 'Resident')->create();
        $consultant = User::factory()->role('consultant', 'Consultant')->create();

        $this->placeOnGastroWard($resident);
        $this->placeOnGastroWard($consultant);

        return [$resident, $consultant];
    }

    private function placeOnGastroWard(User $user): void
    {
        $wardService = DutyType::query()->where('slug', 'gastroenterology_ward_service')->firstOrFail();

        DutyAssignment::query()->create([
            'user_id' => $user->id,
            'duty_type_id' => $wardService->id,
            'starts_on' => now()->subDays(20)->toDateString(),
            'ends_on' => now()->addDays(20)->toDateString(),
            'source' => 'admin',
            'created_by' => $this->admin->id,
        ]);
    }

    /**
     * @return array<string, mixed>
     */
    private function consultantEvaluationPayload(string $subjectId, string $date): array
    {
        return [
            'evaluationDate' => $date,
            'subjectId' => $subjectId,
            'seniorPresent' => true,
            'seniorJoinedAt' => '08:15',
            'presenceMinutes' => 45,
            'allPatientsReviewed' => true,
            'mgmtPlanDocumented' => true,
            'vteAssessed' => true,
            'dischargeDiscussed' => false,
            'medReviewDone' => true,
            'criticalLabsReviewed' => true,
            'pctPatientsSeen' => 80,
            'roundDelayed' => false,
            'overallRating' => 4,
            'mdtParticipants' => ['consultant', 'residents', 'nurse'],
            'systemIssues' => ['lab_delay'],
        ];
    }

    /**
     * @return array<string, mixed>
     */
    private function residentEvaluationPayload(string $subjectId, string $date): array
    {
        return [
            'evaluationDate' => $date,
            'subjectId' => $subjectId,
            'onTime' => true,
            'prepared' => true,
            'presentationClear' => true,
            'clinicalReasoning' => true,
            'managementPlan' => true,
            'documentationTimely' => true,
            'communication' => true,
            'professional' => true,
            'responsiveFeedback' => false,
            'followThrough' => false,
            'overallRating' => 4,
            'concerns' => ['documentation'],
        ];
    }

    private function assertWriteIsRejected(callable $write, string $message): void
    {
        try {
            $write();
        } catch (QueryException) {
            return;
        }

        $this->fail($message);
    }
}
