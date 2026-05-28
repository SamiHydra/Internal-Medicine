<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('report_field_values', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('report_id')->constrained('reports')->cascadeOnDelete();
            $table->foreignUuid('field_definition_id')->constrained('report_field_definitions')->cascadeOnDelete();
            $table->enum('day_name', ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']);
            $table->decimal('value_number', 14, 4)->nullable();
            $table->text('value_text')->nullable();
            $table->time('value_time')->nullable();
            $table->json('value_json')->nullable();
            $table->timestamps();

            $table->unique(['report_id', 'field_definition_id', 'day_name'], 'report_field_values_unique');
            $table->index(['report_id', 'field_definition_id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('report_field_values');
    }
};
