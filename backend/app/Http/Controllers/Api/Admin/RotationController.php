<?php

namespace App\Http\Controllers\Api\Admin;

use App\Http\Controllers\Controller;
use App\Models\DutyAssignment;
use App\Models\DutyType;
use App\Models\RotationBlock;
use App\Models\RotationCalendar;
use App\Models\User;
use App\Services\Academic\RosterService;
use App\Services\Academic\RotationCalendarService;
use App\Services\Academic\RotationPlanStateService;
use App\Services\Admin\AdminAuditService;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Gate;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

/**
 * Rotation calendars, their generated blocks, and the planner matrix that
 * writes a training year's rotations into duty_assignments.
 */
class RotationController extends Controller
{
    /**
     * Whole block ranges are generated forward from this date, so an
     * unbounded start propagates a typo across every block it produces.
     * Same window the duty roster's daily strip accepts.
     */
    private const EARLIEST_CALENDAR_DATE = '2020-01-01';

    private const FORWARD_HORIZON_YEARS = 2;

    public function __construct(
        private readonly RotationCalendarService $calendarService,
        private readonly RosterService $rosterService,
        private readonly RotationPlanStateService $planStateService,
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
            'startsOn' => [
                'required',
                'date',
                'after_or_equal:'.self::EARLIEST_CALENDAR_DATE,
                'before_or_equal:'.Carbon::now()->addYears(self::FORWARD_HORIZON_YEARS)->toDateString(),
            ],
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

    /**
     * The planner matrix: the calendar's residents down one axis, its blocks
     * across the other, the current monthly assignment in each cell, and the
     * monthly duty-type catalog for the pickers.
     */
    public function plan(RotationCalendar $calendar): JsonResponse
    {
        Gate::authorize('view', $calendar);

        $calendar->load('blocks');

        $residents = User::query()
            ->where('role_key', 'resident')
            ->where('active', true)
            ->where('training_year', $calendar->training_year)
            ->orderBy('full_name')
            ->get();

        $blockRange = [
            $calendar->blocks->min('starts_on'),
            $calendar->blocks->max('ends_on'),
        ];

        $assignments = DutyAssignment::query()
            ->with('dutyType')
            ->whereIn('user_id', $residents->pluck('id'))
            ->whereDate('starts_on', '<=', $blockRange[1])
            ->whereDate('ends_on', '>=', $blockRange[0])
            ->whereHas('dutyType', fn (Builder $query) => $query->where('granularity', 'monthly'))
            ->get();

        $cells = [];

        foreach ($calendar->blocks as $block) {
            foreach ($residents as $resident) {
                $state = $this->planStateService->cell($assignments, $block, $resident->id);

                if ($state['status'] !== 'empty') {
                    $cells[] = [
                        'userId' => $resident->id,
                        'blockId' => $block->id,
                        ...$state,
                    ];
                }
            }
        }

        return response()->json([
            'calendar' => $this->serializeCalendar($calendar),
            'residents' => $residents->map(fn (User $resident) => [
                'id' => $resident->id,
                'fullName' => $resident->full_name,
                'rotationGroup' => $resident->rotation_group,
            ])->values(),
            'dutyTypes' => DutyType::query()
                ->where('granularity', 'monthly')
                ->where('active', true)
                ->orderBy('name')
                ->get()
                ->map(fn (DutyType $dutyType) => [
                    'id' => $dutyType->id,
                    'name' => $dutyType->name,
                    'category' => $dutyType->category,
                ])->values(),
            'assignments' => $cells,
        ]);
    }

    public function savePlan(Request $request, RotationCalendar $calendar): JsonResponse
    {
        Gate::authorize('update', $calendar);

        $validated = $request->validate([
            'assignments' => ['sometimes', 'array', 'max:2000'],
            'assignments.*.userId' => ['required_with:assignments', 'string', Rule::exists('users', 'id')],
            'assignments.*.blockId' => ['required_with:assignments', 'string', Rule::exists('rotation_blocks', 'id')],
            'assignments.*.dutyTypeId' => ['present', 'nullable', 'string', Rule::exists('duty_types', 'id')],
            // Year 3 convenience: plan whole groups; expanded to members server-side.
            'groupPlan' => ['sometimes', 'array', 'max:200'],
            'groupPlan.*.rotationGroup' => ['required_with:groupPlan', 'string', 'max:8'],
            'groupPlan.*.blockId' => ['required_with:groupPlan', 'string', Rule::exists('rotation_blocks', 'id')],
            'groupPlan.*.dutyTypeId' => ['required_with:groupPlan', 'string', Rule::exists('duty_types', 'id')],
            'confirmOverwrite' => ['sometimes', 'boolean'],
        ]);

        $blocks = $calendar->blocks()->get()->keyBy('id');

        $entries = collect($validated['assignments'] ?? []);

        foreach ($validated['groupPlan'] ?? [] as $groupEntry) {
            $memberIds = User::query()
                ->where('role_key', 'resident')
                ->where('active', true)
                ->where('training_year', $calendar->training_year)
                ->where('rotation_group', $groupEntry['rotationGroup'])
                ->pluck('id');

            foreach ($memberIds as $memberId) {
                $entries->push([
                    'userId' => $memberId,
                    'blockId' => $groupEntry['blockId'],
                    'dutyTypeId' => $groupEntry['dutyTypeId'],
                ]);
            }
        }

        $residentIds = User::query()
            ->where('role_key', 'resident')
            ->where('active', true)
            ->where('training_year', $calendar->training_year)
            ->whereIn('id', $entries->pluck('userId')->unique()->values())
            ->pluck('id')
            ->all();

        if (count($residentIds) !== $entries->pluck('userId')->unique()->count()) {
            throw ValidationException::withMessages([
                'assignments' => ['Every person must be an active resident in the selected training year.'],
            ]);
        }

        $existingAssignments = DutyAssignment::query()
            ->with('dutyType')
            ->whereIn('user_id', $residentIds)
            ->whereDate('starts_on', '<=', $calendar->blocks->max('ends_on'))
            ->whereDate('ends_on', '>=', $calendar->blocks->min('starts_on'))
            ->whereHas('dutyType', fn (Builder $query) => $query->where('granularity', 'monthly'))
            ->get();

        $requiresConfirmation = $entries->contains(function (array $entry) use ($blocks, $existingAssignments): bool {
            $block = $blocks[$entry['blockId']] ?? null;

            return $block !== null
                && $this->planStateService->cell($existingAssignments, $block, $entry['userId'])['requiresOverwriteConfirmation'];
        });

        if ($requiresConfirmation && ! ($validated['confirmOverwrite'] ?? false)) {
            throw ValidationException::withMessages([
                'confirmOverwrite' => ['This change replaces duty-roster or mixed coverage. Confirm the overwrite after reviewing the affected cells.'],
            ]);
        }

        $rows = [];
        $cleared = 0;

        foreach ($entries as $entry) {
            $block = $blocks[$entry['blockId']] ?? null;

            if ($block === null) {
                throw ValidationException::withMessages([
                    'assignments' => ['Every block must belong to the calendar being planned.'],
                ]);
            }

            if ($entry['dutyTypeId'] === null) {
                // Free just this block's window; a block-spanning assignment
                // is trimmed or split, never deleted wholesale.
                $this->rosterService->carveMonthlyWindow(
                    $entry['userId'],
                    $block->starts_on->toDateString(),
                    $block->ends_on->toDateString(),
                );
                $cleared++;

                continue;
            }

            $rows[] = [
                'user_id' => $entry['userId'],
                'duty_type_id' => $entry['dutyTypeId'],
                'starts_on' => $block->starts_on->toDateString(),
                'ends_on' => $block->ends_on->toDateString(),
            ];
        }

        $this->assertMonthlyTypes(array_column($rows, 'duty_type_id'));
        $this->rosterService->bulkAssign($rows, 'rotation_planner', $request->user());

        $this->auditService->record(
            $request->user(),
            'save_rotation_plan',
            'rotation_calendar',
            $calendar->id,
            null,
            [
                'assigned' => count($rows),
                'cleared' => $cleared,
                'confirmedOverwrite' => $requiresConfirmation,
            ],
            $request,
        );

        return $this->plan($calendar);
    }

    /**
     * @param  list<string>  $dutyTypeIds
     */
    private function assertMonthlyTypes(array $dutyTypeIds): void
    {
        if ($dutyTypeIds === []) {
            return;
        }

        $nonMonthly = DutyType::query()
            ->whereIn('id', array_unique($dutyTypeIds))
            ->where('granularity', '!=', 'monthly')
            ->exists();

        if ($nonMonthly) {
            throw ValidationException::withMessages([
                'assignments' => ['The rotation planner only writes monthly duty types.'],
            ]);
        }
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
