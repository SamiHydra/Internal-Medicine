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
     * 0 === 0 — authorizing ANY user onto ANY other user's private channel.
     */
    public static function authorize(User $user, int|string $id): bool
    {
        return (string) $user->id === (string) $id;
    }
}
