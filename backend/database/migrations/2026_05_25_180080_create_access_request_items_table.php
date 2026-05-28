<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('access_request_items', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('access_request_id')->constrained('access_requests')->cascadeOnDelete();
            $table->foreignUuid('department_id')->constrained('departments')->cascadeOnDelete();
            $table->foreignUuid('template_id')->constrained('report_templates')->cascadeOnDelete();
            $table->timestamp('created_at')->useCurrent();

            $table->unique(['access_request_id', 'department_id', 'template_id'], 'access_request_items_unique');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('access_request_items');
    }
};
