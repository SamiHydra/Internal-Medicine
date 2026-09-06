<?php

namespace App\Http\Controllers\Api\Admin;

use App\Http\Controllers\Api\Concerns\SerializesAdminResources;
use App\Http\Controllers\Controller;
use App\Models\ActionItem;
use App\Models\ActionItemComment;
use App\Models\Department;
use App\Models\Notification;
use App\Services\Admin\AdminAuditService;
use App\Services\Reports\ActionItemDashboardService;
use App\Services\Reports\ActionItemService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

class ActionItemController extends Controller
{
    use SerializesAdminResources;

    public function __construct(
        private readonly ActionItemService $actionItems,
        private readonly ActionItemDashboardService $dashboard,
        private readonly AdminAuditService $auditService,
    ) {}

    public function index(Request $request): JsonResponse
    {
        Gate::authorize('viewAny', ActionItem::class);
        $validated = $request->validate([
            'status' => ['sometimes', Rule::in([...ActionItem::STATUSES, 'outstanding', 'all'])],
            'severity' => ['sometimes', Rule::in([...ActionItem::SEVERITIES, 'all'])],
            'department_id' => ['sometimes', 'nullable', 'string', 'max:100'],
            'overdue' => ['sometimes', 'boolean'],
            'search' => ['sometimes', 'nullable', 'string', 'max:100'],
            'page' => ['sometimes', 'integer', 'min:1'],
            'per_page' => ['sometimes', 'integer', 'min:1', 'max:100'],
            'perPage' => ['sometimes', 'integer', 'min:1', 'max:100'],
        ]);

        $status = $validated['status'] ?? 'outstanding';
        $severity = $validated['severity'] ?? 'all';
        $perPage = (int) ($validated['per_page'] ?? $validated['perPage'] ?? 50);
        $search = trim((string) ($validated['search'] ?? ''));
        $departmentId = $this->resolveDepartmentId($validated['department_id'] ?? null);

        $items = ActionItem::query()
            ->with(['department', 'assignee', 'creator', 'resolver', 'verifier', 'report:id,assignment_id,reporting_period_id'])
            ->when($status === 'outstanding', fn ($query) => $query->whereIn('status', ActionItem::OUTSTANDING_STATUSES))
            ->when($status !== 'outstanding' && $status !== 'all', fn ($query) => $query->where('status', $status))
            ->when($severity !== 'all', fn ($query) => $query->where('severity', $severity))
            ->when($departmentId !== null, fn ($query) => $query->where('department_id', $departmentId))
            ->when((bool) ($validated['overdue'] ?? false), fn ($query) => $query
                ->whereIn('status', ActionItem::OUTSTANDING_STATUSES)
                ->whereNotNull('due_at')
                ->where('due_at', '<', now()))
            ->when($search !== '', fn ($query) => $query->where(function ($searchQuery) use ($search): void {
                $like = '%'.str_replace(['%', '_'], ['\\%', '\\_'], $search).'%';
                $searchQuery->where('title', 'like', $like)->orWhere('description', 'like', $like);
            }))
            ->orderByRaw("CASE status WHEN 'open' THEN 0 WHEN 'assigned' THEN 1 WHEN 'in_progress' THEN 2 WHEN 'resolved' THEN 3 ELSE 4 END")
            ->orderByRaw('CASE WHEN due_at IS NULL THEN 1 ELSE 0 END')
            ->orderBy('due_at')
            ->latest('created_at')
            ->paginate($perPage);

        $summary = $this->dashboard->summary();

        return response()->json([
            'data' => $items->getCollection()->map(fn (ActionItem $item) => $this->serializeActionItem($item))->values(),
            'meta' => [
                'currentPage' => $items->currentPage(),
                'lastPage' => $items->lastPage(),
                'perPage' => $items->perPage(),
                'total' => $items->total(),
                'openCount' => $summary['open'],
                'summary' => $summary,
            ],
        ]);
    }

    public function show(ActionItem $actionItem): JsonResponse
    {
        Gate::authorize('view', $actionItem);
        $actionItem->load([
            'department', 'assignee', 'creator', 'resolver', 'verifier',
            'report:id,assignment_id,reporting_period_id',
            'history.actor', 'comments.author', 'evidence.uploader',
        ]);

        return response()->json($this->serializeActionItem($actionItem, true));
    }

    public function store(Request $request): JsonResponse
    {
        Gate::authorize('create', ActionItem::class);
        $validated = $request->validate([
            'title' => ['required', 'string', 'max:255'],
            'description' => ['sometimes', 'nullable', 'string', 'max:2000'],
            'severity' => ['sometimes', Rule::in(ActionItem::SEVERITIES)],
            'department_id' => ['sometimes', 'nullable', 'string', 'max:100'],
            'assigned_to' => ['sometimes', 'nullable', 'uuid', $this->activeAdminRule()],
            'due_at' => ['sometimes', 'date'],
        ]);

        $departmentId = $this->resolveDepartmentId($validated['department_id'] ?? null, requireActive: true);

        $item = DB::transaction(function () use ($request, $validated, $departmentId): ActionItem {
            $item = ActionItem::query()->create([
                'source' => 'manual',
                'title' => $validated['title'],
                'description' => $validated['description'] ?? null,
                'severity' => $validated['severity'] ?? 'medium',
                'status' => 'assigned',
                'condition_state' => 'manual',
                'department_id' => $departmentId,
                'assigned_to' => $validated['assigned_to'] ?? $request->user()->id,
                'responsible_role' => 'admin',
                'due_at' => $validated['due_at'] ?? now()->addHours(72),
                'created_by' => $request->user()->id,
            ]);
            $this->actionItems->history($item, 'opened', null, 'assigned', 'Manual follow-up created and assigned.', $request->user()->id);
            $this->notifyAssignee($item, $item->assigned_to);
            $this->auditService->record($request->user(), 'create', 'action_item', $item->id, null, $item->toArray(), $request);

            return $item;
        });

        $this->dashboard->forget();

        return response()->json($this->serializeActionItem($item->load(['department', 'assignee', 'creator'])), 201);
    }

    public function update(Request $request, ActionItem $actionItem): JsonResponse
    {
        Gate::authorize('update', $actionItem);
        $validated = $request->validate([
            'status' => ['sometimes', Rule::in(ActionItem::STATUSES)],
            'assigned_to' => ['sometimes', 'nullable', 'uuid', $this->activeAdminRule()],
            'resolution_note' => ['sometimes', 'nullable', 'string', 'max:2000'],
            'severity' => ['sometimes', Rule::in(ActionItem::SEVERITIES)],
            'due_at' => ['sometimes', 'nullable', 'date'],
        ]);

        $updated = DB::transaction(function () use ($request, $actionItem, $validated): ActionItem {
            $item = ActionItem::query()->lockForUpdate()->findOrFail($actionItem->id);
            $old = $item->toArray();
            $fromStatus = $item->status;
            $nextStatus = $validated['status'] ?? $fromStatus;

            $this->assertTransition($item, $nextStatus, $validated);

            foreach (['assigned_to', 'severity', 'resolution_note', 'due_at'] as $field) {
                if (array_key_exists($field, $validated)) {
                    $item->{$field} = $validated[$field];
                }
            }

            if (array_key_exists('due_at', $validated)) {
                $item->overdue_notified_at = null;
            }

            if ($nextStatus !== $fromStatus) {
                $item->status = $nextStatus;
                if ($nextStatus === 'resolved') {
                    $item->resolved_at = now();
                    $item->resolved_by = $request->user()->id;
                } elseif ($nextStatus === 'closed') {
                    $item->verified_at = now();
                    $item->verified_by = $request->user()->id;
                } elseif (in_array($nextStatus, ActionItem::OUTSTANDING_STATUSES, true)) {
                    // Preserve the previous resolution stamp as immutable history.
                    $item->verified_at = null;
                    $item->verified_by = null;
                }
            }

            if (! array_key_exists('status', $validated) && $item->assigned_to !== null && $item->status === 'open') {
                $item->status = 'assigned';
                $nextStatus = 'assigned';
            }

            $item->save();

            if ($nextStatus !== $fromStatus) {
                $event = match ($nextStatus) {
                    'assigned' => 'assigned',
                    'in_progress' => 'investigation_started',
                    'resolved' => 'resolved',
                    'closed' => 'verified',
                    'open' => 'reopened',
                    default => 'status_changed',
                };
                $this->actionItems->history($item, $event, $fromStatus, $nextStatus, $validated['resolution_note'] ?? null, $request->user()->id);
            } elseif (array_key_exists('assigned_to', $validated)) {
                $this->actionItems->history($item, 'assigned', $fromStatus, $item->status, 'Ownership changed.', $request->user()->id);
            }

            if (array_key_exists('assigned_to', $validated) && $validated['assigned_to']) {
                $this->notifyAssignee($item, $validated['assigned_to']);
            }

            $auditAction = $nextStatus !== $fromStatus
                ? match ($nextStatus) {
                    'resolved' => 'resolve',
                    'closed' => 'verify',
                    'open' => 'reopen',
                    'assigned' => 'assign',
                    default => 'update',
                }
            : (array_key_exists('assigned_to', $validated) ? 'assign' : 'update');
            $this->auditService->record($request->user(), $auditAction, 'action_item', $item->id, $old, $item->toArray(), $request);

            return $item;
        });

        $this->dashboard->forget();

        return response()->json($this->serializeActionItem($updated->load(['department', 'assignee', 'creator', 'resolver', 'verifier', 'report'])));
    }

    public function storeComment(Request $request, ActionItem $actionItem): JsonResponse
    {
        Gate::authorize('update', $actionItem);
        $validated = $request->validate(['body' => ['required', 'string', 'max:2000']]);

        $comment = DB::transaction(function () use ($request, $actionItem, $validated): ActionItemComment {
            $comment = ActionItemComment::query()->create([
                'action_item_id' => $actionItem->id,
                'author_id' => $request->user()->id,
                'body' => $validated['body'],
            ]);
            $this->actionItems->history($actionItem, 'commented', $actionItem->status, $actionItem->status, $validated['body'], $request->user()->id);
            $this->auditService->record($request->user(), 'comment', 'action_item', $actionItem->id, null, ['commentId' => $comment->id], $request);

            return $comment;
        });

        return response()->json($this->serializeActionItemComment($comment->load('author')), 201);
    }

    private function assertTransition(ActionItem $item, string $next, array $validated): void
    {
        $allowed = [
            'open' => ['open', 'assigned', 'in_progress', 'resolved'],
            'assigned' => ['assigned', 'open', 'in_progress', 'resolved'],
            'in_progress' => ['in_progress', 'assigned', 'resolved'],
            'resolved' => ['resolved', 'open', 'closed'],
            'closed' => ['closed', 'open'],
        ];

        if (! in_array($next, $allowed[$item->status] ?? [], true)) {
            throw ValidationException::withMessages(['status' => "The action item cannot move from {$item->status} to {$next}."]);
        }

        $assignee = $validated['assigned_to'] ?? $item->assigned_to;
        if (in_array($next, ['assigned', 'in_progress'], true) && ! $assignee) {
            throw ValidationException::withMessages(['assigned_to' => 'Assign an active administrator before starting this work.']);
        }

        $resolutionNote = trim((string) ($validated['resolution_note'] ?? $item->resolution_note ?? ''));
        if ($next === 'resolved' && $item->status !== 'resolved' && $resolutionNote === '') {
            throw ValidationException::withMessages(['resolution_note' => 'Document the investigation result before resolving this action item.']);
        }

        if ($next === 'closed' && $item->status !== 'resolved') {
            throw ValidationException::withMessages(['status' => 'Only a resolved action item can be verified and closed.']);
        }
    }

    private function activeAdminRule()
    {
        return Rule::exists('users', 'id')->where(fn ($query) => $query->where('active', true)->whereIn('role_key', ['admin', 'superadmin']));
    }

    private function resolveDepartmentId(?string $identifier, bool $requireActive = false): ?string
    {
        if ($identifier === null || trim($identifier) === '') {
            return null;
        }

        $department = Department::query()
            ->where(function ($query) use ($identifier): void {
                $query->where('id', $identifier)->orWhere('slug', $identifier);
            })
            ->when($requireActive, fn ($query) => $query->where('active', true))
            ->first();

        if (! $department) {
            throw ValidationException::withMessages([
                'department_id' => 'Choose an available department.',
            ]);
        }

        return $department->id;
    }

    private function notifyAssignee(ActionItem $item, string $userId): void
    {
        Notification::query()->create([
            'recipient_id' => $userId,
            'type' => 'action_item_assigned',
            'title' => 'Clinical action assigned to you',
            'message' => $item->title,
            'related_route' => $item->notificationRoute(),
            'related_entity' => 'action_item',
            'related_id' => $item->id,
            'created_at' => now(),
        ]);
    }
}
