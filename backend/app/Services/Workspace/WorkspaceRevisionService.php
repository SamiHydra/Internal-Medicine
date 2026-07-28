<?php

namespace App\Services\Workspace;

use App\Models\User;
use App\Support\Authorization\Permissions;
use Illuminate\Database\Query\Builder;
use Illuminate\Support\Facades\DB;

class WorkspaceRevisionService
{
    /**
     * Return an opaque token representing every collection included in the
     * workspace bootstrap. All component aggregates are evaluated by one UNION
     * query, so an idle browser can check freshness without rebuilding or
     * transferring the full workspace payload.
     */
    public function for(User $user): string
    {
        $isAdmin = Permissions::isAdminRole($user->role_key);

        $reports = DB::table('reports')
            ->when(! $isAdmin, fn (Builder $query) => $query
                ->join('report_assignments', 'report_assignments.id', '=', 'reports.assignment_id')
                ->where('report_assignments.nurse_id', $user->id)
                ->where('report_assignments.active', true));

        $assignments = DB::table('report_assignments')
            ->when(! $isAdmin, fn (Builder $query) => $query
                ->where('nurse_id', $user->id)
                ->where('active', true));

        $parts = [
            $this->part($reports, 'reports', 'reports.updated_at'),
            $this->part($assignments, 'assignments'),
            $this->part(DB::table('reporting_periods'), 'reporting_periods', 'created_at'),
            $this->part(
                DB::table('notifications')->where('recipient_id', $user->id),
                'notifications',
                'created_at',
            ),
            $this->part(DB::table('report_templates'), 'report_templates'),
            $this->part(DB::table('report_field_definitions'), 'report_fields'),
            $this->part(DB::table('app_settings'), 'settings'),
            $this->part(DB::table('users')->where('id', $user->id), 'current_user'),
        ];

        if ($isAdmin || in_array($user->role_key, ['resident', 'consultant'], true)) {
            foreach ([
                'duty_assignments',
                'rotation_calendars',
                'rotation_blocks',
                'transfer_requests',
                'rep_assignments',
                'teaching_activity_schedules',
                'teaching_sessions',
                'student_attendance',
                'morning_sessions',
                'morning_attendance',
                'morning_roster_overrides',
            ] as $table) {
                $parts[] = $this->part(DB::table($table), "academic:{$table}");
            }
        }

        /** @var Builder $union */
        $union = array_shift($parts);
        foreach ($parts as $part) {
            $union->unionAll($part);
        }

        $components = DB::query()
            ->fromSub($union, 'workspace_revision_parts')
            ->orderBy('component')
            ->get()
            ->map(fn ($row) => [
                'component' => $row->component,
                'changedAt' => $row->changed_at,
                'records' => (int) $row->records,
            ])
            ->all();

        return hash('sha256', json_encode($components, JSON_THROW_ON_ERROR));
    }

    private function part(
        Builder $query,
        string $component,
        string $changedAtColumn = 'updated_at',
    ): Builder {
        return $query->selectRaw(
            '? as component, MAX('.$changedAtColumn.') as changed_at, COUNT(*) as records',
            [$component],
        );
    }
}
