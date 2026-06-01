<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('users', function (Blueprint $table) {
            // Optional roster/pre-fill ward for residents & consultants. NOT an
            // analytics source of truth — evaluation.ward_id is (rotation-proof).
            $table->foreignUuid('home_ward_id')->nullable()->constrained('departments')->nullOnDelete();
        });
    }

    public function down(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->dropConstrainedForeignId('home_ward_id');
        });
    }
};
