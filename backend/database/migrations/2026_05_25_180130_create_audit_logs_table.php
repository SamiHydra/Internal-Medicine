<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('audit_logs', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('report_id')->constrained('reports')->cascadeOnDelete();
            $table->foreignUuid('field_definition_id')->nullable()->constrained('report_field_definitions')->nullOnDelete();
            $table->string('field_key', 64);
            $table->string('day_name', 16)->nullable();
            $table->text('old_value')->nullable();
            $table->text('new_value')->nullable();
            $table->foreignUuid('changed_by')->constrained('users');
            $table->string('changed_by_name')->nullable();
            $table->timestamp('changed_at')->useCurrent();
            $table->foreignUuid('department_id')->constrained('departments');
            $table->foreignUuid('template_id')->constrained('report_templates');

            $table->index(['report_id', 'changed_at']);
            $table->index(['department_id', 'changed_at']);
            $table->index(['template_id', 'changed_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('audit_logs');
    }
};
