<?php

namespace App\Http\Controllers\Api\Admin;

use App\Http\Controllers\Controller;
use App\Models\DutyAssignment;
use App\Models\DutyType;
use App\Models\RotationBlock;
use App\Models\Section;
use App\Models\User;
use App\Services\Academic\RosterService;
use App\Services\Admin\AdminAuditService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Gate;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

/**
 * The month-by-month duty roster: every consultant's and resident's monthly
 * duty plus day-level duties (on-call, Transition). Reads one month at a
 * time; writes go through RosterService inside one transaction.
 */
class DutyRosterController extends Controller
{
    public function __construct(
        private readonly RosterService $rosterService,
        private readonly AdminAuditService $auditService,
    ) {}

    public function month(int $year, int $month): JsonResponse
    {
        Gate::authorize('viewAny', DutyAssignment::class);

        [$monthStart, $monthEnd] = $this->monthBounds($year, $month);

        $people = User::query()
            ->whereIn('role_key', ['resident', 'consultant'])
            ->where('active', true)
            ->with('section')
            ->orderBy('full_name')
            ->get();

        $assignments = DutyAssignment::query()
            ->with('dutyType')
            ->whereIn('user_id', $people->pluck('id'))
            ->whereDate('starts_on', '<=', $monthEnd->toDateString())
            ->whereDate('ends_on', '>=', $monthStart->toDateString())
            ->orderBy('starts_on')
            ->get()
            ->groupBy('user_id');

        $sections = Section::query()->orderBy('name')->get();
        $rotationBlocks = RotationBlock::query()
            ->with('calendar')
            ->whereHas('calendar', fn ($query) => $query
                ->where('active', true)
                ->whereIn('training_year', $people->pluck('training_year')->filter()->unique()))
            ->whereDate('starts_on', '<=', $monthEnd->toDateString())
            ->whereDate('ends_on', '>=', $monthStart->toDateString())
            ->orderBy('starts_on')
            ->get()
            ->groupBy(fn (RotationBlock $block) => $block->calendar?->training_year);

        return response()->json([
            'year' => $year,
            'month' => $month,
            'startsOn' => $monthStart->toDateString(),
            'endsOn' => $monthEnd->toDateString(),
            'sections' => $sections->map(fn (Section $section) => [
                'id' => $section->id,
                'name' => $section->name,
            ])->values(),
            'people' => $people->map(function (User $person) use ($assignments, $rotationBlocks) {
                $personAssignments = $assignments->get($person->id, collect());
                $personRotationBlocks = $person->role_key === 'resident' && $person->training_year !== null
                    ? $rotationBlocks->get($person->training_year, collect())
                    : collect();

                return [
                    'id' => $person->id,
                    'fullName' => $person->full_name,
                    'role' => $person->role_key,
                    'title' => $person->title,
                    'sectionId' => $person->section_id,
                    'sectionName' => $person->section?->name,
                    'trainingYear' => $person->training_year,
                    'rotationGroup' => $person->rotation_group,
                    'rotationManaged' => $personRotationBlocks->isNotEmpty(),
                    'rotationBlocks' => $personRotationBlocks->map(fn (RotationBlock $block) => [
                        'id' => $block->id,
                        'calendarId' => $block->calendar_id,
                        'academicYearLabel' => $block->calendar?->academic_year_label,
                        'blockIndex' => $block->block_index,
                        'startsOn' => $block->starts_on?->toDateString(),
                        'endsOn' => $block->ends_on?->toDateString(),
                    ])->values(),
                    'monthly' => $personAssignments
                        ->filter(fn (DutyAssignment $assignment) => $assignment->dutyType?->granularity === 'monthly')
                        ->map(fn (DutyAssignment $assignment) => $this->serializeAssignment($assignment))
                        ->values(),
                    'daily' => $personAssignments
                        ->filter(fn (DutyAssignment $assignment) => $assignment->dutyType?->granularity === 'daily')
                        ->map(fn (DutyAssignment $assignment) => $this->serializeAssignment($assignment))
                        ->values(),
                ];
            })->values(),
        ]);
    }

    public function saveMonth(Request $request, int $year, int $month): JsonResponse
    {
        Gate::authorize('create', DutyAssignment::class);

        $validated = $request->validate([
            'assignments' => ['required', 'array', 'max:500'],
            'assignments.*.userId' => ['required', 'string', Rule::exists('users', 'id')],
            'assignments.*.dutyTypeId' => ['present', 'nullable', 'string', Rule::exists('duty_types', 'id')],
            'assignments.*.overrideReason' => ['sometimes', 'nullable', 'string', 'min:10', 'max:500'],
        ]);

        [$monthStart, $monthEnd] = $this->monthBounds($year, $month);

        $rows = [];
        $cleared = [];
        $overrideDetails = [];

        $users = User::query()
            ->whereIn('id', collect($validated['assignments'])->pluck('userId')->unique())
            ->get()
            ->keyBy('id');

        $rotationYears = $users
            ->filter(fn (User $user) => $user->role_key === 'resident' && $user->training_year !== null)
            ->pluck('training_year')
            ->unique();
        $rotationManagedYears = RotationBlock::query()
            ->whereHas('calendar', fn ($query) => $query
                ->where('active', true)
                ->whereIn('training_year', $rotationYears))
            ->whereDate('starts_on', '<=', $monthEnd->toDateString())
            ->whereDate('ends_on', '>=', $monthStart->toDateString())
            ->with('calendar:id,training_year')
            ->get()
            ->pluck('calendar.training_year')
            ->filter()
            ->unique();

        foreach ($validated['assignments'] as $index => $entry) {
            $person = $users[$entry['userId']];
            $rotationManaged = $person->role_key === 'resident'
                && $person->training_year !== null
                && $rotationManagedYears->contains($person->training_year);
            $overrideReason = trim((string) ($entry['overrideReason'] ?? ''));

            if ($rotationManaged && $overrideReason === '') {
                throw ValidationException::withMessages([
                    "assignments.{$index}.overrideReason" => ['Explain why this calendar-month override is necessary. The resident is managed by an active rotation block.'],
                ]);
            }

            if ($rotationManaged) {
                $overrideDetails[] = [
                    'userId' => $person->id,
                    'reason' => $overrideReason,
                    'dutyTypeId' => $entry['dutyTypeId'],
                ];
            }

            if ($entry['dutyTypeId'] === null) {
                $cleared[] = $entry;

                continue;
            }

            $rows[] = [
                'user_id' => $entry['userId'],
                'duty_type_id' => $entry['dutyTypeId'],
                'starts_on' => $monthStart->toDateString(),
                'ends_on' => $monthEnd->toDateString(),
                'note' => $rotationManaged
                    ? RosterService::ROTATION_OVERRIDE_NOTE_PREFIX.$overrideReason
                    : null,
            ];
        }

        $this->assertMonthlyTypes(array_column($rows, 'duty_type_id'));

        // Clearing a cell frees the user's month; a cross-month block is
        // trimmed or split, never deleted outside this month.
        foreach ($cleared as $entry) {
            $this->rosterService->carveMonthlyWindow($entry['userId'], $monthStart->toDateString(), $monthEnd->toDateString());
        }

        $this->rosterService->bulkAssign($rows, 'admin', $request->user());

        $this->auditService->record(
            $request->user(),
            'save_roster_month',
            'duty_roster',
            sprintf('%04d-%02d', $year, $month),
            null,
            [
                'assigned' => count($rows),
                'cleared' => count($cleared),
                'rotationOverrides' => $overrideDetails,
            ],
            $request,
        );

        return $this->month($year, $month);
    }

    public function saveDaily(Request $request): JsonResponse
    {
        Gate::authorize('create', DutyAssignment::class);

        $validated = $request->validate([
            'userId' => ['required', 'string', Rule::exists('users', 'id')],
            'dutyTypeId' => ['required', 'string', Rule::exists('duty_types', 'id')],
            'date' => ['required', 'date'],
            'remove' => ['sometimes', 'boolean'],
        ]);

        $dutyType = DutyType::query()->findOrFail($validated['dutyTypeId']);

        if ($dutyType->granularity !== 'daily') {
            throw ValidationException::withMessages([
                'dutyTypeId' => ['Only day-level duty types can be written through the daily strip.'],
            ]);
        }

        $date = Carbon::parse($validated['date'])->toDateString();

        if ($validated['remove'] ?? false) {
            $deleted = DutyAssignment::query()
                ->where('user_id', $validated['userId'])
                ->where('duty_type_id', $dutyType->id)
                ->whereDate('starts_on', $date)
                ->whereDate('ends_on', $date)
                ->delete();

            $this->auditService->record($request->user(), 'remove_daily_duty', 'duty_roster', $validated['userId'], ['dutyTypeId' => $dutyType->id, 'date' => $date], null, $request);

            return response()->json(['removed' => $deleted > 0]);
        }

        $this->rosterService->bulkAssign([[
            'user_id' => $validated['userId'],
            'duty_type_id' => $dutyType->id,
            'starts_on' => $date,
            'ends_on' => $date,
        ]], 'admin', $request->user());

        $this->auditService->record($request->user(), 'save_daily_duty', 'duty_roster', $validated['userId'], null, ['dutyTypeId' => $dutyType->id, 'date' => $date], $request);

        return response()->json(['saved' => true], 201);
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
                'assignments' => ['Month cells only accept monthly duty types; use the daily strip for day-level duties.'],
            ]);
        }
    }

    /**
     * @return array{0: Carbon, 1: Carbon}
     */
    private function monthBounds(int $year, int $month): array
    {
        if ($month < 1 || $month > 12 || $year < 2000 || $year > 2100) {
            throw ValidationException::withMessages([
                'month' => ['Invalid roster month.'],
            ]);
        }

        $start = Carbon::create($year, $month, 1)->startOfDay();

        return [$start, $start->copy()->endOfMonth()];
    }

    private function serializeAssignment(DutyAssignment $assignment): array
    {
        return [
            'id' => $assignment->id,
            'dutyTypeId' => $assignment->duty_type_id,
            'dutyTypeName' => $assignment->dutyType?->name,
            'startsOn' => $assignment->starts_on?->toDateString(),
            'endsOn' => $assignment->ends_on?->toDateString(),
            'source' => $assignment->source,
            'note' => $assignment->note,
            'isRotationOverride' => $assignment->source === 'admin'
                && str_starts_with((string) $assignment->note, RosterService::ROTATION_OVERRIDE_NOTE_PREFIX),
        ];
    }
}
