<?php

namespace App\Support\Broadcasting;

use App\Models\User;

final class UserChannel
{
    /**
     * Authorize a user onto their own private channel (App.Models.User.{id}).
     *
     * User ids are UUIDs (User uses HasUuids). They MUST be compared as strings:
     * casting a non-numeric UUID to int yields 0, so an (int) comparison would be
     * 0 === 0 - authorizing ANY user onto ANY other user's private channel.
     *
     * Identity alone is not enough. Gate::before does not run for
     * Broadcast::channel callbacks, and the broadcasting/auth route carries
     * neither the 'active' nor the 'password-changed' middleware, so the two
     * session gates every API route applies have to be re-asserted here.
     * Deactivating an account does not flush its session, so without this a
     * revoked user would keep a live subscription to their own channel.
     */
    public static function authorize(User $user, int|string $id): bool
    {
        if (! $user->active || $user->password_change_required) {
            return false;
        }

        return (string) $user->id === (string) $id;
    }
}
