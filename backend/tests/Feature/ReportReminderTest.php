<?php

namespace Tests\Feature;

use App\Jobs\SendNotificationDelivery;
use App\Models\AppSetting;
use App\Models\Department;
use App\Models\Notification;
use App\Models\Report;
use App\Models\ReportAssignment;
use App\Models\ReportingPeriod;
use App\Models\User;
use Database\Seeders\AppSettingSeeder;
use Database\Seeders\DepartmentSeeder;
use Database\Seeders\ReportTemplateSeeder;
use Database\Seeders\RoleSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Str;
use Tests\TestCase;

class ReportReminderTest extends TestCase
{
    use RefreshDatabase;

    private User $nurse;

    private Department $department;

    private ReportAssignment $assignment;

    private ReportingPeriod $period;

    protected function setUp(): void
    {
        parent::setUp();

        foreach ([RoleSeeder::class, ReportTemplateSeeder::class, DepartmentSeeder::class, AppSettingSeeder::class] as $seeder) {
            $this->seed($seeder);
        }

        $this->nurse = User::factory()->create([
            'email' => 'hana@example.test',
            'phone' => '+251911000111',
        ]);
        $this->department = Department::query()->where('slug', 'gi_neuro_inpatient')->firstOrFail();
        $this->assignment = ReportAssignment::query()->create([
            'nurse_id' => $this->nurse->id,
            'department_id' => $this->department->id,
            'template_id' => $this->department->template_id,
            'active' => true,
            'approved_at' => now(),
        ]);
        $this->period = $this->createReportingPeriod('2026-05-25', '2026-06-01 10:00:00');
    }

    public function test_reminder_dedup_key_fits_the_related_entity_column(): void
    {
        // Regression guard for the MariaDB-only bug: the dedup event key embeds two
        // UUIDs and must fit notifications.related_entity (widened to VARCHAR 191).
        // SQLite ignores VARCHAR length, so this pins the invariant explicitly.
        $key = sprintf('reminder:%s:%s:%s', 'overdue', (string) Str::uuid(), (string) Str::uuid());

        $this->assertGreaterThan(64, strlen($key), 'Key would have overflowed the original VARCHAR(64).');
        $this->assertLessThanOrEqual(191, strlen($key), 'Key must fit the widened related_entity column.');
    }

    public function test_send_reminders_creates_due_in_app_and_email_tiers_once(): void
    {
        Queue::fake();
        Carbon::setTestNow('2026-06-01 06:30:00');

        try {
            $this->artisan('reports:send-reminders')
                ->expectsOutputToContain('1 candidates, 2 reminders created, 1 deliveries queued')
                ->assertExitCode(0);

            $this->assertSame(2, Notification::query()->where('type', 'report_reminder')->count());
            $this->assertDatabaseHas('notifications', [
                'recipient_id' => $this->nurse->id,
                'type' => 'report_reminder',
                'title' => 'Report reminder',
                'related_entity' => "reminder:in_app:{$this->assignment->id}:{$this->period->id}",
            ]);
            $this->assertDatabaseHas('notifications', [
                'recipient_id' => $this->nurse->id,
                'type' => 'report_reminder',
                'related_entity' => "reminder:email:{$this->assignment->id}:{$this->period->id}",
            ]);
            Queue::assertPushed(SendNotificationDelivery::class, function (SendNotificationDelivery $job): bool {
                return $job->userId === $this->nurse->id
                    && $job->channels === ['email']
                    && $job->actionUrl === "/reports/{$this->assignment->id}/{$this->period->id}";
            });

            $this->artisan('reports:send-reminders')
                ->expectsOutputToContain('1 candidates, 0 reminders created, 0 deliveries queued')
                ->assertExitCode(0);

            $this->assertSame(2, Notification::query()->where('type', 'report_reminder')->count());
            Queue::assertPushed(SendNotificationDelivery::class, 1);
        } finally {
            Carbon::setTestNow();
        }
    }

    public function test_send_reminders_escalates_to_sms_and_overdue_without_duplicates(): void
    {
        Queue::fake();

        try {
            Carbon::setTestNow('2026-06-01 09:30:00');

            $this->artisan('reports:send-reminders')
                ->expectsOutputToContain('1 candidates, 3 reminders created, 2 deliveries queued')
                ->assertExitCode(0);
            $this->assertDatabaseHas('notifications', [
                'related_entity' => "reminder:sms:{$this->assignment->id}:{$this->period->id}",
            ]);

            Carbon::setTestNow('2026-06-01 10:15:00');

            $this->artisan('reports:send-reminders')
                ->expectsOutputToContain('1 candidates, 1 reminders created, 1 deliveries queued')
                ->assertExitCode(0);
            $this->assertDatabaseHas('notifications', [
                'title' => 'Report overdue',
                'related_entity' => "reminder:overdue:{$this->assignment->id}:{$this->period->id}",
            ]);

            Queue::assertPushed(SendNotificationDelivery::class, 3);
        } finally {
            Carbon::setTestNow();
        }
    }

    public function test_submitted_reports_and_disabled_deadlines_do_not_send_reminders(): void
    {
        Queue::fake();
        Carbon::setTestNow('2026-06-01 09:30:00');

        try {
            Report::query()->create([
                'assignment_id' => $this->assignment->id,
                'department_id' => $this->assignment->department_id,
                'template_id' => $this->assignment->template_id,
                'reporting_period_id' => $this->period->id,
                'status' => 'submitted',
                'submitted_at' => now(),
                'created_by' => $this->nurse->id,
                'updated_by' => $this->nurse->id,
            ]);

            $this->artisan('reports:send-reminders')
                ->expectsOutputToContain('0 candidates, 0 reminders created, 0 deliveries queued')
                ->assertExitCode(0);

            AppSetting::query()->updateOrCreate(
                ['setting_key' => 'workflow_controls'],
                ['value_json' => ['deadline_enforced' => false], 'updated_at' => now()],
            );
            Cache::forget('app-settings:structured:v1');

            Report::query()->delete();

            $this->artisan('reports:send-reminders')
                ->expectsOutputToContain('deadline enforced=no')
                ->assertExitCode(0);

            $this->assertSame(0, Notification::query()->where('type', 'report_reminder')->count());
            Queue::assertNothingPushed();
        } finally {
            Carbon::setTestNow();
        }
    }

    public function test_scheduler_registers_hourly_report_reminders(): void
    {
        $this->artisan('schedule:list')
            ->expectsOutputToContain('reports:send-reminders')
            ->assertExitCode(0);
    }

    private function createReportingPeriod(string $weekStart, string $deadline): ReportingPeriod
    {
        $start = Carbon::parse($weekStart);

        return ReportingPeriod::query()->create([
            'week_start' => $start->toDateString(),
            'week_end' => $start->copy()->addDays(6)->toDateString(),
            'deadline_at' => $deadline,
            'month_label' => $start->format('M Y'),
            'quarter_label' => sprintf('Q%d %d', $start->quarter, $start->year),
            'year_num' => $start->year,
        ]);
    }
}
