<?php

namespace Database\Seeders;

use App\Models\Role;
use Illuminate\Database\Seeder;

class RoleSeeder extends Seeder
{
    public function run(): void
    {
        $roles = [
            [
                'role_key' => 'superadmin',
                'label' => 'Superadmin',
                'description' => 'Single protected administrator who can provision and manage admin accounts',
            ],
            [
                'role_key' => 'admin',
                'label' => 'Admin 1',
                'description' => 'Full platform administration permissions',
            ],
            [
                'role_key' => 'doctor_admin',
                'label' => 'Dr. Mesay',
                'description' => 'Clinical director with full platform permissions',
            ],
            [
                'role_key' => 'nurse',
                'label' => 'Nurse',
                'description' => 'Weekly reporting and approved assignment access',
            ],
        ];

        foreach ($roles as $role) {
            Role::query()->updateOrCreate(
                ['role_key' => $role['role_key']],
                $role,
            );
        }
    }
}
