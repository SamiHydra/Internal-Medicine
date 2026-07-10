<?php

namespace App\Services\Academic;

use App\Models\ConsultantEvaluation;
use App\Models\Evaluation;
use App\Models\EvaluationAnswer;
use App\Models\EvaluationForm;
use App\Models\ResidentEvaluation;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Facades\DB;

/**
 * Copies the legacy consultant_evaluations / resident_evaluations rows into
 * the unified evaluations + evaluation_answers tables, and verifies the copy.
 * Shared by the data migration, the academic:verify-migration command, and
 * the test suite so all three exercise the same mapping.
 *
 * The legacy tables stay READ-ONLY (nothing writes them after Phase 4) and
 * are dropped in a later release once the department confirms.
 */
final class EvaluationMigrationService
{
    /** Field keys per legacy table, matching the v1 form definitions 1:1. */
    private const CONSULTANT_FIELDS = [
        'senior_present' => 'bool',
        'senior_joined_at' => 'time',
        'presence_minutes' => 'int',
        'pct_patients_seen' => 'int',
        'round_delayed' => 'bool',
        'all_patients_reviewed' => 'bool',
        'mgmt_plan_documented' => 'bool',
        'vte_assessed' => 'bool',
        'discharge_discussed' => 'bool',
        'med_review_done' => 'bool',
        'critical_labs_reviewed' => 'bool',
        'mdt_participants' => 'array',
        'system_issues' => 'array',
    ];

    private const RESIDENT_FIELDS = [
        'on_time' => 'bool',
        'prepared' => 'bool',
        'presentation_clear' => 'bool',
        'clinical_reasoning' => 'bool',
        'management_plan' => 'bool',
        'documentation_timely' => 'bool',
        'communication' => 'bool',
        'professional' => 'bool',
        'responsive_feedback' => 'bool',
        'follow_through' => 'bool',
        'overall_rating' => 'int',
        'concerns' => 'array',
    ];

    /**
     * Copy every legacy row that has not been copied yet. Idempotent: a
     * legacy row is skipped when an evaluation with its id already exists
     * (legacy ids are preserved so re-runs and verification are trivial).
     *
     * @return array{consultant: int, resident: int}
     */
    public function copy(): array
    {
        $copied = ['consultant' => 0, 'resident' => 0];

        $copied['consultant'] = $this->copyTable(
            ConsultantEvaluation::query()->orderBy('created_at'),
            'consultant_mdt',
            self::CONSULTANT_FIELDS,
        );

        $copied['resident'] = $this->copyTable(
            ResidentEvaluation::query()->orderBy('created_at'),
            'resident_acgme',
            self::RESIDENT_FIELDS,
        );

        return $copied;
    }

    /**
     * Row counts per form key plus a deep comparison of up to $sample random
     * source rows against their reconstructed answers.
     *
     * @return array{passed: bool, details: list<string>}
     */
    public function verify(int $sample = 50): array
    {
        $details = [];
        $passed = true;

        foreach ([
            ['consultant_mdt', ConsultantEvaluation::query(), self::CONSULTANT_FIELDS],
            ['resident_acgme', ResidentEvaluation::query(), self::RESIDENT_FIELDS],
        ] as [$formKey, $query, $fields]) {
            $legacyCount = (clone $query)->count();
            $unifiedCount = Evaluation::query()->where('form_key', $formKey)->count();

            if ($unifiedCount < $legacyCount) {
                $passed = false;
                $details[] = sprintf('%s: COUNT MISMATCH legacy=%d unified=%d', $formKey, $legacyCount, $unifiedCount);
            } else {
                $details[] = sprintf('%s: %d legacy rows, %d unified rows', $formKey, $legacyCount, $unifiedCount);
            }

            $rows = (clone $query)->inRandomOrder()->limit($sample)->get();

            foreach ($rows as $legacy) {
                $mismatch = $this->compareRow($legacy, $fields);

                if ($mismatch !== null) {
                    $passed = false;
                    $details[] = sprintf('%s row %s: %s', $formKey, $legacy->id, $mismatch);
                }
            }
        }

        return ['passed' => $passed, 'details' => $details];
    }

    /**
     * @param  array<string, string>  $fields
     */
    private function copyTable($query, string $formKey, array $fields): int
    {
        $form = EvaluationForm::query()
            ->where('key', $formKey)
            ->where('version', 1)
            ->firstOrFail();

        $copied = 0;

        foreach ($query->cursor() as $legacy) {
            if (Evaluation::query()->whereKey($legacy->id)->exists()) {
                continue;
            }

            DB::transaction(function () use ($legacy, $form, $fields, &$copied): void {
                $evaluation = new Evaluation([
                    'form_id' => $form->id,
                    'form_key' => $form->key,
                    'author_id' => $legacy->author_id,
                    'subject_user_id' => $legacy->subject_id,
                    'evaluation_date' => $legacy->evaluation_date?->toDateString(),
                    // The physical-ward snapshot (Phase 3) carries over; the
                    // legacy department ward_id stays behind with the legacy row.
                    'ward_id' => $legacy->ward_ref_id,
                    'placement_type' => $legacy->placement_type,
                    'external_evaluator_name' => $legacy->external_evaluator_name ?? null,
                    'external_evaluator_department' => $legacy->external_evaluator_department ?? null,
                    'entered_by_id' => $legacy->entered_by_id ?? null,
                    'comment' => $legacy->comment,
                ]);
                // Preserve the legacy id and timestamps so history is traceable.
                $evaluation->id = $legacy->id;
                $evaluation->created_at = $legacy->created_at;
                $evaluation->updated_at = $legacy->updated_at;
                $evaluation->save();

                foreach ($fields as $key => $kind) {
                    $value = $this->mapValue($legacy, $key, $kind);

                    if ($value === null) {
                        continue;
                    }

                    EvaluationAnswer::query()->create([
                        'evaluation_id' => $evaluation->id,
                        'field_key' => $key,
                        'value' => $value,
                    ]);
                }

                $copied++;
            });
        }

        return $copied;
    }

    /**
     * @param  array<string, string>  $fields
     */
    private function compareRow(Model $legacy, array $fields): ?string
    {
        $evaluation = Evaluation::query()->with('answers')->find($legacy->id);

        if ($evaluation === null) {
            return 'missing from evaluations';
        }

        if ($evaluation->subject_user_id !== $legacy->subject_id
            || $evaluation->author_id !== $legacy->author_id
            || $evaluation->evaluation_date?->toDateString() !== $legacy->evaluation_date?->toDateString()
            || ($evaluation->comment ?? null) !== ($legacy->comment ?? null)) {
            return 'header mismatch';
        }

        foreach ($fields as $key => $kind) {
            $expected = $this->mapValue($legacy, $key, $kind);
            $actual = $evaluation->answer($key);

            if ($expected != $actual) {
                return sprintf("answer mismatch for '%s' (expected %s, got %s)", $key, json_encode($expected), json_encode($actual));
            }
        }

        return null;
    }

    private function mapValue(Model $legacy, string $key, string $kind): mixed
    {
        $raw = $legacy->{$key};

        return match ($kind) {
            'bool' => (bool) $raw,
            'int' => $raw === null ? null : (int) $raw,
            // Legacy TIME columns read back as H:i:s; the form field is H:i.
            'time' => $raw === null ? null : substr((string) $raw, 0, 5),
            'array' => is_array($raw) && $raw !== [] ? array_values($raw) : null,
            default => $raw,
        };
    }
}
