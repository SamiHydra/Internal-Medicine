<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('admin_access_requests', function (Blueprint $table) {
            // Academic enrollment captures a home ward at signup; it has to
            // survive on the pending request until an approver creates the user.
            $table->foreignUuid('home_ward_id')->nullable()->constrained('departments')->nullOnDelete();
        });
    }

    public function down(): void
    {
        Schema::table('admin_access_requests', function (Blueprint $table) {
            $table->dropConstrainedForeignId('home_ward_id');
        });
    }
};
