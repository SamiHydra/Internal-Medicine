<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Morning sessions (V2 Phase 6): one department-wide session on the
     * configured days, punctuality measured against the configured 08:00
     * start. Attendance is a SNAPSHOT of the roster at recording time, so a
     * later roster change never rewrites history. Include/exclude overrides
     * adjust the auto-generated roster per person and date range.
     */
    public function up(): void
    {
        Schema::create('morning_sessions', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->date('session_date')->unique();
            // Snapshot of the configured start at open time: a later setting
            // change never re-scores past sessions.
            $table->time('scheduled_start_at');
            $table->time('actual_start_at')->nullable();
            $table->boolean('started_on_time')->nullable();
            $table->enum('status', ['pending', 'recorded', 'cancelled'])->default('pending');
            $table->text('reason')->nullable();
            $table->foreignUuid('recorded_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamp('recorded_at')->nullable();
            $table->timestamps();

            $table->index(['status', 'session_date']);
        });

        Schema::create('morning_attendance', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('morning_session_id')->constrained('morning_sessions')->cascadeOnDelete();
            $table->foreignUuid('user_id')->constrained('users')->restrictOnDelete();
            $table->boolean('present')->default(false);
            $table->timestamps();

            $table->unique(['morning_session_id', 'user_id']);
            $table->index('user_id');
        });

        Schema::create('morning_roster_overrides', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('user_id')->constrained('users')->restrictOnDelete();
            $table->enum('action', ['include', 'exclude']);
            $table->date('starts_on');
            $table->date('ends_on')->nullable();
            $table->foreignUuid('created_by')->constrained('users')->restrictOnDelete();
            $table->timestamps();

            $table->index(['user_id', 'starts_on']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('morning_roster_overrides');
        Schema::dropIfExists('morning_attendance');
        Schema::dropIfExists('morning_sessions');
    }
};
