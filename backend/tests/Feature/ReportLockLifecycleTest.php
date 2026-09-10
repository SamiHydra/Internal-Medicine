<?php

namespace Tests\Feature;

use App\Models\AuditLog;
use App\Models\Department;
use App\Models\Notification;
use App\Models\Report;
use App\Models\ReportAssignment;
use App\Models\ReportingPeriod;
use App\Models\ReportStatusHistory;
use App\Models\ReportTemplate;
use App\Models\User;
use Database\Seeders\DepartmentSeeder;
use Database\Seeders\ReportFieldDefinitionSeeder;
use Database\Seeders\ReportTemplateSeeder;
use Database\Seeders\RoleSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * Business rule: locking a report temporarily prevents modification. Locking
 * does not submit a draft report. Unlocking restores the report to its
 * existing lifecycle state: a draft remains a draft, a submitted report
 * remains submitted. Submission happens only through the submit workflow.
 *
 * Before the fix ReportLockingService::setLockState(false) restored
 * "submitted" (or "edited_after_submission") whatever the report was before
 * the lock, so lock + unlock silently submitted a draft.
 */
class ReportLockLifecycleTest extends TestCase
{
    use RefreshDatabase;

    private User $nurse;

    private User $admin;

    private ReportAssignment $assignment;

    private ReportingPeriod $period;

    protected function setUp(): void
    {
        parent::setUp();

        foreach ([RoleSeeder::class, ReportTemplateSeeder::class, DepartmentSeeder::class, ReportFieldDefinitionSeeder::class] as $seeder) {
            $this->seed($seeder);
        }

        $this->nurse = User::factory()->create([
            'full_name' => 'Hana Abera',
            'email' => 'hana@example.test',
            'username' => 'hana.abera',
        ]);
        $this->admin = User::factory()->role('admin', 'Administrator')->create([
            'full_name' => 'Admin One',
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
        $this->period = ReportingPeriod::query()->create([
            'week_start' => '2026-05-25',
            'week_end' => '2026-05-31',
            'deadline_at' => '2026-06-01 10:00:00',
            'month_label' => 'May 2026',
            'quarter_label' => 'Q2 2026',
            'year_num' => 2026,
        ]);
    }

    // ---- Test 1: draft -> lock -> unlock -> draft

    public function test_unlocking_a_locked_draft_restores_the_draft(): void
    {
        $report = $this->createDraft();
        $this->assertSame('draft', $report->status);
        $this->assertNull($report->submitted_at);

        $this->actingAs($this->admin)
            ->postJson("/api/reports/{$report->id}/lock")
            ->assertOk()
            ->assertJsonPath('status', 'locked');

        $locked = $report->fresh();
        $this->assertSame('locked', $locked->status);
        $this->assertNotNull($locked->locked_at);
        $this->assertNull($locked->submitted_at);

        $this->actingAs($this->admin)
            ->postJson("/api/reports/{$report->id}/unlock")
            ->assertOk()
            ->assertJsonPath('status', 'draft')
            ->assertJsonPath('lockedAt', null)
            ->assertJsonPath('submittedAt', null);

        // Re-read independently of the unlock response: through the API ...
        $this->actingAs($this->nurse)
            ->getJson("/api/reports/{$report->id}")
            ->assertOk()
            ->assertJsonPath('status', 'draft')
            ->assertJsonPath('lockedAt', null)
            ->assertJsonPath('submittedAt', null);

        // ... and straight from the row.
        $unlocked = $report->fresh();
        $this->assertSame('draft', $unlocked->status);
        $this->assertNull($unlocked->locked_at);
        $this->assertNull($unlocked->submitted_at);
        $this->assertSame($this->admin->id, $unlocked->updated_by);
    }

    // ---- Test 2: submitted -> lock -> unlock -> submitted

    public function test_unlocking_a_locked_submitted_report_restores_submitted(): void
    {
        $report = $this->createSubmitted();
        $this->assertSame('submitted', $report->status);
        $submittedAt = $report->submitted_at;
        $this->assertNotNull($submittedAt);

        $this->actingAs($this->admin)->postJson("/api/reports/{$report->id}/lock")->assertOk();
        $this->assertSame('locked', $report->fresh()->status);

        $this->actingAs($this->admin)
            ->postJson("/api/reports/{$report->id}/unlock")
            ->assertOk()
            ->assertJsonPath('status', 'submitted');

        $this->actingAs($this->nurse)
            ->getJson("/api/reports/{$report->id}")
            ->assertOk()
            ->assertJsonPath('status', 'submitted');

        $unlocked = $report->fresh();
        $this->assertSame('submitted', $unlocked->status);
        $this->assertNull($unlocked->locked_at);
        $this->assertTrue($submittedAt->equalTo($unlocked->submitted_at), 'submitted_at must survive the lock cycle unchanged');
    }

    public function test_unlocking_a_locked_edited_report_restores_edited_after_submission(): void
    {
        $report = $this->createSubmitted();
        $this->actingAs($this->nurse)->putJson("/api/reports/{$report->id}", [
            'values' => $this->inpatientValues(totalPatientDays: 31),
        ])->assertOk()->assertJsonPath('status', 'edited_after_submission');

        $this->actingAs($this->admin)->postJson("/api/reports/{$report->id}/lock")->assertOk();
        $this->actingAs($this->admin)
            ->postJson("/api/reports/{$report->id}/unlock")
            ->assertOk()
            ->assertJsonPath('status', 'edited_after_submission');

        $this->assertSame('edited_after_submission', $report->fresh()->status);
    }

    // ---- Test 3: locking a draft carries no submission semantics

    public function test_locking_a_draft_does_not_submit_it(): void
    {
        $report = $this->createDraft();
        $submissionNotifications = Notification::query()->where('type', 'new_report_submitted')->count();

        $this->actingAs($this->admin)->postJson("/api/reports/{$report->id}/lock")->assertOk();

        $locked = $report->fresh();
        $this->assertSame('locked', $locked->status);
        $this->assertNull($locked->submitted_at, 'a lock must not stamp submitted_at');
        $this->assertSame(['draft', 'locked'], $this->statusTrail($report));
        $this->assertDatabaseMissing('report_status_history', ['report_id' => $report->id, 'status' => 'submitted']);
        $this->assertSame($submissionNotifications, Notification::query()->where('type', 'new_report_submitted')->count());
        $this->assertDatabaseMissing('notifications', ['related_id' => $report->id, 'related_entity' => 'report_submission']);
        $this->assertDatabaseHas('notifications', ['related_id' => $report->id, 'type' => 'report_locked', 'recipient_id' => $this->nurse->id]);
        $this->assertSame(0, AuditLog::query()->where('report_id', $report->id)->count());
    }

    // ---- Test 4: unlocking a draft carries no submission semantics

    public function test_unlocking_a_draft_does_not_submit_it(): void
    {
        $report = $this->createDraft();
        $this->actingAs($this->admin)->postJson("/api/reports/{$report->id}/lock")->assertOk();
        $submissionNotifications = Notification::query()->where('type', 'new_report_submitted')->count();

        $this->actingAs($this->admin)->postJson("/api/reports/{$report->id}/unlock")->assertOk();

        $unlocked = $report->fresh();
        $this->assertSame('draft', $unlocked->status);
        $this->assertNull($unlocked->submitted_at, 'an unlock must not stamp submitted_at');
        $this->assertNull($unlocked->locked_at);

        // The audit trail says what happened: draft, locked, draft again.
        $this->assertSame(['draft', 'locked', 'draft'], $this->statusTrail($report));
        $this->assertDatabaseMissing('report_status_history', ['report_id' => $report->id, 'status' => 'submitted']);
        $this->assertDatabaseHas('report_status_history', [
            'report_id' => $report->id,
            'status' => 'draft',
            'changed_by' => $this->admin->id,
            'note' => 'Report unlocked for correction.',
        ]);

        $this->assertSame($submissionNotifications, Notification::query()->where('type', 'new_report_submitted')->count());
        $this->assertDatabaseMissing('notifications', ['related_id' => $report->id, 'related_entity' => 'report_submission']);
        $this->assertSame(
            ['report_locked', 'report_unlocked'],
            Notification::query()->where('related_id', $report->id)->orderBy('created_at')->orderBy('id')->pluck('type')->all(),
        );
        $this->assertSame(0, AuditLog::query()->where('report_id', $report->id)->count());
    }

    public function test_viewing_and_commenting_never_submit_an_unlocked_draft(): void
    {
        $report = $this->createDraft();
        $this->actingAs($this->admin)->postJson("/api/reports/{$report->id}/lock")->assertOk();
        $this->actingAs($this->admin)->postJson("/api/reports/{$report->id}/unlock")->assertOk();

        // Secondary actions around the lock cycle must not act as a submission.
        $this->actingAs($this->admin)->getJson("/api/reports/{$report->id}")->assertOk()->assertJsonPath('status', 'draft');
        $this->actingAs($this->admin)->getJson('/api/reports')->assertOk();
        $this->actingAs($this->nurse)->postJson("/api/reports/{$report->id}/comments", ['body' => 'Still a draft.'])->assertCreated();
        $this->actingAs($this->nurse)->getJson('/api/reports/status-history')->assertOk();

        $this->assertSame('draft', $report->fresh()->status);
        $this->assertNull($report->fresh()->submitted_at);
        $this->assertSame(['draft', 'locked', 'draft'], $this->statusTrail($report));
    }

    // ---- Test 5: the nurse resumes ordinary draft editing after the unlock

    public function test_nurse_can_edit_the_draft_again_after_unlock(): void
    {
        $report = $this->createDraft();
        $this->actingAs($this->admin)->postJson("/api/reports/{$report->id}/lock")->assertOk();

        $this->actingAs($this->nurse)
            ->putJson("/api/reports/{$report->id}", ['values' => $this->inpatientValues(totalPatientDays: 41)])
            ->assertForbidden();
        $this->assertSame(30, (int) $this->mondayPatientDays($report));

        $this->actingAs($this->admin)->postJson("/api/reports/{$report->id}/unlock")->assertOk();

        $this->actingAs($this->nurse)
            ->putJson("/api/reports/{$report->id}", ['values' => $this->inpatientValues(totalPatientDays: 41)])
            ->assertOk()
            ->assertJsonPath('status', 'draft')
            ->assertJsonPath('values.total_patient_days.dailyValues.monday', 41);

        $edited = $report->fresh();
        $this->assertSame('draft', $edited->status);
        $this->assertNull($edited->submitted_at);
        // Draft rules: cell edits are not audited and add no history row.
        $this->assertSame(0, AuditLog::query()->where('report_id', $report->id)->count());
        $this->assertSame(['draft', 'locked', 'draft'], $this->statusTrail($report));

        // Submission stays a separate, deliberate action that still works.
        $this->actingAs($this->nurse)
            ->postJson("/api/reports/{$report->id}/submit", ['values' => $this->inpatientValues(totalPatientDays: 41)])
            ->assertOk()
            ->assertJsonPath('status', 'submitted');
        $this->assertNotNull($report->fresh()->submitted_at);
        $this->assertSame(['draft', 'locked', 'draft', 'submitted'], $this->statusTrail($report));
    }

    // ---- Test 6: a submitted report keeps submitted-report rules after the unlock

    public function test_submitted_report_keeps_submitted_rules_after_unlock(): void
    {
        $report = $this->createSubmitted();
        $submittedAt = $report->submitted_at;

        $this->actingAs($this->admin)->postJson("/api/reports/{$report->id}/lock")->assertOk();
        $this->actingAs($this->admin)->postJson("/api/reports/{$report->id}/unlock")->assertOk();
        $this->assertSame('submitted', $report->fresh()->status);

        // Editing a submitted report is an audited post-submission change,
        // not a draft edit.
        $this->actingAs($this->nurse)
            ->putJson("/api/reports/{$report->id}", ['values' => $this->inpatientValues(totalPatientDays: 35)])
            ->assertOk()
            ->assertJsonPath('status', 'edited_after_submission');

        $edited = $report->fresh();
        $this->assertSame('edited_after_submission', $edited->status);
        $this->assertTrue($submittedAt->equalTo($edited->submitted_at));
        $this->assertSame(1, AuditLog::query()->where('report_id', $report->id)->count());
        $this->assertDatabaseHas('notifications', ['related_id' => $report->id, 'type' => 'submitted_report_edited']);
        $this->assertSame(['draft', 'submitted', 'locked', 'submitted', 'edited_after_submission'], $this->statusTrail($report));
    }

    // ---- helpers

    private function createDraft(): Report
    {
        $this->actingAs($this->nurse)->postJson('/api/reports', [
            'assignmentId' => $this->assignment->id,
            'reportingPeriodId' => $this->period->id,
            'values' => $this->inpatientValues(),
        ])->assertCreated()->assertJsonPath('status', 'draft');

        return Report::query()->firstOrFail();
    }

    private function createSubmitted(): Report
    {
        $this->actingAs($this->nurse)->postJson('/api/reports', [
            'assignmentId' => $this->assignment->id,
            'reportingPeriodId' => $this->period->id,
            'submit' => true,
            'values' => $this->inpatientValues(),
        ])->assertCreated()->assertJsonPath('status', 'submitted');

        return Report::query()->firstOrFail();
    }

    /**
     * @return list<string>
     */
    private function statusTrail(Report $report): array
    {
        return ReportStatusHistory::query()
            ->where('report_id', $report->id)
            ->orderBy('changed_at')
            ->orderBy('id')
            ->pluck('status')
            ->all();
    }

    private function mondayPatientDays(Report $report): ?string
    {
        return $this->actingAs($this->admin)
            ->getJson("/api/reports/{$report->id}")
            ->assertOk()
            ->json('values.total_patient_days.dailyValues.monday');
    }

    private function inpatientValues(int $totalPatientDays = 30, int $dischargedHome = 2, int $dischargedAma = 1): array
    {
        return [
            'total_patient_days' => [
                'fieldId' => 'total_patient_days',
                'dailyValues' => ['monday' => $totalPatientDays],
            ],
            'discharged_home' => [
                'fieldId' => 'discharged_home',
                'dailyValues' => ['monday' => $dischargedHome],
            ],
            'discharged_ama' => [
                'fieldId' => 'discharged_ama',
                'dailyValues' => ['monday' => $dischargedAma],
            ],
            'mdt_round_start_day' => [
                'fieldId' => 'mdt_round_start_day',
                'dailyValues' => ['monday' => '08:30'],
            ],
        ];
    }
}
