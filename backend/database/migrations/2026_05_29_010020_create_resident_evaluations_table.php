<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // Evaluations OF a resident, filled by a consultant.
        Schema::create('resident_evaluations', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('author_id')->constrained('users')->restrictOnDelete();
            $table->foreignUuid('subject_id')->constrained('users')->restrictOnDelete();
            $table->foreignUuid('ward_id')->constrained('departments')->restrictOnDelete();
            $table->date('evaluation_date');

            // The ten "met expectations this round" yes/no items that form the
            // performance score, grouped by ACGME competency.
            $table->boolean('on_time')->default(false);
            $table->boolean('prepared')->default(false);
            $table->boolean('presentation_clear')->default(false);
            $table->boolean('clinical_reasoning')->default(false);
            $table->boolean('management_plan')->default(false);
            $table->boolean('documentation_timely')->default(false);
            $table->boolean('communication')->default(false);
            $table->boolean('professional')->default(false);
            $table->boolean('responsive_feedback')->default(false);
            $table->boolean('follow_through')->default(false);

            $table->unsignedTinyInteger('overall_rating')->nullable();

            // Areas-to-improve multi-select, expanded/counted in PHP.
            $table->json('concerns')->nullable();

            $table->text('comment')->nullable();
            $table->timestamps();

            $table->index(['subject_id', 'evaluation_date']);
            $table->index(['ward_id', 'evaluation_date']);
            $table->index('evaluation_date');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('resident_evaluations');
    }
};
