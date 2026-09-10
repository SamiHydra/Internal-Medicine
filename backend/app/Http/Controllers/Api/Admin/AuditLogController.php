<?php

namespace App\Http\Controllers\Api\Admin;

use App\Http\Controllers\Api\Concerns\SerializesAdminResources;
use App\Http\Controllers\Controller;
use App\Models\AdminAuditLog;
use App\Models\AuditLog;
use App\Models\Department;
use App\Support\Audit\AuditRegistry;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Gate;

class AuditLogController extends Controller
{
    use SerializesAdminResources;

    public function cellEdits(Request $request): JsonResponse
    {
        Gate::authorize('viewAny', AuditLog::class);

        $validated = $request->validate([
            'report_id' => ['sometimes', 'uuid'],
            'department_id' => ['sometimes', 'string', 'max:80'],
            'changed_by' => ['sometimes', 'uuid'],
            'date_from' => ['sometimes', 'date_format:Y-m-d'],
            'date_to' => ['sometimes', 'date_format:Y-m-d'],
            'page' => ['sometimes', 'integer', 'min:1'],
            'perPage' => ['sometimes', 'integer', 'min:1', 'max:100'],
        ]);
        $query = AuditLog::query()
            ->with(['fieldDefinition', 'changedBy', 'department', 'template'])
            ->latest('changed_at');

        if (isset($validated['report_id'])) {
            $query->where('report_id', $validated['report_id']);
        }

        if (isset($validated['department_id'])) {
            $department = Department::query()
                ->where(fn (Builder $builder) => $builder->where('id', $validated['department_id'])->orWhere('slug', $validated['department_id']))
                ->firstOrFail();
            $query->where('department_id', $department->id);
        }

        if (isset($validated['changed_by'])) {
            $query->where('changed_by', $validated['changed_by']);
        }

        if (isset($validated['date_from'])) {
            $query->where('changed_at', '>=', Carbon::parse($validated['date_from'])->startOfDay());
        }

        if (isset($validated['date_to'])) {
            $query->where('changed_at', '<', Carbon::parse($validated['date_to'])->addDay()->startOfDay());
        }

        $logs = $query->paginate((int) ($validated['perPage'] ?? 100));

        return response()->json([
            'data' => $logs->getCollection()
                ->map(fn (AuditLog $auditLog) => $this->serializeAuditLog($auditLog))
                ->values(),
            'meta' => [
                'currentPage' => $logs->currentPage(),
                'lastPage' => $logs->lastPage(),
                'perPage' => $logs->perPage(),
                'total' => $logs->total(),
            ],
        ]);
    }

    public function adminActions(Request $request): JsonResponse
    {
        Gate::authorize('viewAny', AdminAuditLog::class);

        $validated = $request->validate([
            'user_id' => ['sometimes', 'uuid'],
            'entity_type' => ['sometimes', 'string', 'max:64'],
            // Not `uuid`: some rows key on a period ("2026-07") or a user id.
            'entity_id' => ['sometimes', 'string', 'max:64'],
            'action' => ['sometimes', 'string', 'max:64'],
            'workspace' => ['sometimes', 'string', 'in:clinical,academic'],
            'search' => ['sometimes', 'string', 'max:120'],
            'date_from' => ['sometimes', 'date_format:Y-m-d'],
            'date_to' => ['sometimes', 'date_format:Y-m-d'],
            'limit' => ['sometimes', 'integer', 'min:1', 'max:500'],
        ]);
        $query = AdminAuditLog::query()->latest('created_at');

        foreach (['user_id', 'entity_type', 'entity_id', 'action'] as $field) {
            if (isset($validated[$field])) {
                $query->where($field, $validated[$field]);
            }
        }

        // Workspace is derived from entity_type through the registry rather
        // than stored, so historic rows scope correctly too. Subtractive:
        // an unregistered entity type stays visible instead of vanishing.
        if (isset($validated['workspace'])) {
            $query->whereNotIn('entity_type', AuditRegistry::entityTypesExcludedFrom($validated['workspace']));
        }

        if (isset($validated['search'])) {
            $term = '%'.$validated['search'].'%';
            $query->where(function (Builder $builder) use ($term): void {
                $builder->where('user_name', 'like', $term)
                    ->orWhere('entity_type', 'like', $term)
                    ->orWhere('action', 'like', $term);
            });
        }

        if (isset($validated['date_from'])) {
            $query->where('created_at', '>=', Carbon::parse($validated['date_from'])->startOfDay());
        }

        if (isset($validated['date_to'])) {
            $query->where('created_at', '<', Carbon::parse($validated['date_to'])->addDay()->startOfDay());
        }

        return response()->json([
            'data' => $query
                ->limit($validated['limit'] ?? 200)
                ->get()
                ->map(fn (AdminAuditLog $auditLog) => $this->serializeAdminAuditLog($auditLog)),
            // The filter control is built from what the workspace can actually
            // contain, so it never offers a dead option.
            'meta' => [
                'entityTypes' => AuditRegistry::filterOptionsFor(
                    $validated['workspace'] ?? AuditRegistry::WORKSPACE_ACADEMIC,
                ),
                'actors' => $this->auditActors($validated['workspace'] ?? null),
            ],
        ]);
    }

    /**
     * Distinct actors that appear in the trail, for the "who" filter. Read off
     * the audit rows themselves rather than the user table so it lists only
     * people who actually did something in this workspace.
     *
     * @return list<array{id: string, name: string}>
     */
    private function auditActors(?string $workspace): array
    {
        $query = AdminAuditLog::query()
            ->select('user_id', 'user_name')
            ->distinct();

        if ($workspace !== null) {
            $query->whereNotIn('entity_type', AuditRegistry::entityTypesExcludedFrom($workspace));
        }

        return $query->get()
            ->filter(fn (AdminAuditLog $row) => $row->user_name !== null)
            ->unique('user_id')
            ->sortBy('user_name')
            ->values()
            ->map(fn (AdminAuditLog $row) => [
                'id' => $row->user_id,
                'name' => $row->user_name,
            ])
            ->all();
    }
}
