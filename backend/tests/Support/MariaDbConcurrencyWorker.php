<?php

declare(strict_types=1);

use App\Models\DutyType;
use App\Models\EvaluationForm;
use App\Models\Section;
use App\Models\User;
use App\Services\Academic\EvaluationFormService;
use App\Services\Academic\RosterService;
use App\Services\Academic\TransferService;
use Illuminate\Contracts\Console\Kernel;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

require dirname(__DIR__, 2).'/vendor/autoload.php';

$app = require dirname(__DIR__, 2).'/bootstrap/app.php';
$app->make(Kernel::class)->bootstrap();

$encodedPayload = $argv[1] ?? '';
$payload = json_decode((string) base64_decode($encodedPayload, true), true, flags: JSON_THROW_ON_ERROR);

DB::connection()->getPdo();

// Everything the action needs is resolved BEFORE the ready signal: the service
// out of the container, the classes it autoloads, and the fixture rows it
// operates on. Each of those is tens of milliseconds the first time, and doing
// them after the barrier would desynchronise the two workers by far more than
// the contention window this harness exists to create. After the barrier the
// only work left is the database write under test.
$operation = match ($payload['action']) {
    'roster_assignment' => prepareRosterAssignment($payload),
    'transfer_request' => prepareTransferRequest($payload),
    'evaluation_draft' => prepareEvaluationDraft($payload),
    default => throw new InvalidArgumentException('Unknown concurrency worker action.'),
};

file_put_contents($payload['ready_file'], (string) getmypid(), LOCK_EX);

$startAt = awaitBarrier($payload['release_file'], $payload['result_file']);

// Deliberately a spin, not usleep(): sleeping hands the CPU back and returns a
// scheduler tick late, and a tick is the same order of magnitude as the
// operation being raced. Spinning keeps the process runnable so both workers
// leave the barrier within microseconds of each other. The test asserts that
// skew, so a regression here fails loudly instead of quietly serialising the
// two workers and passing.
while (microtime(true) < $startAt) {
    // Intentionally empty.
}

$startedAt = microtime(true);

try {
    $result = $operation();

    writeResult($payload['result_file'], [
        'outcome' => 'success',
        'started_at' => $startedAt,
        'finished_at' => microtime(true),
        ...$result,
    ]);
} catch (ValidationException $exception) {
    writeResult($payload['result_file'], [
        'outcome' => 'validation_error',
        'started_at' => $startedAt,
        'finished_at' => microtime(true),
        'errors' => $exception->errors(),
    ]);
} catch (Throwable $exception) {
    writeResult($payload['result_file'], [
        'outcome' => 'unexpected_error',
        'started_at' => $startedAt,
        'finished_at' => microtime(true),
        'exception' => $exception::class,
        'message' => $exception->getMessage(),
    ]);
    exit(1);
}

/**
 * Block until the parent publishes the shared start instant, then return it.
 * The parent writes the timestamp atomically (write + rename), so a numeric
 * payload here is always a complete one - a torn read of a truncated timestamp
 * would still be numeric, and would silently move one worker's start.
 */
function awaitBarrier(string $releaseFile, string $resultFile): float
{
    $deadline = microtime(true) + 20;

    while (true) {
        if (is_file($releaseFile)) {
            $contents = trim((string) file_get_contents($releaseFile));

            if (is_numeric($contents)) {
                return (float) $contents;
            }

            if ($contents === 'stop') {
                writeResult($resultFile, [
                    'outcome' => 'unexpected_error',
                    'exception' => RuntimeException::class,
                    'message' => 'The parent abandoned the concurrency barrier.',
                ]);
                exit(2);
            }
        }

        if (microtime(true) >= $deadline) {
            writeResult($resultFile, [
                'outcome' => 'unexpected_error',
                'exception' => RuntimeException::class,
                'message' => 'Timed out waiting for the concurrency barrier.',
            ]);
            exit(2);
        }

        usleep(1_000);
    }
}

/** @return Closure(): array{record_id: string} */
function prepareRosterAssignment(array $payload): Closure
{
    $service = app(RosterService::class);
    $user = User::query()->findOrFail($payload['user_id']);
    $type = DutyType::query()->findOrFail($payload['duty_type_id']);
    $by = User::query()->findOrFail($payload['created_by']);
    $from = Carbon::parse($payload['starts_on']);
    $to = Carbon::parse($payload['ends_on']);

    return static fn (): array => [
        'record_id' => $service->createAssignment(
            $user,
            $type,
            $from,
            $to,
            'admin',
            $by,
            'MariaDB parallel regression test',
        )->id,
    ];
}

/** @return Closure(): array{record_id: string} */
function prepareTransferRequest(array $payload): Closure
{
    $service = app(TransferService::class);
    $user = User::query()->findOrFail($payload['user_id']);
    $destination = Section::query()->findOrFail($payload['to_section_id']);

    return static fn (): array => [
        'record_id' => $service->request($user, $destination, 'MariaDB parallel regression test')->id,
    ];
}

/** @return Closure(): array{record_id: string, created: bool} */
function prepareEvaluationDraft(array $payload): Closure
{
    $service = app(EvaluationFormService::class);
    $form = EvaluationForm::query()->findOrFail($payload['form_id']);

    return static function () use ($service, $form): array {
        $result = $service->createDraftWithState($form);

        return [
            'record_id' => $result['form']->id,
            'created' => $result['created'],
        ];
    };
}

function writeResult(string $path, array $result): void
{
    file_put_contents($path, json_encode($result, JSON_THROW_ON_ERROR), LOCK_EX);
}
