<?php

namespace Tests\Feature;

use App\Models\AppSetting;
use App\Models\Department;
use App\Models\Notification;
use App\Models\Report;
use App\Models\ReportAssignment;
use App\Models\ReportingPeriod;
use App\Models\User;
use Carbon\Carbon;
use Carbon\CarbonImmutable;
use Database\Seeders\AppSettingSeeder;
use Database\Seeders\DepartmentSeeder;
use Database\Seeders\ReportTemplateSeeder;
use Database\Seeders\RoleSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class NotificationsAndOverdueTest extends TestCase
{
    use RefreshDatabase;

    private User $admin;

    private User $nurse;

    protected function setUp(): void
    {
        parent::setUp();

        Carbon::setTestNow('2026-05-28 12:00:00');
        CarbonImmutable::setTestNow('2026-05-28 12:00:00');

        foreach ([RoleSeeder::class, ReportTemplateSeeder::class, DepartmentSeeder::class, AppSettingSeeder::class] as $seeder) {
            $this->seed($seeder);
        }

        $this->admin = User::factory()->role('admin', 'Administrator')->create([
            'full_name' => 'Admin User',
        ]);
        $this->nurse = User::factory()->create([
            'full_name' => 'Nurse User',
        ]);
    }

    protected function tearDown(): void
    {
        Carbon::setTestNow();
        CarbonImmutable::setTestNow();

        parent::tearDown();
    }

    public function test_sync_overdue_creates_stable_notifications_and_cleans_stale_rows(): void
    {
        $assignment = $this->createAssignment('gi_neuro_inpatient');
        $period = $this->createPeriod('2026-05-18', '2026-05-19 10:00:00');

        $this->artisan('reports:sync-overdue')->assertExitCode(0);

        $this->assertSame(2, Notification::query()->where('type', 'overdue_report')->count());
        $this->assertDatabaseHas('notifications', [
            'recipient_id' => $this->nurse->id,
            'type' => 'overdue_report',
            'title' => 'Overdue report',
            'related_route' => "/reports/{$assignment->id}/{$period->id}",
            'related_entity' => "overdue:{$assignment->id}:{$period->id}",
        ]);
        $this->assertDatabaseHas('notifications', [
            'recipient_id' => $this->admin->id,
            'type' => 'overdue_report',
            'message' => 'GI/Neurology missed the reporting deadline.',
        ]);

        $nurseNotification = Notification::query()
            ->where('recipient_id', $this->nurse->id)
            ->where('type', 'overdue_report')
            ->firstOrFail();
        $nurseNotification->forceFill(['read_at' => now()->subMinute()])->save();
        $readAt = $nurseNotification->read_at?->toJSON();

        $this->artisan('reports:sync-overdue')->assertExitCode(0);

        $this->assertSame(2, Notification::query()->where('type', 'overdue_report')->count());
        $this->assertSame($readAt, $nurseNotification->refresh()->read_at?->toJSON());

        Report::query()->create([
            'assignment_id' => $assignment->id,
            'department_id' => $assignment->department_id,
            'template_id' => $assignment->template_id,
            'reporting_period_id' => $period->id,
            'status' => 'submitted',
            'submitted_at' => now(),
            'created_by' => $this->nurse->id,
            'updated_by' => $this->nurse->id,
        ]);

        $this->artisan('reports:sync-overdue')->assertExitCode(0);

        $this->assertSame(0, Notification::query()->where('type', 'overdue_report')->count());
    }

    public function test_sync_overdue_clears_overdue_notifications_when_deadlines_are_disabled(): void
    {
        $assignment = $this->createAssignment('gi_neuro_inpatient');
        $period = $this->createPeriod('2026-05-18', '2026-05-19 10:00:00');

        Notification::query()->create([
            'recipient_id' => $this->nurse->id,
            'type' => 'overdue_report',
            'title' => 'Overdue report',
            'message' => 'A stale overdue notification.',
            'related_route' => "/reports/{$assignment->id}/{$period->id}",
            'related_entity' => "overdue:{$assignment->id}:{$period->id}",
            'created_at' => now(),
        ]);
        AppSetting::query()->where('setting_key', 'workflow_controls')->update([
            'value_json' => ['deadline_enforced' => false],
        ]);

        $this->artisan('reports:sync-overdue')->assertExitCode(0);

        $this->assertSame(0, Notification::query()->where('type', 'overdue_report')->count());
    }

    public function test_notification_endpoints_list_mark_read_read_all_and_delete_owned_rows(): void
    {
        $otherNurse = User::factory()->create();
        $ownFirst = $this->createNotification($this->nurse, 'First');
        $ownSecond = $this->createNotification($this->nurse, 'Second');
        $otherNotification = $this->createNotification($otherNurse, 'Other');

        $this->actingAs($this->nurse)
            ->getJson('/api/notifications')
            ->assertOk()
            ->assertJsonCount(2, 'data');

        $this->actingAs($this->nurse)
            ->patchJson('/api/notifications/read', [
                'ids' => [$ownFirst->id, $otherNotification->id],
            ])
            ->assertOk()
            ->assertJsonPath('updated', 1);

        $this->assertNotNull($ownFirst->refresh()->read_at);
        $this->assertNull($otherNotification->refresh()->read_at);

        $this->actingAs($this->nurse)
            ->patchJson('/api/notifications/read-all')
            ->assertOk()
            ->assertJsonPath('updated', 1);

        $this->assertNotNull($ownSecond->refresh()->read_at);
        $this->assertNull($otherNotification->refresh()->read_at);

        $this->actingAs($this->nurse)
            ->deleteJson('/api/notifications', [
                'ids' => [$ownFirst->id, $otherNotification->id],
            ])
            ->assertOk()
            ->assertJsonPath('deleted', 1);

        $this->assertDatabaseMissing('notifications', ['id' => $ownFirst->id]);
        $this->assertDatabaseHas('notifications', ['id' => $otherNotification->id]);
    }

    public function test_ensure_periods_command_keeps_a_rolling_window_with_current_deadline_settings(): void
    {
        AppSetting::query()->where('setting_key', 'weekly_deadline')->update([
            'value_json' => ['day' => 'tuesday', 'time' => '09:15'],
        ]);

        $this->artisan('reports:ensure-periods', [
            '--past' => 1,
            '--future' => 2,
        ])->assertExitCode(0);

        $this->assertSame(4, ReportingPeriod::query()->count());
        $firstPeriod = ReportingPeriod::query()->whereDate('week_start', '2026-05-18')->firstOrFail();
        $lastPeriod = ReportingPeriod::query()->whereDate('week_start', '2026-06-08')->firstOrFail();

        $this->assertSame('2026-05-24', $firstPeriod->week_end->toDateString());
        $this->assertSame('2026-05-19 09:15:00', $firstPeriod->deadline_at->toDateTimeString());
        $this->assertSame('2026-06-14', $lastPeriod->week_end->toDateString());
        $this->assertSame('2026-06-09 09:15:00', $lastPeriod->deadline_at->toDateTimeString());
    }

    private function createAssignment(string $departmentSlug): ReportAssignment
    {
        $department = Department::query()->where('slug', $departmentSlug)->firstOrFail();

        return ReportAssignment::query()->create([
            'nurse_id' => $this->nurse->id,
            'department_id' => $department->id,
            'template_id' => $department->template_id,
            'active' => true,
            'approved_at' => now(),
            'approved_by' => $this->admin->id,
        ]);
    }

    private function createPeriod(string $weekStart, string $deadline): ReportingPeriod
    {
        $weekStartDate = CarbonImmutable::parse($weekStart);

        return ReportingPeriod::query()->create([
            'week_start' => $weekStartDate->toDateString(),
            'week_end' => $weekStartDate->addDays(6)->toDateString(),
            'deadline_at' => $deadline,
            'month_label' => $weekStartDate->format('M Y'),
            'quarter_label' => sprintf('Q%d %d', $weekStartDate->quarter, $weekStartDate->year),
            'year_num' => $weekStartDate->year,
        ]);
    }

    private function createNotification(User $recipient, string $title): Notification
    {
        return Notification::query()->create([
            'recipient_id' => $recipient->id,
            'type' => 'report_locked',
            'title' => $title,
            'message' => "$title message",
            'related_route' => '/notifications',
            'related_entity' => 'test',
            'created_at' => now(),
        ]);
    }
}
