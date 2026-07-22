<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('report_status_history', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('report_id')->constrained('reports')->cascadeOnDelete();
            $table->enum('status', ['not_started', 'draft', 'submitted', 'edited_after_submission', 'locked', 'overdue']);
            $table->foreignUuid('changed_by')->constrained('users');
            $table->string('changed_by_name')->nullable();
            $table->text('note')->nullable();
            $table->timestamp('changed_at')->useCurrent();

            $table->index(['report_id', 'changed_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('report_status_history');
    }
};
