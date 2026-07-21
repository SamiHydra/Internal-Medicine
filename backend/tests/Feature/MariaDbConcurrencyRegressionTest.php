<?php

namespace Tests\Feature;

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
     * Parallel workers need to see committed fixtures. This test owns and
     * explicitly removes its rows instead of relying on PHPUnit's parent
     * transaction, which is invisible to their independent connections.
     *
     * @var list<string>
     */
    protected $connectionsToTransact = [];

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

            File::put($releaseFile, 'go');

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

        User::query()->whereIn('id', $this->testUserIds)->delete();
    }
}
