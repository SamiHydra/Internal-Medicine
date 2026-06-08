<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('action_items', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('report_id')->nullable()->constrained('reports')->nullOnDelete();
            $table->foreignUuid('department_id')->nullable()->constrained('departments')->nullOnDelete();
            // "critical_event" (auto, from a fired alert) or "manual".
            $table->string('source', 32)->default('critical_event');
            // Dedup key — for critical events this is the report id, so re-submitting
            // a report with the same critical values does not spawn duplicates.
            $table->string('source_key', 191)->nullable();
            $table->string('title');
            $table->text('description')->nullable();
            $table->string('severity', 16)->default('high');
            $table->string('status', 24)->default('open');
            $table->foreignUuid('assigned_to')->nullable()->constrained('users')->nullOnDelete();
            $table->foreignUuid('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->foreignUuid('resolved_by')->nullable()->constrained('users')->nullOnDelete();
            $table->text('resolution_note')->nullable();
            $table->timestamp('resolved_at')->nullable();
            $table->timestamps();

            $table->index(['status', 'created_at']);
            $table->index('report_id');
            // One auto action item per (source, source_key). NULL source_key (manual
            // items) is exempt: MySQL/MariaDB/SQLite allow multiple NULLs in a unique
            // index, so manual items never collide.
            $table->unique(['source', 'source_key']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('action_items');
    }
};
