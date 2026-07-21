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
                'workspace' => 'both',
                'description' => 'Protected maintenance owner, created only via the server/database. Approves and manages admin accounts.',
            ],
            [
                'role_key' => 'admin',
                'label' => 'Admin',
                'workspace' => 'both',
                'description' => 'Administrative doctor with full platform administration permissions',
            ],
            [
                'role_key' => 'nurse',
                'label' => 'Nurse',
                'workspace' => 'clinical',
                'description' => 'Weekly reporting and approved assignment access',
            ],
            [
                'role_key' => 'resident',
                'label' => 'Resident',
                'workspace' => 'academic',
                'description' => 'Submits MDT round evaluations of consultants and is evaluated by consultants',
            ],
            [
                'role_key' => 'consultant',
                'label' => 'Consultant',
                'workspace' => 'academic',
                'description' => 'Submits performance evaluations of residents and is evaluated by residents',
            ],
            [
                'role_key' => 'student_rep',
                'label' => 'Student representative',
                'workspace' => 'academic',
                'description' => 'Records whether scheduled teaching activities were held. No access to any evaluation, assessment, or score.',
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
