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

    public function down(): void
    {
        foreach ([
            'consultant_mdt' => EvaluationScoring::CONSULTANT_SCORE_ITEMS,
            'resident_acgme' => EvaluationScoring::RESIDENT_SCORE_ITEMS,
        ] as $formKey => $keys) {
            DB::table('evaluation_form_fields')
                ->whereIn('form_id', DB::table('evaluation_forms')->where('key', $formKey)->pluck('id'))
                ->whereIn('key', $keys)
                ->update(['is_core' => true, 'active' => true, 'updated_at' => now()]);
        }
    }
};
