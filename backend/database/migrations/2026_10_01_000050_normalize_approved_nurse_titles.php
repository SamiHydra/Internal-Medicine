<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    public function up(): void
    {
        DB::table('users')
            ->where('role_key', 'nurse')
            ->where('active', true)
            ->where('title', 'Applicant Nurse')
            ->update(['title' => 'Nurse']);
    }

    public function down(): void
    {
        // "Applicant Nurse" represented pre-approval state, so restoring it on
        // active accounts would reintroduce the invalid title.
    }
};
