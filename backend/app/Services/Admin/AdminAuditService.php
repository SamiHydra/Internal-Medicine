<?php

namespace App\Services\Admin;

use App\Models\AdminAuditLog;
use App\Models\User;
use Illuminate\Http\Request;

class AdminAuditService
{
    /**
     * $entityId is an OPAQUE handle of at most 64 characters, not a uuid. Most
     * callers pass a model id, but the duty roster keys its rows on a period
     * ("2026-07") and the admin trail filters on the raw string either way.
     * Keep the column and this contract in step: it is stored as a plain
     * string precisely so a non-uuid handle stays legal.
     *
     * @param  array<string, mixed>|null  $oldValues
     * @param  array<string, mixed>|null  $newValues
     */
    public function record(
        User $actor,
        string $action,
        string $entityType,
        ?string $entityId = null,
        ?array $oldValues = null,
        ?array $newValues = null,
        ?Request $request = null,
    ): AdminAuditLog {
        return AdminAuditLog::query()->create([
            'user_id' => $actor->id,
            'user_name' => $actor->full_name,
            'action' => $action,
            'entity_type' => $entityType,
            'entity_id' => $entityId,
            'old_values' => $oldValues,
            'new_values' => $newValues,
            'ip_address' => $request?->ip(),
            'user_agent' => $request?->userAgent(),
            'created_at' => now(),
        ]);
    }
}
