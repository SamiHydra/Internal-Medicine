<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * The unified evaluation response header + EAV answers (V2 Phase 4),
     * replacing consultant_evaluations and resident_evaluations (kept
     * read-only for one release). Service-level invariants: exactly one of
     * subject_user_id / subject_student_id is set; exactly one of author_id /
     * external_evaluator_name is set.
     */
    public function up(): void
    {
        Schema::create('evaluations', function (Blueprint $table) {
            $table->uuid('id')->primary();
            // Pins the exact form VERSION the answers were given on.
            $table->foreignUuid('form_id')->constrained('evaluation_forms')->restrictOnDelete();
            $table->string('form_key', 64);
            $table->foreignUuid('author_id')->nullable()->constrained('users')->restrictOnDelete();
            $table->foreignUuid('subject_user_id')->nullable()->constrained('users')->restrictOnDelete();
            // FK to `students` arrives with the Phase 5 undergraduate module;
            // the column exists now so Phase 4 needs no follow-up migration.
            $table->uuid('subject_student_id')->nullable();
            $table->date('evaluation_date');
            // Snapshots, written once at creation and never re-derived.
            $table->foreignUuid('ward_id')->nullable()->constrained('wards')->nullOnDelete();
            $table->string('placement_type', 32)->nullable();
            $table->date('week_starts_on')->nullable();
            $table->string('external_evaluator_name')->nullable();
            $table->string('external_evaluator_department')->nullable();
            $table->foreignUuid('entered_by_id')->nullable()->constrained('users')->nullOnDelete();
            $table->text('comment')->nullable();
            $table->timestamps();

            $table->index(['subject_user_id', 'evaluation_date']);
            $table->index(['subject_student_id', 'evaluation_date']);
            $table->index(['ward_id', 'evaluation_date']);
            $table->index(['form_key', 'evaluation_date']);
            $table->index('evaluation_date');
            $table->index(['author_id', 'evaluation_date']);
        });

        Schema::create('evaluation_answers', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('evaluation_id')->constrained('evaluations')->cascadeOnDelete();
            $table->string('field_key', 64);
            $table->json('value')->nullable();
            $table->timestamps();

            $table->unique(['evaluation_id', 'field_key']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('evaluation_answers');
        Schema::dropIfExists('evaluations');
    }
};
