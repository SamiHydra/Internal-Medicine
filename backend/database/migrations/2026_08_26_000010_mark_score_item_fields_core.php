<?php

use App\Support\Academic\EvaluationScoring;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    /**
     * Fix-up for databases seeded before the score items were core: the
     * EvaluationScoring inputs must never be deactivatable through a content
     * edit, or every future score would silently cap below 100. Fresh
     * installs get is_core=true straight from the seed migration.
     */
    public function up(): void
    {
        foreach ([
            'consultant_mdt' => EvaluationScoring::CONSULTANT_SCORE_ITEMS,
            'resident_acgme' => EvaluationScoring::RESIDENT_SCORE_ITEMS,
        ] as $formKey => $items) {
            DB::table('evaluation_form_fields')
                ->whereIn('form_id', DB::table('evaluation_forms')->where('key', $formKey)->pluck('id'))
                ->whereIn('key', $items)
                ->update(['is_core' => true, 'active' => true, 'updated_at' => now()]);
        }
    }

    public function down(): void
    {
        // Leaving the flags in place is safe; core status only restricts edits.
    }
};
