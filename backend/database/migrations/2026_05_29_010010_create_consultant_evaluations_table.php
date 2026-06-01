<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // Evaluations OF a consultant, filled by a resident (the IM daily MDT round form).
        Schema::create('consultant_evaluations', function (Blueprint $table) {
            $table->uuid('id')->primary();
            // author/subject/ward reference users & departments that are deactivated,
            // never hard-deleted, so RESTRICT preserves the historical record.
            $table->foreignUuid('author_id')->constrained('users')->restrictOnDelete();
            $table->foreignUuid('subject_id')->constrained('users')->restrictOnDelete();
            $table->foreignUuid('ward_id')->constrained('departments')->restrictOnDelete();
            $table->date('evaluation_date');

            $table->boolean('senior_present')->default(false);
            $table->time('senior_joined_at')->nullable();
            $table->integer('presence_minutes')->nullable();

            // The six round-quality yes/no items that form the quality score.
            $table->boolean('all_patients_reviewed')->default(false);
            $table->boolean('mgmt_plan_documented')->default(false);
            $table->boolean('vte_assessed')->default(false);
            $table->boolean('discharge_discussed')->default(false);
            $table->boolean('med_review_done')->default(false);
            $table->boolean('critical_labs_reviewed')->default(false);

            $table->unsignedTinyInteger('pct_patients_seen')->nullable();
            $table->boolean('round_delayed')->default(false);

            // Multi-select answers expanded/counted in PHP by the analytics service.
            $table->json('mdt_participants')->nullable();
            $table->json('system_issues')->nullable();

            $table->text('comment')->nullable();
            $table->timestamps();

            $table->index(['subject_id', 'evaluation_date']);
            $table->index(['ward_id', 'evaluation_date']);
            $table->index('evaluation_date');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('consultant_evaluations');
    }
};
