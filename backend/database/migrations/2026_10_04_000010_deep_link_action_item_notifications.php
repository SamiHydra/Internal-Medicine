<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Assignment and overdue notifications used to point at the bare action queue,
 * so the recipient landed on a list of every open action with no indication
 * which one the notification meant. They now carry the ?item= deep link like
 * the critical-value alerts always did; repoint the ones already sent.
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::table('notifications')
            ->whereIn('type', ['action_item_assigned', 'action_item_overdue'])
            ->where('related_entity', 'action_item')
            ->whereNotNull('related_id')
            ->where('related_route', '/admin/action-items')
            ->orderBy('id')
            ->chunkById(500, function ($notifications): void {
                foreach ($notifications as $notification) {
                    DB::table('notifications')
                        ->where('id', $notification->id)
                        ->update(['related_route' => '/admin/action-items?item='.$notification->related_id]);
                }
            });
    }

    public function down(): void
    {
        DB::table('notifications')
            ->whereIn('type', ['action_item_assigned', 'action_item_overdue'])
            ->where('related_entity', 'action_item')
            ->where('related_route', 'like', '/admin/action-items?item=%')
            ->update(['related_route' => '/admin/action-items']);
    }
};
