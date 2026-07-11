<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * The undergraduate module (V2 Phase 5): batches, students, weekly
     * subgroup placements, rep assignments, the weekly activity schedule,
     * generated teaching sessions, and per-student attendance.
     */
    public function up(): void
    {
        Schema::create('student_batches', function (Blueprint $table) {
            $table->uuid('id')->primary();
            // C1 = Year 3 (twelve weeks), C2 = Year 4 (eight weeks). Two C1
            // batches may overlap, so no uniqueness beyond the label.
            $table->enum('cohort', ['C1', 'C2']);
            $table->string('label', 64)->unique();
            $table->date('starts_on');
            $table->date('ends_on');
            $table->boolean('active')->default(true);
            $table->timestamps();
        });

        Schema::create('students', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('batch_id')->constrained('student_batches')->restrictOnDelete();
            $table->string('full_name');
            $table->string('external_id', 64)->nullable();
            $table->enum('subgroup', ['A', 'B'])->nullable();
            $table->boolean('active')->default(true);
            $table->timestamps();

            $table->index(['batch_id', 'subgroup']);
        });

        Schema::create('subgroup_placements', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('batch_id')->constrained('student_batches')->cascadeOnDelete();
            $table->enum('subgroup', ['A', 'B']);
            $table->foreignUuid('ward_id')->constrained('wards')->restrictOnDelete();
            $table->date('week_starts_on');
            $table->date('week_ends_on');
            $table->foreignUuid('created_by')->constrained('users')->restrictOnDelete();
            $table->timestamps();

            $table->unique(['batch_id', 'subgroup', 'week_starts_on']);
        });

        Schema::create('rep_assignments', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('user_id')->constrained('users')->restrictOnDelete();
            $table->foreignUuid('batch_id')->constrained('student_batches')->cascadeOnDelete();
            // group = records lectures and seminars for the whole cohort;
            // subgroup_a/b = records bedside and teaching rounds for one subgroup.
            $table->enum('scope', ['group', 'subgroup_a', 'subgroup_b']);
            $table->boolean('active')->default(true);
            $table->timestamps();

            $table->index(['user_id', 'active']);
            $table->index('batch_id');
        });

        Schema::create('teaching_activity_schedules', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->enum('cohort', ['C1', 'C2']);
            $table->enum('activity_type', ['lecture', 'seminar', 'bedside', 'teaching_round']);
            // ISO weekday: 1 = Monday.
            $table->unsignedTinyInteger('weekday');
            $table->enum('scope', ['cohort', 'subgroup']);
            $table->boolean('active')->default(true);
            $table->timestamps();

            $table->unique(['cohort', 'activity_type', 'weekday']);
        });

        Schema::create('teaching_sessions', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('batch_id')->constrained('student_batches')->cascadeOnDelete();
            $table->enum('subgroup', ['A', 'B'])->nullable();
            $table->enum('activity_type', ['lecture', 'seminar', 'bedside', 'teaching_round']);
            $table->date('scheduled_date');
            // Snapshot from the subgroup placement of that week; null when no
            // placement exists (the session still appears, flagged for admins).
            $table->foreignUuid('ward_id')->nullable()->constrained('wards')->nullOnDelete();
            $table->enum('status', ['pending', 'held', 'not_held', 'cancelled'])->default('pending');
            // Required whenever status is not_held or cancelled.
            $table->text('reason')->nullable();
            $table->foreignUuid('recorded_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamp('recorded_at')->nullable();
            $table->timestamps();

            $table->unique(['batch_id', 'subgroup', 'activity_type', 'scheduled_date']);
            $table->index(['scheduled_date', 'status']);
        });

        Schema::create('student_attendance', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('teaching_session_id')->constrained('teaching_sessions')->cascadeOnDelete();
            $table->foreignUuid('student_id')->constrained('students')->restrictOnDelete();
            $table->boolean('present')->default(false);
            $table->foreignUuid('recorded_by')->constrained('users')->restrictOnDelete();
            $table->timestamps();

            $table->unique(['teaching_session_id', 'student_id']);
        });

        // The Phase 4 evaluations table shipped subject_student_id without its
        // FK; the students table exists now.
        Schema::table('evaluations', function (Blueprint $table) {
            $table->foreign('subject_student_id')->references('id')->on('students')->restrictOnDelete();
        });
    }

    public function down(): void
    {
        Schema::table('evaluations', function (Blueprint $table) {
            $table->dropForeign(['subject_student_id']);
        });
        Schema::dropIfExists('student_attendance');
        Schema::dropIfExists('teaching_sessions');
        Schema::dropIfExists('teaching_activity_schedules');
        Schema::dropIfExists('rep_assignments');
        Schema::dropIfExists('subgroup_placements');
        Schema::dropIfExists('students');
        Schema::dropIfExists('student_batches');
    }
};
