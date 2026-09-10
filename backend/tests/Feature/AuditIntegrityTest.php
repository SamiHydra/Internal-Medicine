<?php

namespace Tests\Feature;

use App\Models\AccessRequest;
use App\Models\AccessRequestItem;
use App\Models\ActionItem;
use App\Models\AdminAccessRequest;
use App\Models\AdminAuditLog;
use App\Models\AuditLog;
use App\Models\Department;
use App\Models\DutyType;
use App\Models\Report;
use App\Models\ReportAssignment;
use App\Models\ReportingPeriod;
use App\Models\ReportStatusHistory;
use App\Models\ReportTemplate;
use App\Models\User;
use Database\Seeders\AppSettingSeeder;
use Database\Seeders\DepartmentSeeder;
use Database\Seeders\ReportFieldDefinitionSeeder;
use Database\Seeders\ReportTemplateSeeder;
use Database\Seeders\RoleSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Log\Events\MessageLogged;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Facades\Password;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * Audit-log integrity (pre-server hardening, priority 10): every
 * security-sensitive event leaves a row with actor, action, target, time and
 * (where it applies) before/after state; no secret ever lands in a payload
 * or the application log; and no role can alter or remove a row through the
 * API. The one designed deletion path is the retention prune command, which
 * is disabled until config('reports.retention.*') says otherwise.
 */
class AuditIntegrityTest extends TestCase
{
    use RefreshDatabase;

    private User $superadmin;

    private User $admin;

    private User $nurse;

    private ReportAssignment $assignment;

    private ReportingPeriod $period;

    private Department $department;

    private ReportTemplate $template;

    /** @var list<string> */
    private array $logLines = [];

    protected function setUp(): void
    {
        parent::setUp();

        foreach ([RoleSeeder::class, ReportTemplateSeeder::class, DepartmentSeeder::class, ReportFieldDefinitionSeeder::class, AppSettingSeeder::class] as $seeder) {
            $this->seed($seeder);
        }

        // Everything the app logs during a test, so the secret sweep can
        // cover the log as well as the audit tables.
        $this->logLines = [];
        Event::listen(MessageLogged::class, function (MessageLogged $event): void {
            $this->logLines[] = $event->message.' '.json_encode($event->context);
        });

        $this->superadmin = User::factory()->role('superadmin', 'Maintenance')->create(['full_name' => 'Root Admin']);
        $this->admin = User::factory()->role('admin', 'Administrator')->create(['full_name' => 'Ward Admin']);
        $this->nurse = User::factory()->create([
            'full_name' => 'Hana Abera',
            'email' => 'hana.abera@example.test',
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
        $this->period = ReportingPeriod::query()->create([
            'week_start' => '2026-05-25',
            'week_end' => '2026-05-31',
            'deadline_at' => '2026-06-01 10:00:00',
            'month_label' => 'May 2026',
            'quarter_label' => 'Q2 2026',
            'year_num' => 2026,
        ]);
    }

    // -- Accounts ------------------------------------------------------------

    public function test_user_create_role_change_activation_and_admin_password_reset_are_audited_without_secrets(): void
    {
        $userId = $this->actingAs($this->admin)
            ->postJson('/api/admin/users', [
                'full_name' => 'Marta Bekele',
                'email' => 'marta.bekele@example.test',
                'username' => 'marta.bekele',
                'password' => 'Secret-Plain-2026!',
                'role_key' => 'nurse',
            ])
            ->assertCreated()
            ->json('id');

        $created = $this->auditRow('user', 'create', $userId);
        $this->assertSame($this->admin->id, $created->user_id);
        $this->assertSame('Ward Admin', $created->user_name);
        $this->assertNotNull($created->created_at);
        $this->assertNotNull($created->ip_address);
        $this->assertNull($created->old_values);
        $this->assertSame('nurse', $created->new_values['role_key']);
        $this->assertSame('marta.bekele@example.test', $created->new_values['email']);
        $this->assertArrayNotHasKey('password', $created->new_values);

        // Role change: before and after role on one row.
        $this->actingAs($this->admin)
            ->patchJson("/api/admin/users/{$userId}", ['role' => 'student_rep'])
            ->assertOk();
        $roleChange = $this->auditRow('user', 'update', $userId);
        $this->assertSame('nurse', $roleChange->old_values['role_key']);
        $this->assertSame('student_rep', $roleChange->new_values['role_key']);

        // Deactivate, then reactivate.
        $this->actingAs($this->admin)->patchJson("/api/admin/users/{$userId}/active", ['active' => false])->assertOk();
        $deactivated = $this->auditRow('user', 'set_active', $userId, fn (AdminAuditLog $row) => $row->new_values['active'] === false);
        $this->assertTrue($deactivated->old_values['active']);

        $this->actingAs($this->admin)->patchJson("/api/admin/users/{$userId}/active", ['active' => true])->assertOk();
        $reactivated = $this->auditRow('user', 'set_active', $userId, fn (AdminAuditLog $row) => $row->new_values['active'] === true);
        $this->assertFalse($reactivated->old_values['active']);

        // Administrator password reset: only the flag and the timestamp.
        $this->actingAs($this->admin)
            ->postJson("/api/admin/users/{$userId}/reset-password", [
                'password' => 'Reset-Plain-2026!',
                'password_change_required' => true,
            ])
            ->assertOk();
        $reset = $this->auditRow('user', 'reset_password', $userId);
        $this->assertSame($this->admin->id, $reset->user_id);
        $this->assertEqualsCanonicalizing(['password_change_required', 'updated_at'], array_keys($reset->old_values));
        $this->assertEqualsCanonicalizing(['password_change_required', 'updated_at'], array_keys($reset->new_values));
        $this->assertTrue($reset->new_values['password_change_required']);

        // "Delete" is a deactivation and is audited as one.
        $this->actingAs($this->admin)->deleteJson("/api/admin/users/{$userId}")->assertOk();
        $deleted = $this->auditRow('user', 'deactivate', $userId);
        $this->assertTrue($deleted->old_values['active']);
        $this->assertFalse($deleted->new_values['active']);

        $this->assertNoSecretsInTrailOrLogs([
            'Secret-Plain-2026!',
            'Reset-Plain-2026!',
            User::query()->findOrFail($userId)->password,
        ]);
    }

    public function test_self_service_password_changes_are_audited_without_the_password_or_token(): void
    {
        $this->actingAs($this->nurse)
            ->postJson('/api/auth/change-password', [
                'current_password' => 'password',
                'password' => 'Changed-Plain-2026!',
                'password_confirmation' => 'Changed-Plain-2026!',
            ])
            ->assertOk();

        $changed = $this->auditRow('user', 'change_password', $this->nurse->id, fn (AdminAuditLog $row) => $row->new_values['method'] === 'self_service');
        $this->assertSame($this->nurse->id, $changed->user_id);
        $this->assertEqualsCanonicalizing(['password_change_required'], array_keys($changed->old_values));
        $this->assertEqualsCanonicalizing(['password_change_required', 'method'], array_keys($changed->new_values));

        $token = Password::broker()->createToken($this->nurse);

        $this->postJson('/api/auth/reset-password', [
            'email' => $this->nurse->email,
            'token' => $token,
            'password' => 'Reset-Link-2026!',
            'password_confirmation' => 'Reset-Link-2026!',
        ])->assertOk();

        $reset = $this->auditRow('user', 'change_password', $this->nurse->id, fn (AdminAuditLog $row) => $row->new_values['method'] === 'reset_link');
        $this->assertSame($this->nurse->id, $reset->user_id);
        $this->assertEqualsCanonicalizing(['password_change_required', 'method'], array_keys($reset->new_values));
        $this->assertSame(2, AdminAuditLog::query()->where('action', 'change_password')->count());

        $this->assertNoSecretsInTrailOrLogs([
            'Changed-Plain-2026!',
            'Reset-Link-2026!',
            $token,
            $this->nurse->fresh()->password,
        ]);
    }

    public function test_assignment_creation_and_retirement_are_audited(): void
    {
        $other = User::factory()->create(['full_name' => 'Second Nurse']);

        $assignmentId = $this->actingAs($this->admin)
            ->postJson('/api/admin/assignments', [
                'nurse_id' => $other->id,
                'department_id' => 'cardiac_inpatient',
                'template_id' => 'inpatient_weekly',
            ])
            ->assertCreated()
            ->json('id');

        $created = $this->auditRow('report_assignment', 'upsert', $assignmentId);
        $this->assertSame($this->admin->id, $created->user_id);
        $this->assertSame($other->id, $created->new_values['nurse_id']);
        $this->assertTrue($created->new_values['active']);
        $this->assertSame($this->admin->id, $created->new_values['approved_by']);

        $this->actingAs($this->admin)->deleteJson("/api/admin/assignments/{$assignmentId}")->assertOk();
        $retired = $this->auditRow('report_assignment', 'deactivate', $assignmentId);
        $this->assertTrue($retired->old_values['active']);
        $this->assertFalse($retired->new_values['active']);

        $this->actingAs($this->admin)->patchJson("/api/admin/assignments/{$assignmentId}", ['active' => true])->assertOk();
        $restored = $this->auditRow('report_assignment', 'update', $assignmentId);
        $this->assertFalse($restored->old_values['active']);
        $this->assertTrue($restored->new_values['active']);
    }

    public function test_access_request_decisions_record_activation_and_granted_assignments(): void
    {
        $applicant = User::factory()->inactive()->create(['full_name' => 'Applicant One', 'title' => 'Applicant Nurse']);
        $request = $this->createAccessRequest($applicant, 'cardiac_inpatient');

        $this->actingAs($this->admin)
            ->postJson("/api/admin/access-requests/{$request->id}/approve")
            ->assertOk()
            ->assertJsonPath('status', 'approved');

        $approved = $this->auditRow('access_request', 'review', $request->id);
        $this->assertSame($this->admin->id, $approved->user_id);
        $this->assertSame('pending', $approved->old_values['status']);
        $this->assertFalse($approved->old_values['userActive']);
        $this->assertSame('approved', $approved->new_values['status']);
        $this->assertSame($this->admin->id, $approved->new_values['reviewed_by']);
        $this->assertTrue($approved->new_values['userActive']);
        $this->assertCount(1, $approved->new_values['grantedAssignments']);

        $granted = $approved->new_values['grantedAssignments'][0];
        $cardiac = Department::query()->where('slug', 'cardiac_inpatient')->firstOrFail();
        $this->assertSame($cardiac->id, $granted['departmentId']);
        $this->assertDatabaseHas('report_assignments', ['id' => $granted['id'], 'nurse_id' => $applicant->id, 'active' => true]);
        $this->assertTrue($applicant->fresh()->active);

        $second = User::factory()->inactive()->create(['full_name' => 'Applicant Two', 'title' => 'Applicant Nurse']);
        $rejectedRequest = $this->createAccessRequest($second, 'gi_neuro_inpatient');

        $this->actingAs($this->admin)
            ->postJson("/api/admin/access-requests/{$rejectedRequest->id}/reject")
            ->assertOk()
            ->assertJsonPath('status', 'rejected');

        $rejected = $this->auditRow('access_request', 'review', $rejectedRequest->id);
        $this->assertSame('rejected', $rejected->new_values['status']);
        $this->assertFalse($rejected->new_values['userActive']);
        $this->assertSame([], $rejected->new_values['grantedAssignments']);
        $this->assertFalse($second->fresh()->active);
    }

    public function test_account_request_decisions_are_audited_without_the_applicant_password_hash(): void
    {
        $this->postJson('/api/admin-access-requests', [
            'fullName' => 'Dr. Meron Tadesse',
            'email' => 'meron.tadesse@example.test',
            'password' => 'Applicant-Plain-2026!',
            'notes' => 'Department coordinator stepping into administration.',
        ])->assertCreated();
        $this->postJson('/api/admin-access-requests', [
            'fullName' => 'Dr. Yonas Alemu',
            'email' => 'yonas.alemu@example.test',
            'password' => 'Applicant-Plain-2026!',
            'notes' => 'Second applicant.',
        ])->assertCreated();

        $approve = AdminAccessRequest::query()->where('email', 'meron.tadesse@example.test')->firstOrFail();
        $reject = AdminAccessRequest::query()->where('email', 'yonas.alemu@example.test')->firstOrFail();

        $this->actingAs($this->superadmin)
            ->postJson("/api/admin/admin-access-requests/{$approve->id}/approve")
            ->assertOk();
        $createdUser = User::query()->where('email', 'meron.tadesse@example.test')->firstOrFail();

        $approved = $this->auditRow('admin_access_request', 'approve_admin_request', $approve->id);
        $this->assertSame($this->superadmin->id, $approved->user_id);
        $this->assertSame('pending', $approved->old_values['status']);
        $this->assertNull($approved->old_values['created_user_id']);
        $this->assertSame('approved', $approved->new_values['status']);
        $this->assertSame($createdUser->id, $approved->new_values['created_user_id']);

        $this->actingAs($this->superadmin)
            ->postJson("/api/admin/admin-access-requests/{$reject->id}/reject")
            ->assertOk();
        $rejected = $this->auditRow('admin_access_request', 'reject_admin_request', $reject->id);
        $this->assertSame('rejected', $rejected->new_values['status']);
        $this->assertNull($rejected->new_values['created_user_id']);

        $this->assertNoSecretsInTrailOrLogs([
            'Applicant-Plain-2026!',
            $approve->password,
            $reject->password,
            $createdUser->password,
        ]);
    }

    // -- Reports -------------------------------------------------------------

    public function test_report_lifecycle_writes_status_history_and_the_cell_trail(): void
    {
        $reportId = $this->actingAs($this->nurse)->postJson('/api/reports', [
            'assignmentId' => $this->assignment->id,
            'reportingPeriodId' => $this->period->id,
            'values' => $this->inpatientValues(30, 2, 1),
        ])->assertCreated()->json('id');

        $draft = $this->statusRow($reportId, 'draft');
        $this->assertSame($this->nurse->id, $draft->changed_by);
        $this->assertSame('Hana Abera', $draft->changed_by_name);
        $this->assertNotNull($draft->changed_at);

        $this->actingAs($this->nurse)->postJson("/api/reports/{$reportId}/submit", [
            'values' => $this->inpatientValues(30, 2, 1),
        ])->assertOk()->assertJsonPath('status', 'submitted');

        $submitted = $this->statusRow($reportId, 'submitted');
        $this->assertSame($this->nurse->id, $submitted->changed_by);
        // Drafts leave no cell rows: the cell trail starts at submission.
        $this->assertSame(0, AuditLog::query()->count());

        $this->actingAs($this->admin)->putJson("/api/reports/{$reportId}", [
            'values' => $this->inpatientValues(35, 2, 1),
        ])->assertOk()->assertJsonPath('status', 'edited_after_submission');

        $edited = $this->statusRow($reportId, 'edited_after_submission');
        $this->assertSame($this->admin->id, $edited->changed_by);

        $cell = AuditLog::query()->sole();
        $this->assertSame($reportId, $cell->report_id);
        $this->assertSame('total_patient_days', $cell->field_key);
        $this->assertSame('monday', $cell->day_name);
        $this->assertSame('30', $cell->old_value);
        $this->assertSame('35', $cell->new_value);
        $this->assertSame($this->admin->id, $cell->changed_by);
        $this->assertSame('Ward Admin', $cell->changed_by_name);
        $this->assertSame($this->department->id, $cell->department_id);
        $this->assertSame($this->template->id, $cell->template_id);
        $this->assertNotNull($cell->changed_at);

        $this->actingAs($this->admin)->postJson("/api/reports/{$reportId}/lock")->assertOk();
        $locked = $this->statusRow($reportId, 'locked');
        $this->assertSame($this->admin->id, $locked->changed_by);
        $this->assertSame('Report locked after review.', $locked->note);

        $this->actingAs($this->admin)->postJson("/api/reports/{$reportId}/unlock")->assertOk();
        $unlocked = ReportStatusHistory::query()
            ->where('report_id', $reportId)
            ->where('note', 'Report unlocked for correction.')
            ->sole();
        $this->assertSame($this->admin->id, $unlocked->changed_by);
        $this->assertSame('edited_after_submission', $unlocked->status);

        $this->assertSame(
            ['draft', 'submitted', 'edited_after_submission', 'locked', 'edited_after_submission'],
            ReportStatusHistory::query()->where('report_id', $reportId)->orderBy('changed_at')->orderBy('id')->pluck('status')->all(),
        );
    }

    public function test_report_comments_are_audited_on_create_and_delete(): void
    {
        $report = $this->submitReport();

        $commentId = $this->actingAs($this->nurse)
            ->postJson("/api/reports/{$report->id}/comments", ['body' => 'Admissions fell during the holiday.'])
            ->assertCreated()
            ->json('id');

        $added = $this->auditRow('report_comment', 'comment', $commentId);
        $this->assertSame($this->nurse->id, $added->user_id);
        $this->assertSame('Hana Abera', $added->user_name);
        $this->assertNull($added->old_values);
        $this->assertSame($report->id, $added->new_values['reportId']);
        $this->assertSame($this->nurse->id, $added->new_values['authorId']);
        $this->assertSame('Admissions fell during the holiday.', $added->new_values['body']);

        $this->actingAs($this->admin)
            ->deleteJson("/api/reports/{$report->id}/comments/{$commentId}")
            ->assertOk();
        $this->assertDatabaseMissing('report_comments', ['id' => $commentId]);

        // The row is gone, so the audit entry must carry what was removed.
        $removed = $this->auditRow('report_comment', 'delete', $commentId);
        $this->assertSame($this->admin->id, $removed->user_id);
        $this->assertSame('Admissions fell during the holiday.', $removed->old_values['body']);
        $this->assertSame($this->nurse->id, $removed->old_values['authorId']);
        $this->assertSame($report->id, $removed->old_values['reportId']);
        $this->assertNull($removed->new_values);

        // The trail reads them as clinical rows with human labels.
        $this->actingAs($this->admin)
            ->getJson('/api/admin/admin-audit-logs?entity_type=report_comment&workspace=clinical')
            ->assertOk()
            ->assertJsonCount(2, 'data')
            ->assertJsonPath('data.0.entityLabel', 'Report comment')
            ->assertJsonPath('data.0.workspace', 'clinical');
        $labels = $this->actingAs($this->admin)
            ->getJson('/api/admin/admin-audit-logs?entity_type=report_comment')
            ->assertOk()
            ->json('data.*.actionLabel');
        $this->assertEqualsCanonicalizing(['Comment added', 'Removed'], $labels);
        $this->actingAs($this->admin)
            ->getJson('/api/admin/admin-audit-logs?entity_type=report_comment&workspace=academic')
            ->assertOk()
            ->assertJsonCount(0, 'data');
    }

    // -- Configuration and governance ---------------------------------------

    public function test_settings_changes_record_before_and_after_values(): void
    {
        $current = $this->actingAs($this->admin)->getJson('/api/admin/settings')->assertOk()->json('settings.weeklyDeadlineDay');
        $next = $current === 'tuesday' ? 'thursday' : 'tuesday';

        $this->actingAs($this->admin)
            ->patchJson('/api/admin/settings', ['weeklyDeadlineDay' => $next])
            ->assertOk()
            ->assertJsonPath('settings.weeklyDeadlineDay', $next);

        $row = $this->auditRow('app_settings', 'update');
        $this->assertSame($this->admin->id, $row->user_id);
        $this->assertSame($current, $row->old_values['weeklyDeadlineDay']);
        $this->assertSame($next, $row->new_values['weeklyDeadlineDay']);
        $this->assertArrayHasKey('metricTargets', $row->old_values);
    }

    public function test_action_item_status_transitions_are_audited(): void
    {
        $item = $this->createActionItem();

        $this->actingAs($this->admin)->patchJson("/api/admin/action-items/{$item->id}", [
            'status' => 'resolved',
            'resolution_note' => 'Root cause reviewed and corrective control implemented.',
        ])->assertOk();
        $resolved = $this->auditRow('action_item', 'resolve', $item->id);
        $this->assertSame($this->admin->id, $resolved->user_id);
        $this->assertSame('assigned', $resolved->old_values['status']);
        $this->assertSame('resolved', $resolved->new_values['status']);
        $this->assertSame($this->admin->id, $resolved->new_values['resolved_by']);

        $this->actingAs($this->superadmin)->patchJson("/api/admin/action-items/{$item->id}", ['status' => 'closed'])->assertOk();
        $verified = $this->auditRow('action_item', 'verify', $item->id);
        $this->assertSame($this->superadmin->id, $verified->user_id);
        $this->assertSame('resolved', $verified->old_values['status']);
        $this->assertSame('closed', $verified->new_values['status']);

        $this->actingAs($this->admin)->patchJson("/api/admin/action-items/{$item->id}", ['status' => 'open'])->assertOk();
        $reopened = $this->auditRow('action_item', 'reopen', $item->id);
        $this->assertSame('closed', $reopened->old_values['status']);
        $this->assertSame('open', $reopened->new_values['status']);
    }

    public function test_evidence_upload_and_delete_are_audited(): void
    {
        Storage::fake('local');
        $item = $this->createActionItem();

        $evidenceId = $this->actingAs($this->admin)
            ->post("/api/admin/action-items/{$item->id}/evidence", [
                'file' => UploadedFile::fake()->create('review.pdf', 80, 'application/pdf'),
            ], ['Accept' => 'application/json'])
            ->assertCreated()
            ->json('id');

        $uploaded = $this->auditRow('action_item', 'upload_evidence', $item->id);
        $this->assertSame($this->admin->id, $uploaded->user_id);
        $this->assertSame($evidenceId, $uploaded->new_values['evidenceId']);
        $this->assertSame('review.pdf', $uploaded->new_values['name']);

        $this->actingAs($this->admin)
            ->deleteJson("/api/admin/action-items/{$item->id}/evidence/{$evidenceId}")
            ->assertNoContent();
        $this->assertDatabaseMissing('action_item_evidence', ['id' => $evidenceId]);

        $deleted = $this->auditRow('action_item', 'delete', $item->id);
        $this->assertSame($evidenceId, $deleted->old_values['evidenceId']);
        $this->assertSame('review.pdf', $deleted->old_values['name']);
        $this->assertNull($deleted->new_values);
    }

    public function test_morning_roster_overrides_are_audited(): void
    {
        $resident = User::factory()->role('resident', 'Resident')->create();

        $overrideId = $this->actingAs($this->admin)
            ->postJson('/api/admin/morning-roster-overrides', [
                'userId' => $resident->id,
                'action' => 'exclude',
                'startsOn' => '2026-09-14',
                'endsOn' => '2026-09-20',
            ])
            ->assertCreated()
            ->json('id');

        $created = $this->auditRow('morning_roster_override', 'create', $overrideId);
        $this->assertSame($this->admin->id, $created->user_id);
        $this->assertSame($resident->id, $created->new_values['userId']);
        $this->assertSame('exclude', $created->new_values['action']);
        $this->assertSame('2026-09-14', $created->new_values['startsOn']);

        $this->actingAs($this->admin)
            ->deleteJson("/api/admin/morning-roster-overrides/{$overrideId}")
            ->assertNoContent();

        $removed = $this->auditRow('morning_roster_override', 'delete', $overrideId);
        $this->assertSame($resident->id, $removed->old_values['userId']);
        $this->assertSame('exclude', $removed->old_values['action']);
        $this->assertNull($removed->new_values);
    }

    public function test_daily_roster_duty_save_and_removal_are_audited(): void
    {
        $consultant = User::factory()->role('consultant', 'Consultant')->create();
        $dutyType = DutyType::query()->where('slug', 'transition_ward_duty')->firstOrFail();
        $date = now()->addMonth()->toDateString();

        $this->actingAs($this->admin)
            ->postJson('/api/admin/roster/daily', [
                'userId' => $consultant->id,
                'dutyTypeId' => $dutyType->id,
                'date' => $date,
            ])
            ->assertCreated();

        $saved = $this->auditRow('duty_roster', 'save_daily_duty', $consultant->id);
        $this->assertSame($this->admin->id, $saved->user_id);
        $this->assertSame($dutyType->id, $saved->new_values['dutyTypeId']);
        $this->assertSame($date, $saved->new_values['date']);

        $this->actingAs($this->admin)
            ->postJson('/api/admin/roster/daily', [
                'userId' => $consultant->id,
                'dutyTypeId' => $dutyType->id,
                'date' => $date,
                'remove' => true,
            ])
            ->assertOk()
            ->assertJsonPath('removed', true);

        $removed = $this->auditRow('duty_roster', 'remove_daily_duty', $consultant->id);
        $this->assertSame($dutyType->id, $removed->old_values['dutyTypeId']);
        $this->assertSame($date, $removed->old_values['date']);
        $this->assertNull($removed->new_values);
    }

    // -- Mutation resistance -------------------------------------------------

    public function test_audit_rows_cannot_be_mutated_through_the_api_by_any_role(): void
    {
        [$adminRow, $cellRow, $historyRow] = $this->seedOneRowPerTrail();

        $snapshot = $this->trailSnapshot();
        $tamper = ['action' => 'tampered', 'old_values' => ['x' => 1], 'new_value' => 'tampered', 'note' => 'tampered', 'status' => 'draft'];

        $attempts = [
            ['patch', "/api/admin/audit-logs/{$cellRow->id}"],
            ['put', "/api/admin/audit-logs/{$cellRow->id}"],
            ['delete', "/api/admin/audit-logs/{$cellRow->id}"],
            ['post', '/api/admin/audit-logs'],
            ['patch', '/api/admin/audit-logs'],
            ['put', '/api/admin/audit-logs'],
            ['delete', '/api/admin/audit-logs'],
            ['patch', "/api/admin/admin-audit-logs/{$adminRow->id}"],
            ['put', "/api/admin/admin-audit-logs/{$adminRow->id}"],
            ['delete', "/api/admin/admin-audit-logs/{$adminRow->id}"],
            ['post', '/api/admin/admin-audit-logs'],
            ['patch', '/api/admin/admin-audit-logs'],
            ['put', '/api/admin/admin-audit-logs'],
            ['delete', '/api/admin/admin-audit-logs'],
            ['patch', "/api/reports/status-history/{$historyRow->id}"],
            ['put', "/api/reports/status-history/{$historyRow->id}"],
            ['delete', "/api/reports/status-history/{$historyRow->id}"],
            ['post', '/api/reports/status-history'],
            ['patch', '/api/reports/status-history'],
            ['delete', '/api/reports/status-history'],
        ];

        foreach ([$this->superadmin, $this->admin, $this->nurse] as $actor) {
            foreach ($attempts as [$method, $uri]) {
                $status = $this->actingAs($actor)->json($method, $uri, $tamper)->getStatusCode();

                $this->assertContains(
                    $status,
                    [404, 405],
                    sprintf('%s %s as %s answered %d; audit rows must have no mutation route.', strtoupper($method), $uri, $actor->role_key, $status),
                );
            }
        }

        $this->assertSame($snapshot, $this->trailSnapshot(), 'An API call changed an audit row.');
    }

    public function test_policies_deny_update_and_delete_on_audit_rows_even_for_the_maintenance_owner(): void
    {
        [$adminRow, $cellRow, $historyRow] = $this->seedOneRowPerTrail();

        foreach ([$this->superadmin, $this->admin, $this->nurse] as $actor) {
            foreach ([$adminRow, $cellRow, $historyRow] as $row) {
                foreach (['update', 'delete', 'forceDelete'] as $ability) {
                    $this->assertTrue(
                        Gate::forUser($actor)->denies($ability, $row),
                        sprintf('%s may %s a %s row.', $actor->role_key, $ability, $row::class),
                    );
                }
            }
        }

        // Reading stays where it was: administrators only.
        $this->assertTrue(Gate::forUser($this->superadmin)->allows('viewAny', AdminAuditLog::class));
        $this->assertTrue(Gate::forUser($this->admin)->allows('viewAny', AuditLog::class));
        $this->assertTrue(Gate::forUser($this->nurse)->denies('viewAny', AdminAuditLog::class));
        $this->assertTrue(Gate::forUser($this->nurse)->denies('viewAny', AuditLog::class));
    }

    public function test_non_admins_cannot_read_either_trail(): void
    {
        // Anonymous first: actingAs() stays in force for the rest of the test.
        $this->getJson('/api/admin/audit-logs')->assertUnauthorized();
        $this->getJson('/api/admin/admin-audit-logs')->assertUnauthorized();

        $consultant = User::factory()->role('consultant', 'Consultant')->create();

        foreach ([$this->nurse, $consultant] as $actor) {
            $this->actingAs($actor)->getJson('/api/admin/audit-logs')->assertForbidden();
            $this->actingAs($actor)->getJson('/api/admin/admin-audit-logs')->assertForbidden();
        }
    }

    public function test_retention_prune_keeps_audit_rows_unless_a_window_is_configured(): void
    {
        [$adminRow, , $historyRow] = $this->seedOneRowPerTrail();

        $staleAdminId = (string) Str::uuid();
        DB::table('admin_audit_logs')->insert([
            'id' => $staleAdminId,
            'user_id' => $this->admin->id,
            'user_name' => 'Ward Admin',
            'action' => 'update',
            'entity_type' => 'app_settings',
            'entity_id' => null,
            'old_values' => json_encode(['weeklyDeadlineDay' => 'monday']),
            'new_values' => json_encode(['weeklyDeadlineDay' => 'tuesday']),
            'ip_address' => '127.0.0.1',
            'user_agent' => 'phpunit',
            'created_at' => now()->subDays(400),
        ]);
        DB::table('report_status_history')->where('id', $historyRow->id)->update(['changed_at' => now()->subDays(400)]);

        $adminCount = AdminAuditLog::query()->count();
        $cellCount = AuditLog::query()->count();
        $historyCount = ReportStatusHistory::query()->count();

        // Default configuration: nothing in any trail is touched.
        config([
            'reports.retention.audit_log_days' => 0,
            'reports.retention.admin_audit_log_days' => 0,
            'reports.retention.status_history_days' => 0,
        ]);
        $this->artisan('app:prune-operational-data')
            ->expectsOutputToContain('Skipped report audit rows; retention is disabled.')
            ->expectsOutputToContain('Skipped admin audit rows; retention is disabled.')
            ->expectsOutputToContain('Skipped report status-history rows; retention is disabled.')
            ->assertExitCode(0);
        $this->assertSame($adminCount, AdminAuditLog::query()->count());
        $this->assertSame($cellCount, AuditLog::query()->count());
        $this->assertSame($historyCount, ReportStatusHistory::query()->count());

        // An explicit window removes only rows older than it, per table.
        config([
            'reports.retention.admin_audit_log_days' => 365,
            'reports.retention.status_history_days' => 365,
        ]);
        $this->artisan('app:prune-operational-data')->assertExitCode(0);
        $this->assertDatabaseMissing('admin_audit_logs', ['id' => $staleAdminId]);
        $this->assertDatabaseHas('admin_audit_logs', ['id' => $adminRow->id]);
        $this->assertDatabaseMissing('report_status_history', ['id' => $historyRow->id]);
        $this->assertSame($historyCount - 1, ReportStatusHistory::query()->count());
        $this->assertSame($cellCount, AuditLog::query()->count());
    }

    // -- Helpers ---------------------------------------------------------------

    private function auditRow(string $entityType, string $action, ?string $entityId = null, ?callable $where = null): AdminAuditLog
    {
        $rows = AdminAuditLog::query()
            ->where('entity_type', $entityType)
            ->where('action', $action)
            ->when($entityId !== null, fn ($query) => $query->where('entity_id', $entityId))
            ->orderByDesc('created_at')
            ->get();

        if ($where !== null) {
            $rows = $rows->filter($where);
        }

        $this->assertNotEmpty($rows, "No admin_audit_logs row for {$entityType}/{$action}.");

        return $rows->first();
    }

    private function statusRow(string $reportId, string $status): ReportStatusHistory
    {
        return ReportStatusHistory::query()
            ->where('report_id', $reportId)
            ->where('status', $status)
            ->orderByDesc('changed_at')
            ->firstOrFail();
    }

    /**
     * Scans every audit payload and every log line written during the test
     * for the given secrets, for bcrypt material, and for keys that would
     * only ever hold credentials.
     *
     * @param  list<string|null>  $secrets
     */
    private function assertNoSecretsInTrailOrLogs(array $secrets): void
    {
        $secrets = array_values(array_filter($secrets, fn ($secret) => is_string($secret) && $secret !== ''));
        $this->assertNotEmpty($secrets);

        $payloads = DB::table('admin_audit_logs')
            ->get(['action', 'old_values', 'new_values'])
            ->map(fn ($row) => [$row->action, ($row->old_values ?? '').' '.($row->new_values ?? '')])
            ->merge(DB::table('audit_logs')
                ->get(['field_key', 'old_value', 'new_value'])
                ->map(fn ($row) => ['cell:'.$row->field_key, ($row->old_value ?? '').' '.($row->new_value ?? '')]));

        $this->assertNotEmpty($payloads);

        foreach ($payloads as [$label, $payload]) {
            foreach ($secrets as $secret) {
                $this->assertStringNotContainsString($secret, $payload, "Audit payload for {$label} contains a secret.");
            }

            $this->assertStringNotContainsString('$2y$', $payload, "Audit payload for {$label} contains a bcrypt hash.");

            foreach (['"password"', '"password_hash"', '"token"', '"remember_token"', '"session_id"', '"api_token"', '"cookie"', '"authorization"'] as $key) {
                $this->assertStringNotContainsStringIgnoringCase($key, $payload, "Audit payload for {$label} carries a credential key {$key}.");
            }
        }

        foreach ($this->logLines as $line) {
            foreach ($secrets as $secret) {
                $this->assertStringNotContainsString($secret, $line, 'The application log contains a secret.');
            }
        }
    }

    /**
     * @return array{0: AdminAuditLog, 1: AuditLog, 2: ReportStatusHistory}
     */
    private function seedOneRowPerTrail(): array
    {
        $report = $this->submitReport();
        $this->actingAs($this->admin)->putJson("/api/reports/{$report->id}", [
            'values' => $this->inpatientValues(35, 2, 1),
        ])->assertOk();
        $this->actingAs($this->admin)->patchJson('/api/admin/settings', ['weeklyDeadlineDay' => 'wednesday'])->assertOk();

        return [
            AdminAuditLog::query()->where('entity_type', 'app_settings')->firstOrFail(),
            AuditLog::query()->firstOrFail(),
            ReportStatusHistory::query()->where('status', 'submitted')->firstOrFail(),
        ];
    }

    /**
     * @return array<string, list<array<string, mixed>>>
     */
    private function trailSnapshot(): array
    {
        return [
            'admin_audit_logs' => DB::table('admin_audit_logs')->orderBy('id')->get()->map(fn ($row) => (array) $row)->all(),
            'audit_logs' => DB::table('audit_logs')->orderBy('id')->get()->map(fn ($row) => (array) $row)->all(),
            'report_status_history' => DB::table('report_status_history')->orderBy('id')->get()->map(fn ($row) => (array) $row)->all(),
        ];
    }

    private function submitReport(): Report
    {
        $this->actingAs($this->nurse)->postJson('/api/reports', [
            'assignmentId' => $this->assignment->id,
            'reportingPeriodId' => $this->period->id,
            'submit' => true,
            'values' => $this->inpatientValues(30, 2, 1),
        ])->assertCreated();

        return Report::query()->firstOrFail();
    }

    private function createAccessRequest(User $user, string $departmentSlug): AccessRequest
    {
        $department = Department::query()->where('slug', $departmentSlug)->firstOrFail();
        $accessRequest = AccessRequest::query()->create([
            'user_id' => $user->id,
            'email' => $user->email,
            'status' => 'pending',
            'notes' => 'Please add reporting access.',
            'requested_at' => now(),
        ]);

        AccessRequestItem::query()->create([
            'access_request_id' => $accessRequest->id,
            'department_id' => $department->id,
            'template_id' => $department->template_id,
        ]);

        return $accessRequest;
    }

    private function createActionItem(): ActionItem
    {
        return ActionItem::query()->create([
            'source' => 'manual',
            'title' => 'Review a clinical variance',
            'description' => 'Investigate and record the outcome.',
            'severity' => 'high',
            'status' => 'assigned',
            'condition_state' => 'manual',
            'department_id' => $this->department->id,
            'assigned_to' => $this->admin->id,
            'responsible_role' => 'admin',
            'due_at' => now()->addDay(),
            'created_by' => $this->admin->id,
        ]);
    }

    /**
     * @return array<string, array{fieldId: string, dailyValues: array<string, mixed>}>
     */
    private function inpatientValues(int $totalPatientDays, int $dischargedHome, int $dischargedAma): array
    {
        return [
            'total_patient_days' => ['fieldId' => 'total_patient_days', 'dailyValues' => ['monday' => $totalPatientDays]],
            'discharged_home' => ['fieldId' => 'discharged_home', 'dailyValues' => ['monday' => $dischargedHome]],
            'discharged_ama' => ['fieldId' => 'discharged_ama', 'dailyValues' => ['monday' => $dischargedAma]],
            'mdt_round_start_day' => ['fieldId' => 'mdt_round_start_day', 'dailyValues' => ['monday' => '08:30']],
        ];
    }
}
