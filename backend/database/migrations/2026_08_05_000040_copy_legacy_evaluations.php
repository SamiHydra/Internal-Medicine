<?php

use App\Services\Academic\EvaluationMigrationService;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    /**
     * Data migration: copy the legacy evaluation rows into the unified tables
     * (V2 Phase 4 step 4). The same service backs academic:verify-migration,
     * so the copy that runs here is exactly the copy that gets verified. The
     * legacy tables become read-only; they are dropped in a later release
     * after the department confirms.
     */
    public function up(): void
    {
        app(EvaluationMigrationService::class)->copy();
    }

    public function down(): void
    {
        DB::table('evaluation_answers')->delete();
        DB::table('evaluations')->delete();
    }
};
