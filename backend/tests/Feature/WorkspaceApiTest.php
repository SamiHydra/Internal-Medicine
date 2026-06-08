<?php

namespace Tests\Feature;

use App\Models\AuditLog;
use App\Models\Department;
use App\Models\Report;
use App\Models\ReportAssignment;
use App\Models\ReportFieldDefinition;
use App\Models\ReportingPeriod;
use App\Models\ReportStatusHistory;
use App\Models\User;
use Database\Seeders\AppSettingSeeder;
use Database\Seeders\DepartmentSeeder;
use Database\Seeders\ReportFieldDefinitionSeeder;
use Database\Seeders\ReportingPeriodSeeder;
use Database\Seeders\ReportTemplateSeeder;
use Database\Seeders\RoleSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\Password;
use Tests\TestCase;

class WorkspaceApiTest extends TestCase
{
    use RefreshDatabase;

    private User $admin;

    private User $nurse;

    private User $otherNurse;

    protected function setUp(): void
    {
        parent::setUp();

        foreach ([RoleSeeder::class, ReportTemplateSeeder::class, DepartmentSeeder::class, ReportFieldDefinitionSeeder::class, AppSettingSeeder::class, ReportingPeriodSeeder::class] as $seeder) {
            $this->seed($seeder);
        }

        $this->admin = User::factory()->role('admin', 'Administrator')->create([
            'full_name' => 'Admin User',
        ]);
        $this->nurse = User::factory()->create([
            'full_name' => 'Hana Nurse',
            'email' => 'hana.nurse@example.test',
        ]);
        $this->otherNurse = User::factory()->create([
            'full_name' => 'Other Nurse',
        ]);
    }

    public function test_workspace_hydrates_frontend_state_and_scopes_nurses(): void
    {
        $department = Department::query()->where('slug', 'gi_neuro_inpatient')->firstOrFail();
        $otherDepartment = Department::query()->where('slug', 'cardiac_inpatient')->firstOrFail();
        $period = ReportingPeriod::query()
            ->whereDate('week_start', '>=', '2026-03-02')
            ->whereDate('week_start', '<=', Carbon::today()->toDateString())
            ->orderByDesc('week_start')
            ->firstOrFail();
        $assignment = $this->assignment($this->nurse, $department);
        $otherAssignment = $this->assignment($this->otherNurse, $otherDepartment);
        $report = $this->report($assignment, $period);
        $otherReport = $this->report($otherAssignment, $period);
        $field = ReportFieldDefinition::query()
            ->where('template_id', $department->template_id)
            ->where('field_key', 'total_patient_days')
            ->firstOrFail();

        ReportStatusHistory::query()->create([
            'report_id' => $report->id,
            'status' => 'submitted',
            'changed_by' => $this->nurse->id,
            'changed_by_name' => $this->nurse->full_name,
            'changed_at' => now(),
        ]);
        AuditLog::query()->create([
            'report_id' => $report->id,
            'field_definition_id' => $field->id,
            'field_key' => 'total_patient_days',
            'day_name' => 'monday',
            'old_value' => '10',
            'new_value' => '11',
            'changed_by' => $this->admin->id,
            'changed_by_name' => $this->admin->full_name,
            'changed_at' => now(),
            'department_id' => $department->id,
            'template_id' => $department->template_id,
        ]);

        $this->actingAs($this->nurse)
            ->getJson('/api/workspace?includeHistory=1&includeProfiles=1')
            ->assertOk()
            ->assertJsonPath('currentUser.id', $this->nurse->id)
            ->assertJsonCount(1, 'state.profiles')
            ->assertJsonCount(1, 'state.assignments')
            ->assertJsonPath('state.assignments.0.departmentId', 'gi_neuro_inpatient')
            ->assertJsonCount(1, 'state.reports')
            ->assertJsonPath('state.reports.0.id', $report->id)
            ->assertJsonCount(1, 'state.statusHistory')
            ->assertJsonCount(0, 'state.auditLogs');

        $this->actingAs($this->admin)
            ->getJson('/api/workspace?includeHistory=1&includeProfiles=1')
            ->assertOk()
            ->assertJsonPath('references.departmentDbIdBySlug.gi_neuro_inpatient', $department->id)
            ->assertJsonCount(3, 'state.profiles')
            ->assertJsonCount(2, 'state.assignments')
            ->assertJsonFragment(['id' => $otherReport->id])
            ->assertJsonCount(1, 'state.auditLogs');
    }

    public function test_public_access_request_creates_applicant_and_notifies_admins(): void
    {
        $this->postJson('/api/access-requests', [
            'fullName' => 'New Applicant',
            'email' => 'new.applicant@example.test',
            'password' => 'Password123!',
            'requestedAssignments' => [
                [
                    'departmentId' => 'gi_neuro_inpatient',
                    'templateId' => 'inpatient_weekly',
                ],
            ],
            'notes' => 'Please approve.',
        ])
            ->assertCreated()
            ->assertJsonPath('signedIn', false)
            ->assertJsonPath('data.email', 'new.applicant@example.test')
            ->assertJsonPath('data.requestedAssignments.0.departmentSlug', 'gi_neuro_inpatient');

        $applicant = User::query()->where('email', 'new.applicant@example.test')->firstOrFail();

        $this->assertSame('nurse', $applicant->role_key);
        $this->assertDatabaseHas('access_requests', [
            'user_id' => $applicant->id,
            'status' => 'pending',
        ]);
        $this->assertDatabaseHas('notifications', [
            'recipient_id' => $this->admin->id,
            'type' => 'nurse_access_request',
        ]);
    }

    public function test_superadmin_cannot_be_claimed_through_the_api(): void
    {
        // The self-promotion endpoint has been removed: superadmin ("Maintenance")
        // can only be created manually via the console command / DB.
        $this->actingAs($this->admin)
            ->postJson('/api/admin/claim-superadmin', [
                'fullName' => 'Root Admin',
                'username' => 'root.admin',
                'email' => 'root.admin@example.test',
                'password' => 'Password123!',
            ])
            ->assertNotFound();

        $this->assertSame('admin', $this->admin->refresh()->role_key);

        // No admin-creation path may assign the superadmin role either.
        $this->actingAs($this->admin)
            ->postJson('/api/admin/users', [
                'fullName' => 'Sneaky Root',
                'email' => 'sneaky.root@example.test',
                'password' => 'Password123!',
                'role' => 'superadmin',
            ])
            ->assertStatus(422);

        $this->assertDatabaseMissing('users', ['email' => 'sneaky.root@example.test']);
    }

    public function test_password_reset_endpoints_create_and_accept_tokens(): void
    {
        Mail::fake();

        $this->postJson('/api/auth/forgot-password', [
            'email' => $this->nurse->email,
        ])->assertAccepted();

        $this->assertDatabaseHas('password_reset_tokens', [
            'email' => $this->nurse->email,
        ]);

        $token = Password::broker()->createToken($this->nurse);

        $this->postJson('/api/auth/reset-password', [
            'email' => $this->nurse->email,
            'token' => $token,
            'password' => 'NewPassword123!',
            'password_confirmation' => 'NewPassword123!',
        ])->assertOk();

        $this->assertTrue(password_verify('NewPassword123!', $this->nurse->refresh()->password));
    }

    public function test_workspace_report_summaries_default_to_recent_period_window_and_can_load_all_history(): void
    {
        Carbon::setTestNow('2026-05-26 12:00:00');

        try {
            ReportingPeriod::query()->delete();

            $department = Department::query()->where('slug', 'gi_neuro_inpatient')->firstOrFail();
            $assignment = $this->assignment($this->nurse, $department);
            $periods = collect(range(0, 10))
                ->map(fn (int $offset): ReportingPeriod => $this->createReportingPeriod(
                    Carbon::parse('2026-03-16')->addWeeks($offset)->toDateString(),
                ));
            $reports = $periods->map(fn (ReportingPeriod $period): Report => $this->report($assignment, $period));

            $defaultResponse = $this->actingAs($this->admin)
                ->getJson('/api/workspace')
                ->assertOk()
                ->assertJsonCount(9, 'state.reports');
            $defaultReportIds = collect($defaultResponse->json('state.reports'))->pluck('id')->all();

            $this->assertEmpty(array_intersect($reports->take(2)->pluck('id')->all(), $defaultReportIds));
            $this->assertEqualsCanonicalizing($reports->slice(2)->pluck('id')->all(), $defaultReportIds);

            $this->actingAs($this->admin)
                ->getJson('/api/workspace?reportPeriodWindow=all')
                ->assertOk()
                ->assertJsonCount(11, 'state.reports');
        } finally {
            Carbon::setTestNow();
        }
    }

    private function assignment(User $nurse, Department $department): ReportAssignment
    {
        return ReportAssignment::query()->create([
            'nurse_id' => $nurse->id,
            'department_id' => $department->id,
            'template_id' => $department->template_id,
            'active' => true,
            'approved_at' => now(),
            'approved_by' => $this->admin->id,
        ]);
    }

    private function report(ReportAssignment $assignment, ReportingPeriod $period): Report
    {
        return Report::query()->create([
            'assignment_id' => $assignment->id,
            'department_id' => $assignment->department_id,
            'template_id' => $assignment->template_id,
            'reporting_period_id' => $period->id,
            'status' => 'submitted',
            'submitted_at' => now(),
            'created_by' => $assignment->nurse_id,
            'updated_by' => $assignment->nurse_id,
        ]);
    }

    private function createReportingPeriod(string $weekStart): ReportingPeriod
    {
        $start = Carbon::parse($weekStart);

        return ReportingPeriod::query()->create([
            'week_start' => $start->toDateString(),
            'week_end' => $start->copy()->addDays(6)->toDateString(),
            'deadline_at' => $start->copy()->addWeek()->setTime(10, 0),
            'month_label' => $start->format('M Y'),
            'quarter_label' => sprintf('Q%d %d', $start->quarter, $start->year),
            'year_num' => $start->year,
        ]);
    }
}
