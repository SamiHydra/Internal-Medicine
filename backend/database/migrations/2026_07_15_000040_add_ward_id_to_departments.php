<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // Maps each inpatient reporting unit to its physical teaching ward so
        // the academic and clinical pillars share one vocabulary. Outpatient
        // and procedure departments stay null. Nothing in the clinical pillar
        // reads this column.
        Schema::table('departments', function (Blueprint $table) {
            $table->foreignUuid('ward_id')->nullable()->constrained('wards')->nullOnDelete();
        });
    }

    public function down(): void
    {
        Schema::table('departments', function (Blueprint $table) {
            $table->dropConstrainedForeignId('ward_id');
        });
    }
};
