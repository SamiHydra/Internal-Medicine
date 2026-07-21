<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    /**
     * Preserve only the accountability fields explicitly protected by the V2
     * contract. Score denominators follow active fields dynamically.
     */
    public function up(): void
    {
        foreach ([
            'consultant_mdt' => ['senior_present', 'senior_joined_at', 'presence_minutes'],
            'resident_acgme' => ['overall_rating'],
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
