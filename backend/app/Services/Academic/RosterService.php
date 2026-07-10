<?php

namespace App\Services\Academic;

use App\Models\Department;
use App\Models\DutyAssignment;
use App\Models\DutyType;
use App\Models\User;
use App\Models\Ward;
use Carbon\CarbonInterface;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * The single source of truth for who is placed where on a given date. Every
 * later academic surface (evaluation eligibility, the morning roster, the duty
 * grid, the rotation planner) reads placements through this service, never
 * from `users.home_ward_id`.
 */
final class RosterService
{
    /** The user's monthly-granularity assignment covering $date, or null. */
    public function assignmentFor(User $user, CarbonInterface $date): ?DutyAssignment
    {
        return DutyAssignment::query()
            ->with(['dutyType.ward', 'dutyType.section'])
            ->where('user_id', $user->id)
            ->covering($date)
            ->whereHas('dutyType', fn (Builder $query) => $query->where('granularity', 'monthly'))
            ->orderBy('starts_on')
            ->first();
    }

    /** All assignments (monthly + daily) covering $date. */
    public function assignmentsFor(User $user, CarbonInterface $date): Collection
    {
        return DutyAssignment::query()
            ->with(['dutyType.ward', 'dutyType.section'])
            ->where('user_id', $user->id)
            ->covering($date)
            ->orderBy('starts_on')
            ->get();
    }

    /**
     * The pairing keys the user holds on $date, from duty types where
     * pairs_for_evaluation is true. Returns e.g. ['ward:<uuid>'] or
     * ['group:opd']. A consultant on ward service plus Transition duty the
     * same day holds two. An empty array means the user cannot evaluate or be
     * evaluated that day (a consultant on dialysis, a resident on leave),
     * which is correct.
     *
     * @return list<string>
     */
    public function pairingKeysFor(User $user, CarbonInterface $date): array
    {
        return $this->assignmentsFor($user, $date)
            ->map(fn (DutyAssignment $assignment) => $assignment->dutyType?->active
                ? $assignment->dutyType->pairingKey()
                : null)
            ->filter()
            ->unique()
            ->values()
            ->all();
    }

    /** True when author and subject share at least one pairing key on $date. */
    public function canPair(User $author, User $subject, CarbonInterface $date): bool
    {
        $authorKeys = $this->pairingKeysFor($author, $date);

        if ($authorKeys === []) {
            return false;
        }

        return array_intersect($authorKeys, $this->pairingKeysFor($subject, $date)) !== [];
    }

    /**
     * Active users of $roleKey sharing a pairing key with $user on $date.
     * One indexed query bounded by department headcount.
     */
    public function peersFor(User $user, CarbonInterface $date, string $roleKey): Collection
    {
        [$wardIds, $groups] = $this->splitPairingKeys($this->pairingKeysFor($user, $date));

        if ($wardIds === [] && $groups === []) {
            return User::query()->whereRaw('1 = 0')->get();
        }

        return User::query()
            ->where('active', true)
            ->where('role_key', $roleKey)
            ->where('id', '!=', $user->id)
            ->whereHas('dutyAssignments', function (Builder $query) use ($date, $wardIds, $groups): void {
                $query
                    ->covering($date)
                    ->whereHas('dutyType', function (Builder $typeQuery) use ($wardIds, $groups): void {
                        $typeQuery
                            ->where('active', true)
                            ->where('pairs_for_evaluation', true)
                            ->where(function (Builder $keyQuery) use ($wardIds, $groups): void {
                                $keyQuery
                                    ->when($wardIds !== [], fn (Builder $q) => $q->whereIn('ward_id', $wardIds))
                                    ->when($groups !== [], fn (Builder $q) => $q->orWhere(
                                        fn (Builder $groupQuery) => $groupQuery
                                            ->whereNull('ward_id')
                                            ->whereIn('pairing_group', $groups),
                                    ));
                            });
                    });
            })
            ->orderBy('full_name')
            ->get();
    }

    /**
     * The SNAPSHOT an evaluation permanently stores: the shared placement of
     * author and subject on $date, resolved server-side (never trusted from
     * the client) and never recomputed later, because people rotate. Ward
     * pairings win over group pairings when both exist. `legacy_ward_id` is a
     * best-effort department reference for the pre-Phase-4 analytics: the
     * first active reporting unit on that physical ward (deterministic by
     * slug), null for group placements.
     *
     * @return array{ward_ref_id: ?string, placement_type: string, legacy_ward_id: ?string}|null
     */
    public function sharedPlacementFor(User $author, User $subject, CarbonInterface $date): ?array
    {
        $shared = array_values(array_intersect(
            $this->pairingKeysFor($author, $date),
            $this->pairingKeysFor($subject, $date),
        ));

        if ($shared === []) {
            return null;
        }

        usort($shared, fn (string $a, string $b) => (int) str_starts_with($b, 'ward:') <=> (int) str_starts_with($a, 'ward:'));
        $key = $shared[0];

        if (str_starts_with($key, 'group:')) {
            return [
                'ward_ref_id' => null,
                'placement_type' => substr($key, 6),
                'legacy_ward_id' => null,
            ];
        }

        $wardId = substr($key, 5);
        $ward = Ward::query()->find($wardId);

        return [
            'ward_ref_id' => $wardId,
            'placement_type' => $ward?->slug === 'transition_ward' ? 'transition' : 'ward',
            'legacy_ward_id' => Department::query()
                ->where('ward_id', $wardId)
                ->where('active', true)
                ->orderBy('slug')
                ->value('id'),
        ];
    }

    /**
     * Everyone whose duty type has counts_for_morning_roster on $date.
     * Include/exclude overrides arrive with the morning session module
     * (Phase 6); until then the roster is purely assignment-driven.
     */
    public function morningRosterOn(CarbonInterface $date): Collection
    {
        return User::query()
            ->where('active', true)
            ->whereIn('role_key', ['resident', 'consultant'])
            ->whereHas('dutyAssignments', fn (Builder $query) => $query
                ->covering($date)
                ->whereHas('dutyType', fn (Builder $typeQuery) => $typeQuery
                    ->where('active', true)
                    ->where('counts_for_morning_roster', true)))
            ->orderBy('full_name')
            ->get();
    }

    /**
     * Guarded write: rejects an overlapping monthly assignment for the same
     * user. Daily-granularity duties are exempt because they legitimately
     * stack on top of a service month.
     */
    public function createAssignment(
        User $user,
        DutyType $type,
        CarbonInterface $from,
        CarbonInterface $to,
        string $source,
        User $by,
        ?string $note = null,
    ): DutyAssignment {
        if ($from->greaterThan($to)) {
            throw ValidationException::withMessages([
                'startsOn' => ['The assignment start date must be on or before its end date.'],
            ]);
        }

        return DB::transaction(function () use ($user, $type, $from, $to, $source, $by, $note): DutyAssignment {
            $this->assertNoMonthlyOverlap($user, $type, $from, $to);

            return DutyAssignment::query()->create([
                'user_id' => $user->id,
                'duty_type_id' => $type->id,
                'starts_on' => $from->toDateString(),
                'ends_on' => $to->toDateString(),
                'source' => $source,
                'created_by' => $by->id,
                'note' => $note,
            ]);
        });
    }

    /**
     * Bulk write used by the rotation planner and the duty roster grid, one
     * transaction. Rows: [user_id, duty_type_id, starts_on, ends_on]. Unlike
     * createAssignment this REPLACES: a monthly row first clears the user's
     * overlapping monthly assignments (an admin re-planning a cell is an
     * intentional overwrite), and an identical daily row is refreshed in
     * place, so re-saving a grid is idempotent.
     *
     * @param  list<array{user_id: string, duty_type_id: string, starts_on: string, ends_on: string, note?: string|null}>  $rows
     */
    public function bulkAssign(array $rows, string $source, User $by): void
    {
        if ($rows === []) {
            return;
        }

        DB::transaction(function () use ($rows, $source, $by): void {
            $types = DutyType::query()
                ->whereIn('id', array_unique(array_column($rows, 'duty_type_id')))
                ->get()
                ->keyBy('id');

            foreach ($rows as $row) {
                $type = $types[$row['duty_type_id']] ?? null;

                if ($type === null) {
                    throw ValidationException::withMessages([
                        'assignments' => ['Unknown duty type in the assignment payload.'],
                    ]);
                }

                if ($type->granularity === 'monthly') {
                    DutyAssignment::query()
                        ->where('user_id', $row['user_id'])
                        ->whereDate('starts_on', '<=', $row['ends_on'])
                        ->whereDate('ends_on', '>=', $row['starts_on'])
                        ->whereHas('dutyType', fn (Builder $query) => $query->where('granularity', 'monthly'))
                        ->delete();
                } else {
                    DutyAssignment::query()
                        ->where('user_id', $row['user_id'])
                        ->where('duty_type_id', $type->id)
                        ->whereDate('starts_on', $row['starts_on'])
                        ->whereDate('ends_on', $row['ends_on'])
                        ->delete();
                }

                DutyAssignment::query()->create([
                    'user_id' => $row['user_id'],
                    'duty_type_id' => $type->id,
                    'starts_on' => $row['starts_on'],
                    'ends_on' => $row['ends_on'],
                    'source' => $source,
                    'created_by' => $by->id,
                    'note' => $row['note'] ?? null,
                ]);
            }
        });
    }

    private function assertNoMonthlyOverlap(User $user, DutyType $type, CarbonInterface $from, CarbonInterface $to): void
    {
        if ($type->granularity !== 'monthly') {
            return;
        }

        $overlaps = DutyAssignment::query()
            ->where('user_id', $user->id)
            ->whereDate('starts_on', '<=', $to->toDateString())
            ->whereDate('ends_on', '>=', $from->toDateString())
            ->whereHas('dutyType', fn (Builder $query) => $query->where('granularity', 'monthly'))
            ->exists();

        if ($overlaps) {
            throw ValidationException::withMessages([
                'startsOn' => ['This person already holds a monthly assignment overlapping that period.'],
            ]);
        }
    }

    /**
     * @param  list<string>  $keys
     * @return array{0: list<string>, 1: list<string>}
     */
    private function splitPairingKeys(array $keys): array
    {
        $wardIds = [];
        $groups = [];

        foreach ($keys as $key) {
            if (str_starts_with($key, 'ward:')) {
                $wardIds[] = substr($key, 5);
            } elseif (str_starts_with($key, 'group:')) {
                $groups[] = substr($key, 6);
            }
        }

        return [$wardIds, $groups];
    }
}
