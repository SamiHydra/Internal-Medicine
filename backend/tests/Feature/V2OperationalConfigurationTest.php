<?php

namespace Tests\Feature;

use App\Console\Commands\LaunchReadinessCheck;
use App\Models\Evaluation;
use App\Models\EvaluationForm;
use App\Models\StudentBatch;
use App\Models\TeachingActivitySchedule;
use App\Models\TeachingSession;
use App\Models\User;
use App\Support\HospitalClock;
use Database\Seeders\RoleSeeder;
use Illuminate\Console\Scheduling\Schedule;
use Illuminate\Contracts\Console\Kernel;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Artisan;
use Tests\TestCase;

class V2OperationalConfigurationTest extends TestCase
{
    use RefreshDatabase;

    public function test_hospital_time_jobs_use_the_nairobi_business_timezone(): void
    {
        $this->assertSame('UTC', config('app.timezone'));
        $this->assertSame('Africa/Nairobi', config('app.business_timezone'));

        $events = collect(app(Schedule::class)->events());

        foreach ([
            'academic:open-morning-session' => '5 0 * * *',
            'academic:generate-teaching-sessions' => '10 0 * * *',
            'academic:apply-section-transfers' => '15 0 * * *',
            'academic:remind-morning-recorder' => '* * * * *',
            'academic:remind-reps' => '0 17 * * *',
            'academic:check-placements' => '0 10 * * 5',
        ] as $command => $expression) {
            $event = $events->first(fn ($candidate) => str_contains((string) $candidate->command, $command));

            $this->assertNotNull($event, "The {$command} schedule is registered.");
            $this->assertSame('Africa/Nairobi', $event->timezone);
            $this->assertSame($expression, $event->expression);
        }
    }

    public function test_midnight_hospital_jobs_derive_the_local_calendar_date_while_storage_stays_utc(): void
    {
        // Sunday 21:10 UTC is Monday 00:10 in Nairobi, exactly when teaching
        // generation runs. Using application-timezone now() would generate
        // Sunday and silently miss Monday's program.
        Carbon::setTestNow(Carbon::parse('2026-07-19 21:10:00', 'UTC'));

        try {
            $this->assertSame('2026-07-20', HospitalClock::today()->toDateString());
            $this->assertSame('Africa/Nairobi', HospitalClock::today()->getTimezone()->getName());

            $batch = StudentBatch::query()->create([
                'cohort' => 'C1',
                'label' => 'Boundary batch',
                'starts_on' => '2026-07-20',
                'ends_on' => '2026-08-31',
            ]);
            TeachingActivitySchedule::query()
                ->where('cohort', 'C1')
                ->where('activity_type', 'lecture')
                ->where('weekday', 1)
                ->firstOrFail()
                ->forceFill(['active' => true])
                ->save();

            $this->artisan('academic:generate-teaching-sessions')
                ->expectsOutputToContain('2026-07-20')
                ->assertSuccessful();

            $this->assertDatabaseHas('teaching_sessions', [
                'batch_id' => $batch->id,
                'activity_type' => 'lecture',
                'scheduled_date' => '2026-07-20 00:00:00',
            ]);
            $this->assertSame(1, TeachingSession::query()->where('activity_type', 'lecture')->count());
        } finally {
            Carbon::setTestNow();
        }
    }

    public function test_launch_readiness_is_canonical_and_old_name_remains_an_alias(): void
    {
        $commands = Artisan::all();

        $this->assertArrayHasKey('app:launch-readiness', $commands);
        $this->assertArrayHasKey('app:launch-check', $commands);
        $this->assertSame($commands['app:launch-readiness'], $commands['app:launch-check']);
    }

    public function test_atomic_deployment_treats_every_readiness_warning_as_a_failure(): void
    {
        $script = file_get_contents(base_path('../deploy/deploy.sh'));

        $this->assertIsString($script);
        $this->assertStringContainsString('php artisan app:launch-readiness --strict', $script);
        $this->assertStringNotContainsString('app:launch-readiness || true', $script);
        $this->assertStringContainsString('trap rollback_on_error ERR', $script);
        $this->assertStringContainsString('Deployment dry run (no files, services, database rows, or links will change).', $script);
        $this->assertStringContainsString('Node.js 22.12.0 or newer is required', $script);

        $readinessAt = strpos($script, 'php artisan app:launch-readiness --strict');
        $upAt = strpos($script, 'php artisan up', $readinessAt);
        $healthAt = strpos($script, 'STATUS="$(curl', $upAt);
        $queueRestartAt = strpos($script, 'php artisan queue:restart', $healthAt);

        $this->assertIsInt($readinessAt);
        $this->assertIsInt($upAt);
        $this->assertIsInt($healthAt);
        $this->assertIsInt($queueRestartAt);
        $this->assertLessThan($upAt, $readinessAt);
        $this->assertLessThan($healthAt, $upAt);
        $this->assertLessThan($queueRestartAt, $healthAt);
    }

    public function test_launch_readiness_strict_mode_can_pass_and_fails_on_any_warning(): void
    {
        $kernel = $this->app->make(Kernel::class);
        $kernel->registerCommand(new PassingStrictReadinessCommand);
        $kernel->registerCommand(new WarningStrictReadinessCommand);

        $this->artisan('test:launch-readiness-pass --strict')
            ->assertSuccessful();

        $this->artisan('test:launch-readiness-warning --strict')
            ->assertFailed();

        $this->artisan('test:launch-readiness-warning')
            ->assertSuccessful();
    }

    public function test_migration_verifier_rejects_a_vacuous_comparison_without_an_explicit_exception(): void
    {
        $this->seed(RoleSeeder::class);

        $author = User::factory()->role('resident', 'Resident')->create();
        $subject = User::factory()->role('consultant', 'Consultant')->create();
        $form = EvaluationForm::query()
            ->where('key', 'consultant_mdt')
            ->where('status', 'published')
            ->firstOrFail();

        Evaluation::query()->create([
            'form_id' => $form->id,
            'form_key' => $form->key,
            'author_id' => $author->id,
            'subject_user_id' => $subject->id,
            'evaluation_date' => now()->toDateString(),
        ]);

        $this->artisan('academic:verify-migration')
            ->expectsOutputToContain('NO LEGACY COMPARISON SET')
            ->expectsOutput('FAIL')
            ->assertFailed();

        $this->artisan('academic:verify-migration --allow-empty-legacy')
            ->expectsOutput('PASS')
            ->assertSuccessful();
    }
}

class PassingStrictReadinessCommand extends LaunchReadinessCheck
{
    protected $signature = 'test:launch-readiness-pass {--strict}';

    protected $aliases = [];

    protected function runChecks(): void
    {
        $this->pass('Synthetic production prerequisites', 'Every signal is satisfied.');
    }
}

class WarningStrictReadinessCommand extends LaunchReadinessCheck
{
    protected $signature = 'test:launch-readiness-warning {--strict}';

    protected $aliases = [];

    protected function runChecks(): void
    {
        $this->recordWarning('Synthetic production prerequisite', 'A host signal is missing.');
    }
}
