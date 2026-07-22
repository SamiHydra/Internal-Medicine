<?php

namespace App\Services\Academic;

use App\Models\RotationBlock;
use App\Models\RotationCalendar;
use Carbon\CarbonInterface;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * Admin-configured rotation calendars: the academic year start date moves
 * every year with the national program, so nothing here is hard-coded.
 * Year 1 and 2 rotate by calendar month; Year 3 runs continuous fixed-week
 * blocks with no gaps.
 */
final class RotationCalendarService
{
    public function createCalendar(
        int $trainingYear,
        string $label,
        CarbonInterface $startsOn,
        string $blockKind,
        ?int $blockLengthWeeks,
        int $blocksCount,
    ): RotationCalendar {
        if ($blockKind === 'fixed_weeks' && ($blockLengthWeeks === null || $blockLengthWeeks < 1)) {
            throw ValidationException::withMessages([
                'blockLengthWeeks' => ['Fixed-week calendars need a block length in weeks.'],
            ]);
        }

        return DB::transaction(function () use ($trainingYear, $label, $startsOn, $blockKind, $blockLengthWeeks, $blocksCount): RotationCalendar {
            $calendar = RotationCalendar::query()->create([
                'training_year' => $trainingYear,
                'academic_year_label' => $label,
                'starts_on' => $startsOn->toDateString(),
                'block_kind' => $blockKind,
                'block_length_weeks' => $blockKind === 'fixed_weeks' ? $blockLengthWeeks : null,
                'blocks_count' => $blocksCount,
                'active' => true,
            ]);

            $this->generateBlocks($calendar);

            return $calendar->load('blocks');
        });
    }

    /**
     * calendar_month: month-aligned blocks from starts_on (the first block may
     * be partial when the year starts mid-month; every later block is a full
     * calendar month). fixed_weeks: back-to-back blocks of block_length_weeks,
     * no gaps (client requirement for the Year 3 cycle).
     */
    public function generateBlocks(RotationCalendar $calendar): void
    {
        $calendar->blocks()->delete();

        $cursor = Carbon::parse($calendar->starts_on);

        for ($index = 1; $index <= $calendar->blocks_count; $index++) {
            if ($calendar->block_kind === 'calendar_month') {
                $endsOn = $cursor->copy()->endOfMonth();
            } else {
                $endsOn = $cursor->copy()->addDays(($calendar->block_length_weeks * 7) - 1);
            }

            RotationBlock::query()->create([
                'calendar_id' => $calendar->id,
                'block_index' => $index,
                'starts_on' => $cursor->toDateString(),
                'ends_on' => $endsOn->toDateString(),
            ]);

            $cursor = $endsOn->copy()->addDay();
        }
    }

    public function currentBlockFor(int $trainingYear, CarbonInterface $date): ?RotationBlock
    {
        return RotationBlock::query()
            ->whereHas('calendar', fn ($query) => $query
                ->where('training_year', $trainingYear)
                ->where('active', true))
            ->whereDate('starts_on', '<=', $date->toDateString())
            ->whereDate('ends_on', '>=', $date->toDateString())
            ->orderByDesc('starts_on')
            ->first();
    }

    /** The default section-transfer boundary: the first day of the next calendar month. */
    public function nextBoundaryAfter(CarbonInterface $date): CarbonInterface
    {
        return Carbon::parse($date->toDateString())->addMonthNoOverflow()->startOfMonth();
    }
}
