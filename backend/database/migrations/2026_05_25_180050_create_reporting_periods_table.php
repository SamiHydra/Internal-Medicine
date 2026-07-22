<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('reporting_periods', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->date('week_start')->unique();
            $table->date('week_end');
            $table->timestamp('deadline_at');
            $table->string('month_label', 16);
            $table->string('quarter_label', 8);
            $table->smallInteger('year_num');
            $table->timestamp('created_at')->useCurrent();

            $table->index(['year_num', 'month_label']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('reporting_periods');
    }
};
