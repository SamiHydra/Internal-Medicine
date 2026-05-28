<?php

namespace App\Http\Controllers\Api\Admin;

use App\Http\Controllers\Api\Concerns\SerializesAdminResources;
use App\Http\Controllers\Controller;
use App\Models\AdminAuditLog;
use App\Models\AuditLog;
use App\Models\Department;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
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
            'limit' => ['sometimes', 'integer', 'min:1', 'max:500'],
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
            $query->whereDate('changed_at', '>=', $validated['date_from']);
        }

        if (isset($validated['date_to'])) {
            $query->whereDate('changed_at', '<=', $validated['date_to']);
        }

        return response()->json([
            'data' => $query
                ->limit($validated['limit'] ?? 200)
                ->get()
                ->map(fn (AuditLog $auditLog) => $this->serializeAuditLog($auditLog)),
        ]);
    }

    public function adminActions(Request $request): JsonResponse
    {
        Gate::authorize('viewAny', AdminAuditLog::class);

        $validated = $request->validate([
            'user_id' => ['sometimes', 'uuid'],
            'entity_type' => ['sometimes', 'string', 'max:64'],
            'entity_id' => ['sometimes', 'uuid'],
            'action' => ['sometimes', 'string', 'max:64'],
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

        if (isset($validated['date_from'])) {
            $query->whereDate('created_at', '>=', $validated['date_from']);
        }

        if (isset($validated['date_to'])) {
            $query->whereDate('created_at', '<=', $validated['date_to']);
        }

        return response()->json([
            'data' => $query
                ->limit($validated['limit'] ?? 200)
                ->get()
                ->map(fn (AdminAuditLog $auditLog) => $this->serializeAdminAuditLog($auditLog)),
        ]);
    }
}
