<?php

namespace Tests\Feature;

use App\Mail\LeadershipDigestMail;
use App\Models\Department;
use App\Models\Report;
use App\Models\ReportAssignment;
use App\Models\ReportingPeriod;
use App\Models\ReportTemplate;
use App\Models\User;
use App\Services\Reports\LeadershipDigestService;
use Database\Seeders\DepartmentSeeder;
use Database\Seeders\ReportFieldDefinitionSeeder;
use Database\Seeders\ReportTemplateSeeder;
use Database\Seeders\RoleSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Mail;
use Tests\TestCase;

class LeadershipDigestTest extends TestCase
{
    use RefreshDatabase;

    private User $nurse;

    private ReportAssignment $assignment;

    private ReportingPeriod $period;

    protected function setUp(): void
    {
        parent::setUp();

        foreach ([RoleSeeder::class, ReportTemplateSeeder::class, DepartmentSeeder::class, ReportFieldDefinitionSeeder::class] as $seeder) {
            $this->seed($seeder);
        }

        $this->nurse = User::factory()->create(['username' => 'hana.abera']);
        User::factory()->role('admin', 'Administrator')->create(['email' => 'lead@example.test']);

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
            'week_start' => now()->subDays(3)->toDateString(),
            'week_end' => now()->addDays(3)->toDateString(),
            'deadline_at' => now()->addDay(),
            'month_label' => 'Digest month',
            'quarter_label' => 'Q2 2026',
            'year_num' => 2026,
        ]);
    }

    private function submitReport(): void
    {
        $this->actingAs($this->nurse)->postJson('/api/reports', [
            'assignmentId' => $this->assignment->id,
            'reportingPeriodId' => $this->period->id,
            'submit' => true,
            'values' => [
                'total_admitted_patients' => ['fieldId' => 'total_admitted_patients', 'dailyValues' => ['monday' => 10]],
                'discharged_home' => ['fieldId' => 'discharged_home', 'dailyValues' => ['monday' => 4]],
            ],
        ])->assertCreated();
    }

    public function test_digest_service_summarizes_the_latest_period(): void
    {
        $this->submitReport();

        $digest = app(LeadershipDigestService::class)->build();

        $this->assertTrue($digest['hasData']);
        $this->assertSame(1, $digest['submitted']);
        $this->assertSame(1, $digest['expected']);
        $this->assertSame(100, $digest['deliveryRate']);
        $this->assertSame(10, $digest['admissions']);
        $this->assertSame(4, $digest['discharges']);
    }

    public function test_digest_command_queues_mail_to_admins(): void
    {
        Mail::fake();
        $this->submitReport();

        $this->artisan('reports:send-digest')
            ->expectsOutputToContain('Leadership digest queued for 1 recipient')
            ->assertExitCode(0);

        Mail::assertQueued(LeadershipDigestMail::class, function (LeadershipDigestMail $mail): bool {
            return $mail->hasTo('lead@example.test');
        });
    }

    public function test_digest_skips_when_no_admin_recipients(): void
    {
        Mail::fake();
        User::query()->where('role_key', 'admin')->update(['active' => false]);
        $this->submitReport();

        $this->artisan('reports:send-digest')
            ->expectsOutputToContain('No admin recipients')
            ->assertExitCode(0);

        Mail::assertNothingQueued();
    }

    public function test_scheduler_registers_the_weekly_digest(): void
    {
        $this->artisan('schedule:list')
            ->expectsOutputToContain('reports:send-digest')
            ->assertExitCode(0);
    }
}
