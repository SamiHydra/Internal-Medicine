<?php

namespace App\Exceptions;

use App\Models\Report;
use App\Support\Reports\ReportValues;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use RuntimeException;

/**
 * Thrown by the submission service when a save carries a revision that no
 * longer matches the stored report (another device or an administrator changed
 * it since the client loaded its copy). Rendered as 409 with the server's
 * current row and cell values so the client can show the two versions side by
 * side instead of silently overwriting either one.
 */
class ReportConflictException extends RuntimeException
{
    public const REASON_STALE = 'stale';

    public const REASON_EXISTS = 'exists';

    public function __construct(
        public readonly Report $report,
        public readonly string $reason,
        ?string $message = null,
    ) {
        parent::__construct($message ?? match ($reason) {
            self::REASON_EXISTS => 'This report was created elsewhere after you opened it. Review the saved values before applying yours.',
            default => 'This report was changed elsewhere after you loaded it. Review the newer values before applying yours.',
        });
    }

    public function render(Request $request): JsonResponse
    {
        $report = $this->report->loadMissing(['fieldValues.fieldDefinition', 'updater']);

        return response()->json([
            'message' => $this->getMessage(),
            'conflict' => [
                'reason' => $this->reason,
                'report' => [
                    'id' => $report->id,
                    'assignmentId' => $report->assignment_id,
                    'reportingPeriodId' => $report->reporting_period_id,
                    'status' => $report->status,
                    'submittedAt' => $report->submitted_at?->toJSON(),
                    'lockedAt' => $report->locked_at?->toJSON(),
                    'updatedAt' => $report->updated_at?->toJSON(),
                    'updatedById' => $report->updated_by,
                    'updatedByName' => $report->updater?->full_name,
                    'values' => ReportValues::serialize($report),
                ],
            ],
        ], 409);
    }
}
