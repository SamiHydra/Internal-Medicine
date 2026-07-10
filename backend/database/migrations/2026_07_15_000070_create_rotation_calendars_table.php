<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // The per-year, per-training-year rotation calendar. Admin-configured
        // because the national intake date moves every academic year.
        Schema::create('rotation_calendars', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->unsignedTinyInteger('training_year');
            $table->string('academic_year_label', 32);
            $table->date('starts_on');
            $table->enum('block_kind', ['calendar_month', 'fixed_weeks']);
            $table->unsignedTinyInteger('block_length_weeks')->nullable();
            $table->unsignedTinyInteger('blocks_count');
            $table->boolean('active')->default(true);
            $table->timestamps();

            $table->unique(['training_year', 'academic_year_label']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('rotation_calendars');
    }
};
