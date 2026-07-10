<?php

namespace App\Support\Academic;

use App\Models\Evaluation;

/**
 * The yes/no indicator sets whose true-percentage forms each direction's
 * score. Field keys, not columns: they survive the Phase 4 EAV migration
 * unchanged (the v1 forms reproduce the legacy columns one for one).
 */
final class EvaluationScoring
{
    /** @var list<string> */
    public const CONSULTANT_SCORE_ITEMS = [
        'all_patients_reviewed',
        'mgmt_plan_documented',
        'vte_assessed',
        'discharge_discussed',
        'med_review_done',
        'critical_labs_reviewed',
    ];

    /** @var list<string> */
    public const RESIDENT_SCORE_ITEMS = [
        'on_time',
        'prepared',
        'presentation_clear',
        'clinical_reasoning',
        'management_plan',
        'documentation_timely',
        'communication',
        'professional',
        'responsive_feedback',
        'follow_through',
    ];

    /** @return list<string> */
    public static function itemsForDirection(string $direction): array
    {
        return $direction === 'resident' ? self::RESIDENT_SCORE_ITEMS : self::CONSULTANT_SCORE_ITEMS;
    }

    public static function formKeyForDirection(string $direction): string
    {
        return $direction === 'resident' ? 'resident_acgme' : 'consultant_mdt';
    }

    /** The % of the direction's yes/no items answered true. */
    public static function score(Evaluation $evaluation, string $direction): float
    {
        $items = self::itemsForDirection($direction);
        $total = count($items);

        if ($total === 0) {
            return 0.0;
        }

        $yes = 0;
        foreach ($items as $item) {
            if ((bool) $evaluation->answer($item)) {
                $yes++;
            }
        }

        return $yes / $total * 100;
    }
}
