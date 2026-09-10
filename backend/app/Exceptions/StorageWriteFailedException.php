<?php

namespace App\Exceptions;

use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use RuntimeException;

/**
 * The local disk is configured with `throw => false`, so a failed write comes
 * back as `false` rather than an exception. Callers that persist metadata
 * about a file must raise this instead of recording a file that does not
 * exist (found by the storage-failure drill, docs/FAILURE_RECOVERY_TEST_REPORT.md).
 *
 * Reportable (logged, counted, forwarded) and rendered as a plain 500 with a
 * message the user can act on.
 */
class StorageWriteFailedException extends RuntimeException
{
    public function render(Request $request): JsonResponse
    {
        return response()->json(['message' => $this->getMessage()], 500);
    }
}
