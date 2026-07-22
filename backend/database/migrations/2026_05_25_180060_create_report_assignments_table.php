<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('report_assignments', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('nurse_id')->constrained('users')->cascadeOnDelete();
            $table->foreignUuid('department_id')->constrained('departments')->cascadeOnDelete();
            $table->foreignUuid('template_id')->constrained('report_templates')->cascadeOnDelete();
            $table->boolean('active')->default(true);
            $table->timestamp('approved_at')->useCurrent();
            $table->foreignUuid('approved_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();

            $table->unique(['nurse_id', 'department_id', 'template_id']);
            $table->index(['nurse_id', 'active']);
            $table->index('department_id');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('report_assignments');
    }
};
