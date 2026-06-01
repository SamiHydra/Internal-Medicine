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
                'label' => 'Maintenance',
                'description' => 'Protected maintenance owner, created only via the server/database. Approves and manages admin accounts.',
            ],
            [
                'role_key' => 'admin',
                'label' => 'Admin',
                'description' => 'Administrative doctor with full platform administration permissions',
            ],
            [
                'role_key' => 'nurse',
                'label' => 'Nurse',
                'description' => 'Weekly reporting and approved assignment access',
            ],
            [
                'role_key' => 'resident',
                'label' => 'Resident',
                'description' => 'Submits MDT round evaluations of consultants and is evaluated by consultants',
            ],
            [
                'role_key' => 'consultant',
                'label' => 'Consultant',
                'description' => 'Submits performance evaluations of residents and is evaluated by residents',
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
