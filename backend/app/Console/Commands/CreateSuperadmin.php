<?php

namespace App\Console\Commands;

use App\Models\User;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Validator;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;

class CreateSuperadmin extends Command
{
    protected $signature = 'app:create-superadmin
        {--email= : Login email}
        {--username= : Login username (3-64 chars: letters, numbers, . _ -)}
        {--full-name= : Display name}
        {--title=Super Administrator : Job title}
        {--password= : Password (min 8 chars; a strong one is generated if omitted)}';

    protected $description = 'Create the initial superadmin so a fresh database can be logged into.';

    public function handle(): int
    {
        if (User::query()->where('role_key', 'superadmin')->exists()) {
            $existing = User::query()->where('role_key', 'superadmin')->value('username');
            $this->error("A superadmin already exists (username: {$existing}). Use the admin UI or reset its password instead.");

            return self::FAILURE;
        }

        $email = strtolower(trim((string) ($this->option('email') ?: $this->ask('Email'))));
        $username = strtolower(trim((string) ($this->option('username') ?: $this->ask('Username'))));
        $fullName = trim((string) ($this->option('full-name') ?: $this->ask('Full name')));
        $title = trim((string) $this->option('title'));

        $generated = false;
        $password = (string) $this->option('password');
        if ($password === '') {
            $password = Str::password(16);
            $generated = true;
        }

        $validator = Validator::make(
            compact('email', 'username', 'fullName', 'password'),
            [
                'email' => ['required', 'email', 'max:255', Rule::unique('users', 'email')],
                'username' => ['required', 'string', 'min:3', 'max:64', 'regex:/^[a-z0-9._-]+$/'],
                'fullName' => ['required', 'string', 'max:255'],
                'password' => ['required', 'string', 'min:8'],
            ],
        );
        $validator->addRules(['username' => [Rule::unique('users', 'username')]]);

        if ($validator->fails()) {
            foreach ($validator->errors()->all() as $message) {
                $this->error($message);
            }

            return self::FAILURE;
        }

        $user = User::create([
            'email' => $email,
            'username' => $username,
            'full_name' => $fullName,
            'title' => $title !== '' ? $title : 'Super Administrator',
            'role_key' => 'superadmin',
            'password' => $password,
            'active' => true,
            // Force a reset on first login only when we invented the password.
            'password_change_required' => $generated,
        ]);
        $user->forceFill(['email_verified_at' => now()])->save();

        $this->info("Superadmin created: {$user->email} (username: {$user->username})");
        if ($generated) {
            $this->warn("Generated password: {$password}");
            $this->warn('Store it now - it will not be shown again. You will be asked to change it on first login.');
        }

        return self::SUCCESS;
    }
}
