<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('departments', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->string('slug', 64)->unique();
            $table->enum('family', ['inpatient', 'outpatient', 'procedure']);
            $table->foreignUuid('template_id')->constrained('report_templates');
            $table->string('name');
            $table->text('description');
            $table->string('accent_color', 16)->nullable();
            $table->integer('bed_count')->nullable();
            $table->boolean('active')->default(true);
            $table->timestamps();

            $table->index('family');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('departments');
    }
};
