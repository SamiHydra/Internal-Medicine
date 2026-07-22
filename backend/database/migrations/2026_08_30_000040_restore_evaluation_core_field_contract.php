<?php

use App\Support\Academic\EvaluationScoring;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    public function up(): void
    {
        DB::table('evaluation_form_fields')
            ->whereIn('form_id', DB::table('evaluation_forms')->whereIn('key', ['consultant_mdt', 'resident_acgme'])->pluck('id'))
            ->update(['is_core' => false, 'updated_at' => now()]);

        foreach ([
            'consultant_mdt' => ['senior_present', 'senior_joined_at', 'presence_minutes'],
            'resident_acgme' => ['overall_rating'],
        ] as $formKey => $keys) {
            DB::table('evaluation_form_fields')
                ->whereIn('form_id', DB::table('evaluation_forms')->where('key', $formKey)->pluck('id'))
                ->whereIn('key', $keys)
                ->update(['is_core' => true, 'active' => true, 'updated_at' => now()]);
        }
    }

    /**
     * Restores the pre-migration is_core set and NOTHING else. `active` is
     * deliberately untouched: score denominators follow the active fields
     * dynamically (EvaluationScoring::activeItems), so force-setting it here
     * silently re-enabled items an admin had retired and changed the
     * denominator of every computed score with no audit trail. Core status
     * only restricts editing, which is what a rollback is entitled to move.
     *
     * The four accountability fields are cleared first, mirroring up(), so
     * the result is a state the earlier migration actually produced rather
     * than the union of both.
     */
    public function down(): void
    {
        foreach ([
            'consultant_mdt' => ['senior_present', 'senior_joined_at', 'presence_minutes'],
            'resident_acgme' => ['overall_rating'],
        ] as $formKey => $keys) {
            DB::table('evaluation_form_fields')
                ->whereIn('form_id', DB::table('evaluation_forms')->where('key', $formKey)->pluck('id'))
                ->whereIn('key', $keys)
                ->update(['is_core' => false, 'updated_at' => now()]);
        }

        foreach ([
            'consultant_mdt' => EvaluationScoring::CONSULTANT_SCORE_ITEMS,
            'resident_acgme' => EvaluationScoring::RESIDENT_SCORE_ITEMS,
        ] as $formKey => $keys) {
            DB::table('evaluation_form_fields')
                ->whereIn('form_id', DB::table('evaluation_forms')->where('key', $formKey)->pluck('id'))
                ->whereIn('key', $keys)
                ->update(['is_core' => true, 'updated_at' => now()]);
        }
    }
};
