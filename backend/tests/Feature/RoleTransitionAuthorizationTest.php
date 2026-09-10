<?php

namespace Tests\Feature;

use App\Models\Department;
use App\Models\Report;
use App\Models\ReportAssignment;
use App\Models\ReportingPeriod;
use App\Models\ReportTemplate;
use App\Models\User;
use Database\Seeders\DepartmentSeeder;
use Database\Seeders\ReportFieldDefinitionSeeder;
use Database\Seeders\ReportTemplateSeeder;
use Database\Seeders\RoleSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Gate;
use Tests\TestCase;

/**
 * QA-003: an account moved off the nurse role must not keep clinical access
 * through the report assignments it leaves behind. Guarded at the transition
 * (the role change is refused while assignments are live) AND at every report
 * surface (assignment rows never stand in for the reporting permission).
 */
class RoleTransitionAuthorizationTest extends TestCase
{
    use RefreshDatabase;

    private User $superadmin;

    private User $nurse;

    private ReportAssignment $assignment;

    private ReportingPeriod $period;

    private Report $report;

    /** One valid inpatient value (a Monday total) so writes pass validation and reach authorization. */
    private const VALUES = ['total_patient_days' => ['dailyValues' => ['monday' => 12]]];

    protected function setUp(): void
    {
        parent::setUp();

        foreach ([RoleSeeder::class, ReportTemplateSeeder::class, DepartmentSeeder::class, ReportFieldDefinitionSeeder::class] as $seeder) {
            $this->seed($seeder);
        }

        $this->superadmin = User::factory()->role('superadmin', 'Maintenance')->create();
        $this->nurse = User::factory()->create([
            'full_name' => 'Converted Nurse',
            'email' => 'converted.nurse@example.test',
            'username' => 'converted.nurse',
        ]);

        $template = ReportTemplate::query()->where('slug', 'inpatient_weekly')->firstOrFail();
        $department = Department::query()->where('slug', 'gi_neuro_inpatient')->firstOrFail();

        $this->assignment = ReportAssignment::query()->create([
            'nurse_id' => $this->nurse->id,
            'department_id' => $department->id,
            'template_id' => $template->id,
            'active' => true,
            'approved_at' => now(),
        ]);

        // A week that has already started, so the future-period rule (QA-009)
        // does not interfere with what this test is about.
        $weekStart = Carbon::now('Africa/Nairobi')->startOfWeek()->subWeek();
        $this->period = ReportingPeriod::query()->create([
            'week_start' => $weekStart->toDateString(),
            'week_end' => $weekStart->copy()->addDays(6)->toDateString(),
            'deadline_at' => $weekStart->copy()->addWeek()->setTime(10, 0),
            'month_label' => $weekStart->format('M Y'),
            'quarter_label' => sprintf('Q%d %d', $weekStart->quarter, $weekStart->year),
            'year_num' => $weekStart->year,
        ]);

        $this->report = Report::query()->create([
            'assignment_id' => $this->assignment->id,
            'department_id' => $department->id,
            'template_id' => $template->id,
            'reporting_period_id' => $this->period->id,
            'status' => 'draft',
            'created_by' => $this->nurse->id,
            'updated_by' => $this->nurse->id,
        ]);
    }

    public function test_the_nurse_has_clinical_access_before_the_transition(): void
    {
        $this->actingAs($this->nurse)->getJson('/api/reports?report_period_window=all')
            ->assertOk()
            ->assertJsonPath('data.0.id', $this->report->id);
        $this->actingAs($this->nurse)->getJson("/api/reports/{$this->report->id}")->assertOk();
        $this->actingAs($this->nurse)
            ->putJson("/api/reports/{$this->report->id}", ['values' => self::VALUES])
            ->assertOk()
            ->assertJsonPath('values.total_patient_days.dailyValues.monday', 12);
        $this->actingAs($this->nurse)->getJson('/api/workspace')
            ->assertOk()
            ->assertJsonPath('state.assignments.0.id', $this->assignment->id);
    }

    public function test_the_role_change_is_refused_while_the_nurse_holds_active_report_assignments(): void
    {
        $this->actingAs($this->superadmin)
            ->patchJson("/api/admin/users/{$this->nurse->id}", ['role' => 'student_rep'])
            ->assertStatus(422)
            ->assertJsonValidationErrors('role');

        $this->actingAs($this->superadmin)
            ->patchJson("/api/admin/users/{$this->nurse->id}", ['role' => 'admin'])
            ->assertStatus(422)
            ->assertJsonValidationErrors('role');

        $this->assertSame('nurse', $this->nurse->fresh()->role_key);
        $this->assertTrue((bool) $this->assignment->fresh()->active);

        // Retiring the assignment first is the documented path; then the change goes through.
        $this->actingAs($this->superadmin)
            ->deleteJson("/api/admin/assignments/{$this->assignment->id}")
            ->assertOk()
            ->assertJsonPath('active', false);

        $this->actingAs($this->superadmin)
            ->patchJson("/api/admin/users/{$this->nurse->id}", ['role' => 'student_rep'])
            ->assertOk()
            ->assertJsonPath('role', 'student_rep');

        $converted = $this->nurse->fresh();
        $this->assertSame('student_rep', $converted->role_key);

        $this->assertClinicalSurfacesAreClosed($converted);
    }

    /**
     * Defense in depth: even if a stale active assignment somehow survives a
     * role change (direct database edit, older data), the report policies and
     * every report endpoint must refuse the account.
     */
    public function test_a_stale_assignment_never_grants_clinical_access_to_a_converted_account(): void
    {
        $this->nurse->forceFill(['role_key' => 'student_rep', 'title' => 'Student representative'])->save();
        $converted = $this->nurse->fresh();
        $this->assertTrue((bool) $this->assignment->fresh()->active, 'precondition: the stale assignment is still active');

        $this->assertFalse(Gate::forUser($converted)->allows('view', $this->report));
        $this->assertFalse(Gate::forUser($converted)->allows('update', $this->report));
        $this->assertFalse(Gate::forUser($converted)->allows('submit', $this->report));
        $this->assertFalse(Gate::forUser($converted)->allows('create', [Report::class, $this->assignment]));

        $this->assertClinicalSurfacesAreClosed($converted);
    }

    public function test_the_reverse_transition_grants_reporting_only_through_a_live_assignment(): void
    {
        $rep = User::factory()->role('student_rep', 'Student representative')->create([
            'email' => 'former.rep@example.test',
            'username' => 'former.rep',
        ]);

        $this->actingAs($this->superadmin)
            ->patchJson("/api/admin/users/{$rep->id}", ['role' => 'nurse'])
            ->assertOk()
            ->assertJsonPath('role', 'nurse');

        $rep = $rep->fresh();

        // A nurse without assignments sees nothing and cannot touch other reports.
        $this->actingAs($rep)->getJson('/api/reports?report_period_window=all')
            ->assertOk()
            ->assertJsonCount(0, 'data');
        $this->actingAs($rep)->getJson("/api/reports/{$this->report->id}")->assertForbidden();

        $department = Department::query()->where('slug', 'gi_neuro_inpatient')->firstOrFail();
        $this->actingAs($this->superadmin)
            ->postJson('/api/admin/assignments', [
                'nurseId' => $rep->id,
                'departmentId' => $department->slug,
                'templateId' => 'inpatient_weekly',
            ])
            ->assertCreated();

        $assignmentId = ReportAssignment::query()->where('nurse_id', $rep->id)->value('id');

        $this->actingAs($rep)
            ->postJson('/api/reports', [
                'assignmentId' => $assignmentId,
                'reportingPeriodId' => $this->period->id,
                'values' => self::VALUES,
            ])
            ->assertCreated();

        $this->actingAs($rep)->getJson('/api/reports?report_period_window=all')
            ->assertOk()
            ->assertJsonCount(1, 'data');
    }

    private function assertClinicalSurfacesAreClosed(User $account): void
    {
        // The list endpoints keep the documented self-scoped empty page (never a
        // leak, never a 403 that would break the shared SPA bootstrap).
        $this->actingAs($account)->getJson('/api/reports?report_period_window=all')
            ->assertOk()
            ->assertJsonCount(0, 'data');
        $this->actingAs($account)->getJson('/api/reports/status-history')
            ->assertOk()
            ->assertJsonCount(0, 'data');

        // Every object-level surface refuses the account outright.
        $this->actingAs($account)->getJson("/api/reports/{$this->report->id}")->assertForbidden();
        $this->actingAs($account)->getJson("/api/reports/details?ids={$this->report->id}")->assertForbidden();
        $this->actingAs($account)->putJson("/api/reports/{$this->report->id}", ['values' => self::VALUES])->assertForbidden();
        $this->actingAs($account)->postJson("/api/reports/{$this->report->id}/submit", ['values' => self::VALUES])->assertForbidden();
        $this->actingAs($account)->getJson("/api/reports/{$this->report->id}/comments")->assertForbidden();
        $this->actingAs($account)->postJson("/api/reports/{$this->report->id}/comments", ['body' => 'x'])->assertForbidden();
        $this->actingAs($account)
            ->postJson('/api/reports', [
                'assignmentId' => $this->assignment->id,
                'reportingPeriodId' => $this->period->id,
                'values' => self::VALUES,
            ])
            ->assertForbidden();

        // The bootstrap and session payloads no longer advertise clinical scope.
        $this->actingAs($account)->getJson('/api/workspace')
            ->assertOk()
            ->assertJsonCount(0, 'state.assignments');
        $this->actingAs($account)->getJson('/api/auth/me')
            ->assertOk()
            ->assertJsonCount(0, 'assignments');

        // And nothing changed on the report itself.
        $this->assertSame('draft', $this->report->fresh()->status);
    }
}
