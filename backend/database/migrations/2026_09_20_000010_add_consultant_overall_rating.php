<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * Give the consultant_mdt form the same 1-to-5 "Overall rating" the
 * resident_acgme form already carries, so both peer forms capture a single
 * overall score. Recorded only: it is NOT a score item (EvaluationScoring
 * counts the yes/no indicators), so the computed quality/performance % is
 * unchanged for either direction. The rating instead feeds the combined
 * leaderboard rank (normalised 1-5 -> % and blended with the indicator score).
 *
 * MANDATORY and CORE, matching resident_acgme:
 *  - required so every new consultant evaluation captures a rating - the
 *    ranking blends it with equal weight and must not run on missing halves;
 *  - core so an admin can never retire or deactivate it out from under the
 *    ranking. It joins the pinned contract set for consultant_mdt
 *    (senior_present, senior_joined_at, presence_minutes, overall_rating).
 *
 * Legacy consultant submissions that predate the field simply carry no rating
 * row; validation only gates NEW submissions, and the analytics layer degrades
 * to score-only for any person whose evaluations have no ratings yet.
 *
 * Idempotent: keyed on the published form's (form_id, key), so a re-run or an
 * environment that already added the field is a no-op. The resident copy is
 * only re-activated, never re-created, since it is a seeded core field.
 */
return new class extends Migration
{
    public function up(): void
    {
        $now = now();

        // consultant_mdt: add the rating if absent, or re-activate it if an
        // admin had retired it. Placed just before the free-text comment.
        $this->ensureField('consultant_mdt', [
            'section' => 'Overall',
            'label' => 'Overall rating',
            'help_text' => '1 to 5',
            'required' => true,
            'sort_order' => 135,
            'is_core' => true,
        ], $now);

        // resident_acgme already ships this field as a seeded core field; only
        // guarantee it is active so both forms present it.
        $this->ensureField('resident_acgme', [
            'section' => 'Overall',
            'label' => 'Overall rating',
            'help_text' => '1 to 5',
            'required' => true,
            'sort_order' => 115,
            'is_core' => true,
        ], $now);
    }

    /**
     * Ensure the currently-published $formKey form has an active
     * overall_rating (1-to-5) field. Inserts it with $defaults when missing,
     * otherwise just flips it active without disturbing an admin's wording.
     *
     * @param  array{section: string, label: string, help_text: string, required: bool, sort_order: int, is_core: bool}  $defaults
     */
    private function ensureField(string $formKey, array $defaults, mixed $now): void
    {
        $formId = DB::table('evaluation_forms')
            ->where('key', $formKey)
            ->where('status', 'published')
            ->value('id');

        if ($formId === null) {
            return;
        }

        $existing = DB::table('evaluation_form_fields')
            ->where('form_id', $formId)
            ->where('key', 'overall_rating')
            ->first();

        if ($existing !== null) {
            // Converge an already-present field to the mandatory contract:
            // re-activate it and pin required/core without disturbing an
            // admin's wording. Skip the write when nothing would change.
            if (! $existing->active
                || (bool) $existing->required !== $defaults['required']
                || (bool) $existing->is_core !== $defaults['is_core']) {
                DB::table('evaluation_form_fields')
                    ->where('id', $existing->id)
                    ->update([
                        'active' => true,
                        'required' => $defaults['required'],
                        'is_core' => $defaults['is_core'],
                        'updated_at' => $now,
                    ]);
            }

            return;
        }

        DB::table('evaluation_form_fields')->insert([
            'id' => (string) Str::uuid(),
            'form_id' => $formId,
            'section' => $defaults['section'],
            'key' => 'overall_rating',
            'label' => $defaults['label'],
            'help_text' => $defaults['help_text'],
            'type' => 'rating',
            'options' => json_encode(['min' => 1, 'max' => 5]),
            'required' => $defaults['required'],
            'sort_order' => $defaults['sort_order'],
            'active' => true,
            'is_core' => $defaults['is_core'],
            'created_at' => $now,
            'updated_at' => $now,
        ]);
    }

    /**
     * Only unwind what this migration created: the consultant field. The
     * resident field predates it (seeded core) and must survive a rollback.
     */
    public function down(): void
    {
        $formId = DB::table('evaluation_forms')
            ->where('key', 'consultant_mdt')
            ->where('status', 'published')
            ->value('id');

        if ($formId === null) {
            return;
        }

        DB::table('evaluation_form_fields')
            ->where('form_id', $formId)
            ->where('key', 'overall_rating')
            ->delete();
    }
};
