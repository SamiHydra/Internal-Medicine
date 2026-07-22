<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Which workspace a role belongs to becomes a stored property instead of a
     * hardcoded array in the SPA's Users page, where `student_rep` had been
     * left out of both lists and so was invisible to every admin.
     *
     * The default is 'both' so the earlier data migrations that insert role rows
     * without this column keep working on a fresh migrate.
     */
    public function up(): void
    {
        Schema::table('roles', function (Blueprint $table) {
            $table->string('workspace', 16)->default('both')->after('label');
        });

        foreach ([
            'superadmin' => 'both',
            'admin' => 'both',
            'nurse' => 'clinical',
            'resident' => 'academic',
            'consultant' => 'academic',
            'student_rep' => 'academic',
        ] as $roleKey => $workspace) {
            DB::table('roles')->where('role_key', $roleKey)->update(['workspace' => $workspace]);
        }
    }

    public function down(): void
    {
        Schema::table('roles', function (Blueprint $table) {
            $table->dropColumn('workspace');
        });
    }
};
