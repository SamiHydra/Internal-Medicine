<?php

namespace App\Http\Controllers\Api\Admin;

use App\Http\Controllers\Controller;
use App\Models\RotationBlock;
use App\Models\RotationCalendar;
use App\Services\Academic\RotationCalendarService;
use App\Services\Admin\AdminAuditService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Gate;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

/**
 * Rotation calendars and their generated blocks. The planner matrix endpoints
 * (plan/savePlan) arrive with the Phase 2 planner screen.
 */
class RotationController extends Controller
{
    public function __construct(
        private readonly RotationCalendarService $calendarService,
        private readonly AdminAuditService $auditService,
    ) {}

    public function calendars(): JsonResponse
    {
        Gate::authorize('viewAny', RotationCalendar::class);

        return response()->json([
            'data' => RotationCalendar::query()
                ->with('blocks')
                ->orderByDesc('starts_on')
                ->get()
                ->map(fn (RotationCalendar $calendar) => $this->serializeCalendar($calendar)),
        ]);
    }

    public function storeCalendar(Request $request): JsonResponse
    {
        Gate::authorize('create', RotationCalendar::class);

        $validated = $request->validate([
            'trainingYear' => ['required', 'integer', 'between:1,3'],
            'academicYearLabel' => ['required', 'string', 'max:32'],
            'startsOn' => ['required', 'date'],
            'blockKind' => ['required', 'string', Rule::in(RotationCalendar::BLOCK_KINDS)],
            'blockLengthWeeks' => ['sometimes', 'nullable', 'integer', 'between:1,52'],
            'blocksCount' => ['required', 'integer', 'between:1,24'],
        ]);

        $exists = RotationCalendar::query()
            ->where('training_year', $validated['trainingYear'])
            ->where('academic_year_label', $validated['academicYearLabel'])
            ->exists();

        if ($exists) {
            throw ValidationException::withMessages([
                'academicYearLabel' => ['A calendar for this training year and academic year already exists.'],
            ]);
        }

        $calendar = $this->calendarService->createCalendar(
            (int) $validated['trainingYear'],
            $validated['academicYearLabel'],
            Carbon::parse($validated['startsOn']),
            $validated['blockKind'],
            isset($validated['blockLengthWeeks']) ? (int) $validated['blockLengthWeeks'] : null,
            (int) $validated['blocksCount'],
        );

        $this->auditService->record($request->user(), 'create', 'rotation_calendar', $calendar->id, null, $this->serializeCalendar($calendar), $request);

        return response()->json($this->serializeCalendar($calendar), 201);
    }

    public function setCalendarActive(Request $request, RotationCalendar $calendar): JsonResponse
    {
        Gate::authorize('update', $calendar);

        $validated = $request->validate(['active' => ['required', 'boolean']]);
        $oldValues = $this->serializeCalendar($calendar->load('blocks'));

        $calendar->forceFill(['active' => (bool) $validated['active']])->save();
        $calendar->refresh()->load('blocks');

        $this->auditService->record($request->user(), 'set_active', 'rotation_calendar', $calendar->id, $oldValues, $this->serializeCalendar($calendar), $request);

        return response()->json($this->serializeCalendar($calendar));
    }

    private function serializeCalendar(RotationCalendar $calendar): array
    {
        return [
            'id' => $calendar->id,
            'trainingYear' => $calendar->training_year,
            'academicYearLabel' => $calendar->academic_year_label,
            'startsOn' => $calendar->starts_on?->toDateString(),
            'blockKind' => $calendar->block_kind,
            'blockLengthWeeks' => $calendar->block_length_weeks,
            'blocksCount' => $calendar->blocks_count,
            'active' => (bool) $calendar->active,
            'blocks' => $calendar->blocks->map(fn (RotationBlock $block) => [
                'id' => $block->id,
                'blockIndex' => $block->block_index,
                'startsOn' => $block->starts_on?->toDateString(),
                'endsOn' => $block->ends_on?->toDateString(),
            ])->values(),
        ];
    }
}
