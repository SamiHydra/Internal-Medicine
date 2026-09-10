<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    public function up(): void
    {
        $emails = [];
        $usernames = [];

        foreach (DB::table('users')->select(['id', 'email', 'username'])->orderBy('id')->cursor() as $user) {
            $email = strtolower(trim((string) $user->email));
            $username = $user->username === null ? null : strtolower(trim((string) $user->username));

            if (isset($emails[$email]) && $emails[$email] !== $user->id) {
                throw new RuntimeException("Cannot normalize duplicate user email '{$email}'.");
            }
            $emails[$email] = $user->id;

            if ($username !== null && $username !== '') {
                if (isset($usernames[$username]) && $usernames[$username] !== $user->id) {
                    throw new RuntimeException("Cannot normalize duplicate username '{$username}'.");
                }
                $usernames[$username] = $user->id;
            }
        }

        // One-time canonicalization lets authentication use ordinary indexed
        // equality rather than lower(column), including for pre-existing rows.
        DB::table('users')->update([
            'email' => DB::raw('lower(trim(email))'),
            'username' => DB::raw('case when username is null then null else lower(trim(username)) end'),
        ]);
    }

    public function down(): void
    {
        // Canonicalization is lossless for identifier semantics but original
        // letter casing cannot be reconstructed.
    }
};
