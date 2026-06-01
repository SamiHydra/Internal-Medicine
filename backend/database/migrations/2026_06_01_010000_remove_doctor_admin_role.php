<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    /**
     * Remove the unused `doctor_admin` ("Clinical Director") role. The product
     * uses exactly five roles: superadmin (Maintenance), admin, nurse, consultant,
     * resident. Any account that somehow holds doctor_admin is reassigned to admin
     * before the role row is deleted so the users.role_key foreign key stays valid.
     */
    public function up(): void
    {
        DB::table('users')->where('role_key', 'doctor_admin')->update(['role_key' => 'admin']);
        DB::table('roles')->where('role_key', 'doctor_admin')->delete();
    }

    public function down(): void
    {
        DB::table('roles')->updateOrInsert(
            ['role_key' => 'doctor_admin'],
            [
                'label' => 'Clinical Director',
                'description' => 'Clinical director with full platform permissions',
                'updated_at' => now(),
                'created_at' => now(),
            ],
        );
    }
};
