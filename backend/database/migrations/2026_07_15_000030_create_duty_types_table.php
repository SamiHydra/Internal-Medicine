<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // The admin-editable catalog of everything a person can be assigned to:
        // ward service months, section duties, on-call days, OPD, external
        // rotations, and leave. Evaluation pairing and the morning roster are
        // both driven by flags here rather than by code.
        Schema::create('duty_types', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->string('slug', 64)->unique();
            $table->string('name');
            $table->foreignUuid('section_id')->nullable()->constrained('sections')->restrictOnDelete();
            $table->foreignUuid('ward_id')->nullable()->constrained('wards')->restrictOnDelete();
            $table->enum('category', ['ward_service', 'clinical_duty', 'on_call', 'external', 'leave']);
            $table->enum('granularity', ['monthly', 'daily']);
            $table->boolean('pairs_for_evaluation')->default(false);
            // The pairing key when the duty has no ward (e.g. 'opd', 'transplant').
            $table->string('pairing_group', 32)->nullable();
            $table->boolean('counts_for_morning_roster')->default(true);
            $table->boolean('active')->default(true);
            $table->timestamps();

            $table->index('section_id');
            $table->index('ward_id');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('duty_types');
    }
};
