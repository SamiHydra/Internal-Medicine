<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('report_field_definitions', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('template_id')->constrained('report_templates')->cascadeOnDelete();
            $table->string('section_key', 64);
            $table->string('field_key', 64);
            $table->string('label');
            $table->enum('field_kind', ['integer', 'decimal', 'time', 'text', 'choice']);
            $table->enum('aggregate_type', ['sum', 'average', 'latest', 'none'])->default('sum');
            $table->integer('display_order');
            $table->json('metadata');
            $table->timestamps();

            $table->unique(['template_id', 'field_key']);
            $table->index(['template_id', 'display_order']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('report_field_definitions');
    }
};
