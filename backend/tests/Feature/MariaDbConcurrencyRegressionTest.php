<?php

namespace Tests\Feature;

use App\Models\AdminAuditLog;
use App\Models\DutyAssignment;
use App\Models\DutyType;
use App\Models\EvaluationForm;
use App\Models\EvaluationFormField;
use App\Models\Notification;
use App\Models\Section;
use App\Models\TransferRequest;
use App\Models\User;
use Database\Seeders\RoleSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\File;
use Illuminate\Support\Str;
use Symfony\Component\Process\Process;
use Tests\TestCase;

class MariaDbConcurrencyRegressionTest extends TestCase
{
    use RefreshDatabase;

    /**
     * How far ahead of "both workers are ready" the shared start instant is
     * placed. It only has to cover the workers noticing the release file, so a
     * quarter second is generous; it is not a source of skew, because both
     * workers spin to the same absolute timestamp.
     */
    private const BARRIER_LEAD_SECONDS = 0.25;

    /**
     * Ceiling on how far apart the two workers may actually enter their
     * critical sections. The previous barrier let one worker leave up to a full
     * 10 ms poll interval after the other, which is longer than the operations
     * being raced - so the workers ran one after the other and every assertion
     * below passed without any contention ever occurring. Anything at or above
     * this bound means the barrier stopped working and the test is no longer
     * testing concurrency.
     */
    private const MAX_START_SKEW_SECONDS = 0.005;

    /**
     * Parallel workers connect independently, so on MariaDB they cannot see
     * anything held open in PHPUnit's parent transaction. This class therefore
     * commits its fixtures and removes them by hand in removeCommittedFixtures().
     *
     * Opting out ONLY on MariaDB matters. This used to be a flat
     * `protected $connectionsToTransact = []` property, which applied on every
     * driver - including the SQLite lane, where the test is skipped anyway.
     * With no connection to transact, RefreshDatabase neither caches nor
     * restores the shared in-memory PDO (it iterates connectionsToTransact() to
     * do both), yet it still sets RefreshDatabaseState::$migrated. Every test
     * class that ran after this one in the same process then got a brand-new
     * empty :memory: database that was never migrated: RosterTest alone is
     * 21/21 green, and 0/21 with "no such table: roles" when run after this
     * class. Returning the default here keeps the SQLite lane untouched.
     *
     * @return list<string|null>
     */
    protected function connectionsToTransact(): array
    {
        return DB::connection()->getDriverName() === 'mariadb'
            ? []
            : [config('database.default')];
    }

    /** @var list<string> */
    private array $testUserIds = [];

    /** @var list<string> */
    private array $testDraftIds = [];

    public function test_mariadb_serializes_first_roster_transfer_and_draft_writes(): void
    {
        if (DB::connection()->getDriverName() !== 'mariadb') {
            $this->markTestSkipped('True parallel locking regression runs only in the MariaDB CI lane.');
        }

        $this->seed(RoleSeeder::class);

        try {
            $this->assertParallelRosterAssignmentIsSerialized();
            $this->assertParallelTransferRequestIsSerialized();
            $this->assertParallelEvaluationDraftIsIdempotent();
        } finally {
            $this->removeCommittedFixtures();
        }
    }

    private function assertParallelRosterAssignmentIsSerialized(): void
    {
        $admin = $this->makeUser('admin', ['title' => 'Administrator']);
        $target = $this->makeUser('consultant', ['title' => 'Consultant']);
        $dutyType = DutyType::query()->where('slug', 'nephrology_ward_service')->firstOrFail();

        $results = $this->runWorkers('roster_assignment', [
            'user_id' => $target->id,
            'duty_type_id' => $dutyType->id,
            'starts_on' => '2026-07-01',
            'ends_on' => '2026-07-31',
            'created_by' => $admin->id,
        ]);

        $this->assertOutcomes($results, ['success', 'validation_error']);
        $this->assertSame(1, DutyAssignment::query()->where('user_id', $target->id)->count());
    }

    private function assertParallelTransferRequestIsSerialized(): void
    {
        $from = Section::query()->where('slug', 'nephrology')->firstOrFail();
        $to = Section::query()->where('slug', 'cardiology')->firstOrFail();
        $consultant = $this->makeUser('consultant', [
            'title' => 'Consultant',
            'section_id' => $from->id,
        ]);

        $results = $this->runWorkers('transfer_request', [
            'user_id' => $consultant->id,
            'to_section_id' => $to->id,
        ]);

        $this->assertOutcomes($results, ['success', 'validation_error']);
        $this->assertSame(1, TransferRequest::query()
            ->where('user_id', $consultant->id)
            ->where('status', 'pending')
            ->count());
    }

    private function assertParallelEvaluationDraftIsIdempotent(): void
    {
        $published = EvaluationForm::query()
            ->where('key', 'consultant_mdt')
            ->where('status', 'published')
            ->firstOrFail();

        $results = $this->runWorkers('evaluation_draft', ['form_id' => $published->id]);
        $this->testDraftIds = collect($results)
            ->where('outcome', 'success')
            ->pluck('record_id')
            ->unique()
            ->values()
            ->all();

        $this->assertOutcomes($results, ['success', 'success']);
        $this->assertSame(1, collect($results)->where('created', true)->count());
        $this->assertSame(1, collect($results)->pluck('record_id')->unique()->count());
        $this->assertSame(1, EvaluationForm::query()
            ->where('key', $published->key)
            ->where('status', 'draft')
            ->count());
    }

    /**
     * @param  array<string, mixed>  $payload
     * @return list<array<string, mixed>>
     */
    private function runWorkers(string $action, array $payload): array
    {
        $barrierDirectory = storage_path('framework/testing/mariadb-concurrency/'.Str::uuid());
        $releaseFile = $barrierDirectory.'/release';
        File::ensureDirectoryExists($barrierDirectory);

        $processes = [];
        $resultFiles = [];

        try {
            foreach ([1, 2] as $participant) {
                $readyFile = $barrierDirectory."/ready-{$participant}";
                $resultFile = $barrierDirectory."/result-{$participant}.json";
                $workerPayload = [
                    ...$payload,
                    'action' => $action,
                    'ready_file' => $readyFile,
                    'release_file' => $releaseFile,
                    'result_file' => $resultFile,
                ];

                $process = new Process([
                    PHP_BINARY,
                    base_path('tests/Support/MariaDbConcurrencyWorker.php'),
                    base64_encode(json_encode($workerPayload, JSON_THROW_ON_ERROR)),
                ], base_path(), $this->workerEnvironment());
                $process->setTimeout(30);
                $process->start();

                $processes[] = $process;
                $resultFiles[] = $resultFile;
            }

            $this->waitUntil(
                fn (): bool => File::exists($barrierDirectory.'/ready-1')
                    && File::exists($barrierDirectory.'/ready-2'),
                15,
                'Both MariaDB worker processes did not reach the start barrier.',
            );

            // The barrier is a shared absolute instant, not "whenever you next
            // notice this file". Written to a scratch name and renamed, because
            // rename is atomic: a worker that read a half-written timestamp
            // would still parse a valid - but much earlier - number and start
            // on its own.
            $startAt = microtime(true) + self::BARRIER_LEAD_SECONDS;
            File::put($releaseFile.'.pending', sprintf('%.6F', $startAt));
            File::move($releaseFile.'.pending', $releaseFile);

            foreach ($processes as $process) {
                $process->wait();
            }

            $results = [];
            foreach ($resultFiles as $index => $resultFile) {
                $this->assertFileExists(
                    $resultFile,
                    sprintf('Worker %d produced no result. stderr: %s', $index + 1, $processes[$index]->getErrorOutput()),
                );
                $results[] = json_decode(File::get($resultFile), true, flags: JSON_THROW_ON_ERROR);
            }

            $this->assertWorkersActuallyRaced($action, $results);

            return $results;
        } finally {
            File::put($releaseFile, 'stop');

            foreach ($processes as $process) {
                if ($process->isRunning()) {
                    $process->stop(1);
                }
            }

            File::deleteDirectory($barrierDirectory);
        }
    }

    /** @return array<string, string> */
    private function workerEnvironment(): array
    {
        $connection = config('database.connections.'.config('database.default'));

        return [
            'APP_ENV' => 'testing',
            'APP_KEY' => (string) config('app.key'),
            'BCRYPT_ROUNDS' => '4',
            'CACHE_STORE' => 'array',
            'DB_CONNECTION' => (string) config('database.default'),
            'DB_HOST' => (string) $connection['host'],
            'DB_PORT' => (string) $connection['port'],
            'DB_DATABASE' => (string) $connection['database'],
            'DB_USERNAME' => (string) $connection['username'],
            'DB_PASSWORD' => (string) $connection['password'],
            'DB_URL' => '',
            'MAIL_MAILER' => 'array',
            'QUEUE_CONNECTION' => 'sync',
            'SESSION_DRIVER' => 'array',
        ];
    }

    private function waitUntil(callable $condition, int $timeoutSeconds, string $failureMessage): void
    {
        $deadline = microtime(true) + $timeoutSeconds;

        while (! $condition()) {
            if (microtime(true) >= $deadline) {
                $this->fail($failureMessage);
            }

            usleep(10_000);
        }
    }

    /**
     * Guards the harness itself. Every outcome assertion in this class is
     * satisfied just as happily by two workers that ran one after the other, so
     * without this check a broken barrier turns the whole file into a green
     * test that exercises nothing. Both facts have to hold: the workers left
     * the barrier together, and their critical sections genuinely overlapped in
     * time (the loser is expected to be parked on the winner's row lock, so its
     * start must precede the winner's finish).
     *
     * @param  list<array<string, mixed>>  $results
     */
    private function assertWorkersActuallyRaced(string $action, array $results): void
    {
        $startedAt = [];
        $finishedAt = [];

        foreach ($results as $index => $result) {
            $this->assertArrayHasKey('started_at', $result, sprintf('Worker %d reported no start instant.', $index + 1));
            $this->assertArrayHasKey('finished_at', $result, sprintf('Worker %d reported no finish instant.', $index + 1));

            $startedAt[] = (float) $result['started_at'];
            $finishedAt[] = (float) $result['finished_at'];
        }

        $skew = abs($startedAt[0] - $startedAt[1]);

        $this->assertLessThan(
            self::MAX_START_SKEW_SECONDS,
            $skew,
            sprintf(
                'The %s workers left the start barrier %.3F ms apart, so they did not race. '.
                'The concurrency assertions that follow would pass on sequential execution.',
                $action,
                $skew * 1000,
            ),
        );

        $this->assertLessThan(
            min($finishedAt),
            max($startedAt),
            sprintf(
                'The %s workers did not overlap: the later worker started %.3F ms after the earlier one finished, '.
                'so nothing contended.',
                $action,
                (max($startedAt) - min($finishedAt)) * 1000,
            ),
        );
    }

    /**
     * @param  list<array<string, mixed>>  $results
     * @param  list<string>  $expected
     */
    private function assertOutcomes(array $results, array $expected): void
    {
        $actual = collect($results)->pluck('outcome')->sort()->values()->all();
        sort($expected);

        $this->assertSame($expected, $actual, 'Unexpected worker results: '.json_encode($results));
    }

    /** @param array<string, mixed> $attributes */
    private function makeUser(string $role, array $attributes = []): User
    {
        $user = User::factory()->role($role)->create($attributes);
        $this->testUserIds[] = $user->id;

        return $user;
    }

    private function removeCommittedFixtures(): void
    {
        DutyAssignment::query()->whereIn('user_id', $this->testUserIds)->delete();

        $transferIds = TransferRequest::query()->whereIn('user_id', $this->testUserIds)->pluck('id');
        Notification::query()->whereIn('related_id', $transferIds)->delete();
        TransferRequest::query()->whereIn('id', $transferIds)->delete();

        EvaluationFormField::query()->whereIn('form_id', $this->testDraftIds)->delete();
        EvaluationForm::query()->whereIn('id', $this->testDraftIds)->delete();

        // TransferService audits its own writes, and admin_audit_logs holds a
        // foreign key to users. Leaving those rows behind made the user delete
        // fail, and because this class commits its fixtures the survivors then
        // leaked into every later class in the run.
        AdminAuditLog::query()->whereIn('user_id', $this->testUserIds)->delete();

        User::query()->whereIn('id', $this->testUserIds)->delete();
    }
}
