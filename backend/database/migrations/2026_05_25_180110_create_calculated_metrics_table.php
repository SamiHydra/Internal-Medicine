<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('calculated_metrics', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('report_id')->unique()->constrained('reports')->cascadeOnDelete();
            $table->decimal('bor_percent', 7, 3)->nullable();
            $table->decimal('btr', 7, 3)->nullable();
            $table->decimal('alos', 7, 3)->nullable();
            $table->json('metric_payload');
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('calculated_metrics');
    }
};
