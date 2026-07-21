<?php

namespace App\Services\Academic;

use App\Models\DutyAssignment;
use App\Models\RotationBlock;
use Illuminate\Support\Carbon;
use Illuminate\Support\Collection;

/**
 * Builds the effective state of one resident rotation block from the shared
 * duty-assignment timeline. A canonical cell is fully covered by one duty
 * type; gaps or duty changes are surfaced as a mixed state instead of being
 * hidden behind the first overlapping assignment.
 */
final class RotationPlanStateService
{
    /**
     * @param  Collection<int, DutyAssignment>  $assignments
     * @return array{
     *   dutyTypeId: string|null,
     *   status: 'empty'|'consistent'|'mixed',
     *   fullyCovered: bool,
     *   requiresOverwriteConfirmation: bool,
     *   segments: list<array{
     *     id: string,
     *     dutyTypeId: string,
     *     dutyTypeName: string|null,
     *     startsOn: string,
     *     endsOn: string,
     *     source: string,
     *     note: string|null
     *   }>
     * }
     */
    public function cell(Collection $assignments, RotationBlock $block, string $userId): array
    {
        $blockStart = Carbon::parse($block->starts_on)->startOfDay();
        $blockEnd = Carbon::parse($block->ends_on)->startOfDay();

        $overlapping = $assignments
            ->filter(fn (DutyAssignment $assignment) => $assignment->user_id === $userId
                && $assignment->starts_on->lessThanOrEqualTo($blockEnd)
                && $assignment->ends_on->greaterThanOrEqualTo($blockStart))
            ->sortBy(fn (DutyAssignment $assignment) => $assignment->starts_on->toDateString())
            ->values();

        if ($overlapping->isEmpty()) {
            return [
                'dutyTypeId' => null,
                'status' => 'empty',
                'fullyCovered' => false,
                'requiresOverwriteConfirmation' => false,
                'segments' => [],
            ];
        }

        $cursor = $blockStart->copy();
        $hasGap = false;
        $dutyTypeIds = [];
        $allPlannerOwned = true;
        $segments = [];

        foreach ($overlapping as $assignment) {
            $segmentStart = Carbon::parse($assignment->starts_on)->max($blockStart);
            $segmentEnd = Carbon::parse($assignment->ends_on)->min($blockEnd);

            if ($segmentStart->greaterThan($cursor)) {
                $hasGap = true;
            }

            if ($segmentEnd->greaterThanOrEqualTo($cursor)) {
                $cursor = $segmentEnd->copy()->addDay();
            }

            $dutyTypeIds[] = $assignment->duty_type_id;
            $allPlannerOwned = $allPlannerOwned && $assignment->source === 'rotation_planner';
            $segments[] = [
                'id' => $assignment->id,
                'dutyTypeId' => $assignment->duty_type_id,
                'dutyTypeName' => $assignment->dutyType?->name,
                'startsOn' => $segmentStart->toDateString(),
                'endsOn' => $segmentEnd->toDateString(),
                'source' => $assignment->source,
                'note' => $assignment->note,
            ];
        }

        $fullyCovered = ! $hasGap && $cursor->greaterThan($blockEnd);
        $uniqueDutyTypeIds = array_values(array_unique($dutyTypeIds));
        $consistent = $fullyCovered && count($uniqueDutyTypeIds) === 1;

        return [
            'dutyTypeId' => $consistent ? $uniqueDutyTypeIds[0] : null,
            'status' => $consistent ? 'consistent' : 'mixed',
            'fullyCovered' => $fullyCovered,
            // Re-saving a canonical planner-owned cell is routine. Replacing
            // roster/transfer data or a mixed timeline must be explicit.
            'requiresOverwriteConfirmation' => ! ($consistent && $allPlannerOwned),
            'segments' => $segments,
        ];
    }
}
