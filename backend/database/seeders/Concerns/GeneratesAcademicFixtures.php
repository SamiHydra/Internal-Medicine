<?php

namespace Database\Seeders\Concerns;

use App\Models\StudentBatch;
use App\Models\TeachingSession;

/**
 * The fixture maths shared by every academic demo seeder: a stable per-person
 * standing, and the answer payload each evaluation form expects.
 *
 * Extracted so a later backfill generates numbers on exactly the same curve as
 * the original year of history. Two copies of this would drift, and the
 * leaderboards would show a step at the seam.
 */
trait GeneratesAcademicFixtures
{
    /**
     * Per-subject performance standing, memoised so one person scores
     * consistently across every evaluation they ever receive.
     *
     * @var array<string, float>
     */
    private array $standings = [];

    /**
     * A person's standing, in 0..1, stable for the whole run and derived from
     * their id. Without this every evaluation drew from the same distribution,
     * so 140 staff landed on near-identical scores and the leaderboard ranked
     * noise. Now some people are consistently strong, some consistently weak,
     * and the ranking means something.
     */
    private function standing(string $subjectId): float
    {
        if (isset($this->standings[$subjectId])) {
            return $this->standings[$subjectId];
        }

        // Deterministic per subject, so re-running the seeder keeps the same
        // people at the same end of the table.
        $spread = (crc32($subjectId) % 1000) / 1000;

        // Skew toward competent: a long tail of strong performers, a thin tail
        // of genuinely struggling ones, which is what a real cohort looks like.
        return $this->standings[$subjectId] = round(0.35 + ($spread ** 0.7) * 0.62, 3);
    }

    /**
     * Drift a standing slightly by month index so trend lines move instead of
     * sitting flat: most people improve a little over a year, a few slide.
     */
    private function standingAt(string $subjectId, int $monthIndex, int $monthCount): float
    {
        $standing = $this->standing($subjectId);
        $direction = (crc32($subjectId.':trend') % 4) === 0 ? -1 : 1;
        $progress = $monthCount > 0 ? $monthIndex / $monthCount : 0;

        return max(0.05, min(0.99, $standing + $direction * 0.12 * $progress));
    }

    /** True with a probability driven by standing: strong people fail rarely. */
    private function passes(float $standing, float $difficulty = 1.0): bool
    {
        return rand(1, 1000) <= (int) round(1000 * min(0.99, $standing ** $difficulty));
    }

    /** A 1-5 rating clustered around the subject's standing. */
    private function rating(float $standing): int
    {
        $base = 1 + $standing * 4;
        $jitter = (rand(0, 100) - 50) / 100; // +/- half a point of week-to-week noise

        return max(1, min(5, (int) round($base + $jitter)));
    }

    /** @return array<string, mixed> */
    private function mdtPayload(float $standing): array
    {
        // A weak consultant shows up late, sees fewer patients and skips steps.
        return [
            'senior_present' => $this->passes($standing, 0.4),
            'senior_joined_at' => sprintf('08:%02d', (int) round(rand(0, 20) + (1 - $standing) * 25)),
            'presence_minutes' => (int) round(25 + $standing * rand(25, 40)),
            'pct_patients_seen' => (int) round(45 + $standing * rand(40, 55)),
            'round_delayed' => ! $this->passes($standing, 1.6),
            'all_patients_reviewed' => $this->passes($standing),
            'mgmt_plan_documented' => $this->passes($standing),
            'vte_assessed' => $this->passes($standing, 1.3),
            'discharge_discussed' => $this->passes($standing, 1.3),
            'med_review_done' => $this->passes($standing),
            'critical_labs_reviewed' => $this->passes($standing),
            'mdt_participants' => ['consultant', 'residents', 'nurse'],
            'system_issues' => $this->passes($standing, 2.2) ? [] : ['lab_delay'],
            // Required and core on this form: the combined leaderboard blends it
            // with the indicator score at equal weight, so omitting it left every
            // seeded consultant ranked on half the formula.
            'overall_rating' => $this->rating($standing),
        ];
    }

    /** @return array<string, mixed> */
    private function acgmePayload(float $standing): array
    {
        // Concerns are only raised about people the rest of the form already
        // marks down, so the flag agrees with the score instead of contradicting
        // it - which is what makes the concerns list worth reading.
        $concerns = [];
        if ($standing < 0.55) {
            $concerns[] = 'punctuality';
        }
        if ($standing < 0.42) {
            $concerns[] = 'documentation';
        }

        return [
            'on_time' => $this->passes($standing),
            'professional' => $this->passes($standing, 0.6),
            'prepared' => $this->passes($standing),
            'management_plan' => $this->passes($standing, 1.3),
            'clinical_reasoning' => $this->passes($standing, 1.3),
            'presentation_clear' => $this->passes($standing),
            'communication' => $this->passes($standing),
            'documentation_timely' => $this->passes($standing, 1.5),
            'follow_through' => $this->passes($standing),
            'responsive_feedback' => $this->passes($standing, 0.6),
            'overall_rating' => $this->rating($standing),
            'concerns' => $concerns,
        ];
    }

    /** @return array<string, mixed> */
    private function studentWeeklyPayload(float $standing): array
    {
        return [
            'attendance_reliable' => $this->passes($standing),
            'participation_active' => $this->passes($standing, 1.3),
            'clinical_knowledge' => $this->passes($standing, 1.5),
            'skills_progress' => $this->passes($standing, 1.5),
            'professional_conduct' => $this->passes($standing, 0.6),
            'overall_rating' => $this->rating($standing),
        ];
    }

    /** @return array<string, mixed> */
    private function studentFinalPayload(float $standing): array
    {
        return [
            'knowledge_competent' => $this->passes($standing, 1.5),
            'skills_competent' => $this->passes($standing, 1.5),
            'professional_conduct' => $this->passes($standing, 0.6),
            'overall_rating' => $this->rating($standing),
            'strengths' => $standing >= 0.6
                ? 'Consistent, engaged, and reliable on the ward.'
                : 'Willing and punctual; engages well with bedside teaching.',
            'areas_to_improve' => $standing >= 0.6
                ? 'Broaden differential reasoning under time pressure.'
                : 'Needs to consolidate core knowledge and present more concisely.',
        ];
    }

    /**
     * Stable operational variation: most teaching happens, while a meaningful
     * minority is not held or cancelled so exception dashboards are useful.
     *
     * @return array{status: 'held'|'not_held'|'cancelled', reason: string|null}
     */
    private function teachingOutcome(StudentBatch $batch, TeachingSession $session): array
    {
        $signature = implode('|', [
            $batch->label,
            $session->scheduled_date->toDateString(),
            $session->activity_type,
            $session->subgroup ?? 'cohort',
        ]);
        $roll = crc32($signature) % 100;

        if ($roll < 78) {
            return ['status' => 'held', 'reason' => null];
        }

        if ($roll < 92) {
            $reasons = [
                'Consultant diverted to emergency clinical coverage',
                'Competing ward round exceeded the scheduled session time',
                'Students were attending a scheduled assessment',
            ];

            return ['status' => 'not_held', 'reason' => $reasons[$roll % count($reasons)]];
        }

        $reasons = [
            'Hospital-wide clinical meeting',
            'Public holiday teaching schedule',
            'Teaching ward temporarily unavailable',
        ];

        return ['status' => 'cancelled', 'reason' => $reasons[$roll % count($reasons)]];
    }
}
