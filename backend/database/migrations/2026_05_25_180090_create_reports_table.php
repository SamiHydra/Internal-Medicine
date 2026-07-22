<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('reports', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('assignment_id')->constrained('report_assignments')->cascadeOnDelete();
            $table->foreignUuid('department_id')->constrained('departments')->cascadeOnDelete();
            $table->foreignUuid('template_id')->constrained('report_templates')->cascadeOnDelete();
            $table->foreignUuid('reporting_period_id')->constrained('reporting_periods')->cascadeOnDelete();
            $table->enum('status', ['not_started', 'draft', 'submitted', 'edited_after_submission', 'locked', 'overdue'])->default('draft');
            $table->timestamp('submitted_at')->nullable();
            $table->timestamp('locked_at')->nullable();
            $table->foreignUuid('created_by')->constrained('users');
            $table->foreignUuid('updated_by')->constrained('users');
            $table->timestamps();

            $table->unique(['assignment_id', 'reporting_period_id']);
            $table->index(['reporting_period_id', 'template_id']);
            $table->index(['status', 'locked_at', 'submitted_at']);
            $table->index(['department_id', 'reporting_period_id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('reports');
    }
};
