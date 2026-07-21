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
file_put_contents($payload['ready_file'], (string) getmypid(), LOCK_EX);

$deadline = microtime(true) + 20;
while (! is_file($payload['release_file'])) {
    if (microtime(true) >= $deadline) {
        writeResult($payload['result_file'], [
            'outcome' => 'unexpected_error',
            'exception' => RuntimeException::class,
            'message' => 'Timed out waiting for the concurrency barrier.',
        ]);
        exit(2);
    }

    usleep(10_000);
}

try {
    $result = match ($payload['action']) {
        'roster_assignment' => createRosterAssignment($payload),
        'transfer_request' => createTransferRequest($payload),
        'evaluation_draft' => createEvaluationDraft($payload),
        default => throw new InvalidArgumentException('Unknown concurrency worker action.'),
    };

    writeResult($payload['result_file'], [
        'outcome' => 'success',
        ...$result,
    ]);
} catch (ValidationException $exception) {
    writeResult($payload['result_file'], [
        'outcome' => 'validation_error',
        'errors' => $exception->errors(),
    ]);
} catch (Throwable $exception) {
    writeResult($payload['result_file'], [
        'outcome' => 'unexpected_error',
        'exception' => $exception::class,
        'message' => $exception->getMessage(),
    ]);
    exit(1);
}

/** @return array{record_id: string} */
function createRosterAssignment(array $payload): array
{
    $assignment = app(RosterService::class)->createAssignment(
        User::query()->findOrFail($payload['user_id']),
        DutyType::query()->findOrFail($payload['duty_type_id']),
        Carbon::parse($payload['starts_on']),
        Carbon::parse($payload['ends_on']),
        'admin',
        User::query()->findOrFail($payload['created_by']),
        'MariaDB parallel regression test',
    );

    return ['record_id' => $assignment->id];
}

/** @return array{record_id: string} */
function createTransferRequest(array $payload): array
{
    $request = app(TransferService::class)->request(
        User::query()->findOrFail($payload['user_id']),
        Section::query()->findOrFail($payload['to_section_id']),
        'MariaDB parallel regression test',
    );

    return ['record_id' => $request->id];
}

/** @return array{record_id: string, created: bool} */
function createEvaluationDraft(array $payload): array
{
    $result = app(EvaluationFormService::class)->createDraftWithState(
        EvaluationForm::query()->findOrFail($payload['form_id']),
    );

    return [
        'record_id' => $result['form']->id,
        'created' => $result['created'],
    ];
}

function writeResult(string $path, array $result): void
{
    file_put_contents($path, json_encode($result, JSON_THROW_ON_ERROR), LOCK_EX);
}
