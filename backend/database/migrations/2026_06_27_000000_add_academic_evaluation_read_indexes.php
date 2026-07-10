<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('consultant_evaluations', function (Blueprint $table): void {
            $table->index(
                ['author_id', 'evaluation_date'],
                'consultant_evaluations_author_date_index',
            );
            $table->index('created_at', 'consultant_evaluations_created_at_index');
        });

        Schema::table('resident_evaluations', function (Blueprint $table): void {
            $table->index(
                ['author_id', 'evaluation_date'],
                'resident_evaluations_author_date_index',
            );
            $table->index('created_at', 'resident_evaluations_created_at_index');
        });
    }

    public function down(): void
    {
        Schema::table('consultant_evaluations', function (Blueprint $table): void {
            $table->dropIndex('consultant_evaluations_author_date_index');
            $table->dropIndex('consultant_evaluations_created_at_index');
        });

        Schema::table('resident_evaluations', function (Blueprint $table): void {
            $table->dropIndex('resident_evaluations_author_date_index');
            $table->dropIndex('resident_evaluations_created_at_index');
        });
    }
};
