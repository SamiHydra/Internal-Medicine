<?php

namespace App\Services\Workspace;

use App\Models\User;
use Illuminate\Support\Facades\DB;

class WorkspaceRevisionService
{
    /**
     * Return the opaque token backed by the transactionally maintained ledger.
     * Database triggers update the singleton in the same transaction as every
     * relevant domain write, including bulk/query-builder paths that do not
     * emit Eloquent model events.
     */
    public function for(User $user): string
    {
        // Keep the user argument so the controller contract remains unchanged.
        // A global revision may cause an occasional extra refresh for a user
        // who cannot see a write, but it can never miss a visible change.
        return $this->current();
    }

    public function current(): string
    {
        $version = (int) (DB::table('workspace_revisions')
            ->where('id', 1)
            ->value('version') ?? 0);

        return hash('sha256', (string) $version);
    }
}
