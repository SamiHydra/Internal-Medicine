<?php

use App\Models\User;
use App\Support\Broadcasting\UserChannel;
use Illuminate\Support\Facades\Broadcast;

// User ids are UUIDs (User uses HasUuids). Authorization compares them as
// strings via UserChannel::authorize - an int cast of a non-numeric UUID
// collapses to 0, which would make 0 === 0 authorize ANY user onto another
// user's private channel. See tests/Feature/ChannelAuthorizationTest.php.
Broadcast::channel('App.Models.User.{id}', function (User $user, string $id): bool {
    return UserChannel::authorize($user, $id);
});
