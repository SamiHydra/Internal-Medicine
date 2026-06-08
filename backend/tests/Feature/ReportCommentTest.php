<?php

namespace Tests\Feature;

use App\Models\Department;
use App\Models\Report;
use App\Models\ReportAssignment;
use App\Models\ReportComment;
use App\Models\ReportingPeriod;
use App\Models\ReportTemplate;
use App\Models\User;
use Database\Seeders\DepartmentSeeder;
use Database\Seeders\ReportFieldDefinitionSeeder;
use Database\Seeders\ReportTemplateSeeder;
use Database\Seeders\RoleSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class ReportCommentTest extends TestCase
{
    use RefreshDatabase;

    private User $nurse;

    private User $admin;

    private Report $report;

    protected function setUp(): void
    {
        parent::setUp();

        foreach ([RoleSeeder::class, ReportTemplateSeeder::class, DepartmentSeeder::class, ReportFieldDefinitionSeeder::class] as $seeder) {
            $this->seed($seeder);
        }

        $this->nurse = User::factory()->create(['full_name' => 'Hana Abera', 'username' => 'hana.abera']);
        $this->admin = User::factory()->role('admin', 'Administrator')->create(['full_name' => 'Admin One']);

        $template = ReportTemplate::query()->where('slug', 'inpatient_weekly')->firstOrFail();
        $department = Department::query()->where('slug', 'gi_neuro_inpatient')->firstOrFail();

        $assignment = ReportAssignment::query()->create([
            'nurse_id' => $this->nurse->id,
            'department_id' => $department->id,
            'template_id' => $template->id,
            'active' => true,
            'approved_at' => now(),
        ]);
        $period = ReportingPeriod::query()->create([
            'week_start' => '2026-05-25',
            'week_end' => '2026-05-31',
            'deadline_at' => '2026-06-01 10:00:00',
            'month_label' => 'May 2026',
            'quarter_label' => 'Q2 2026',
            'year_num' => 2026,
        ]);
        $this->report = Report::query()->create([
            'assignment_id' => $assignment->id,
            'department_id' => $department->id,
            'template_id' => $template->id,
            'reporting_period_id' => $period->id,
            'status' => 'submitted',
            'submitted_at' => now(),
            'created_by' => $this->nurse->id,
            'updated_by' => $this->nurse->id,
        ]);
    }

    public function test_nurse_comment_notifies_admins(): void
    {
        $this->actingAs($this->nurse)
            ->postJson("/api/reports/{$this->report->id}/comments", [
                'body' => 'Admissions were low this week because of the holiday.',
            ])
            ->assertCreated()
            ->assertJsonPath('authorRole', 'nurse')
            ->assertJsonPath('body', 'Admissions were low this week because of the holiday.');

        $this->assertDatabaseHas('notifications', [
            'recipient_id' => $this->admin->id,
            'type' => 'report_comment',
            'related_id' => $this->report->id,
        ]);
    }

    public function test_admin_comment_notifies_the_owning_nurse(): void
    {
        $this->actingAs($this->admin)
            ->postJson("/api/reports/{$this->report->id}/comments", [
                'body' => 'Thanks — can you confirm the discharge count?',
            ])
            ->assertCreated()
            ->assertJsonPath('authorRole', 'admin');

        $this->assertDatabaseHas('notifications', [
            'recipient_id' => $this->nurse->id,
            'type' => 'report_comment',
            'related_id' => $this->report->id,
        ]);
    }

    public function test_comments_are_listed_in_order(): void
    {
        $this->actingAs($this->nurse)->postJson("/api/reports/{$this->report->id}/comments", ['body' => 'First'])->assertCreated();
        $this->actingAs($this->admin)->postJson("/api/reports/{$this->report->id}/comments", ['body' => 'Second'])->assertCreated();

        $this->actingAs($this->admin)
            ->getJson("/api/reports/{$this->report->id}/comments")
            ->assertOk()
            ->assertJsonCount(2, 'data')
            ->assertJsonPath('data.0.body', 'First')
            ->assertJsonPath('data.1.body', 'Second');
    }

    public function test_reply_parent_must_belong_to_the_same_report(): void
    {
        $this->actingAs($this->admin)
            ->postJson("/api/reports/{$this->report->id}/comments", [
                'body' => 'Reply to nothing',
                'parent_id' => '00000000-0000-0000-0000-000000000000',
            ])
            ->assertUnprocessable()
            ->assertJsonValidationErrors('parent_id');
    }

    public function test_author_or_admin_can_delete_but_others_cannot(): void
    {
        $comment = ReportComment::query()->create([
            'report_id' => $this->report->id,
            'author_id' => $this->nurse->id,
            'body' => 'Owned by the nurse',
        ]);

        $otherNurse = User::factory()->create(['username' => 'other.nurse']);
        $this->actingAs($otherNurse)
            ->deleteJson("/api/reports/{$this->report->id}/comments/{$comment->id}")
            ->assertForbidden();

        // Admin can delete any comment.
        $this->actingAs($this->admin)
            ->deleteJson("/api/reports/{$this->report->id}/comments/{$comment->id}")
            ->assertOk();

        $this->assertDatabaseMissing('report_comments', ['id' => $comment->id]);
    }

    public function test_unassigned_nurse_cannot_view_comments(): void
    {
        $otherNurse = User::factory()->create(['username' => 'stranger.nurse']);

        $this->actingAs($otherNurse)
            ->getJson("/api/reports/{$this->report->id}/comments")
            ->assertForbidden();
    }
}
