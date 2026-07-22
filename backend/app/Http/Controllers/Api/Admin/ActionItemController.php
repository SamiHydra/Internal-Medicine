<?php

namespace App\Http\Controllers\Api\Admin;

use App\Http\Controllers\Api\Concerns\SerializesAdminResources;
use App\Http\Controllers\Controller;
use App\Models\ActionItem;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

class ActionItemController extends Controller
{
    use SerializesAdminResources;

    public function index(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'status' => ['sometimes', Rule::in([...ActionItem::STATUSES, 'all'])],
            'per_page' => ['sometimes', 'integer', 'min:1', 'max:100'],
            'perPage' => ['sometimes', 'integer', 'min:1', 'max:100'],
        ]);

        $status = $validated['status'] ?? 'open';
        $perPage = (int) ($validated['per_page'] ?? $validated['perPage'] ?? 50);

        $items = ActionItem::query()
            ->with(['department', 'assignee', 'creator', 'resolver'])
            ->when($status !== 'all', fn ($query) => $query->where('status', $status))
            // Open work first, then most-recent.
            ->orderByRaw("CASE status WHEN 'open' THEN 0 WHEN 'in_progress' THEN 1 ELSE 2 END")
            ->latest('created_at')
            ->paginate($perPage);

        return response()->json([
            'data' => $items->getCollection()
                ->map(fn (ActionItem $item) => $this->serializeActionItem($item))
                ->values(),
            'meta' => [
                'currentPage' => $items->currentPage(),
                'lastPage' => $items->lastPage(),
                'perPage' => $items->perPage(),
                'total' => $items->total(),
                'openCount' => ActionItem::query()->where('status', 'open')->count(),
            ],
        ]);
    }

    public function store(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'title' => ['required', 'string', 'max:255'],
            'description' => ['sometimes', 'nullable', 'string', 'max:2000'],
            'severity' => ['sometimes', Rule::in(ActionItem::SEVERITIES)],
            'department_id' => ['sometimes', 'nullable', 'uuid', 'exists:departments,id'],
            'assigned_to' => ['sometimes', 'nullable', 'uuid', 'exists:users,id'],
        ]);

        $item = ActionItem::query()->create([
            'source' => 'manual',
            'title' => $validated['title'],
            'description' => $validated['description'] ?? null,
            'severity' => $validated['severity'] ?? 'medium',
            'status' => 'open',
            'department_id' => $validated['department_id'] ?? null,
            'assigned_to' => $validated['assigned_to'] ?? null,
            'created_by' => $request->user()->id,
        ]);

        return response()->json($this->serializeActionItem($item), 201);
    }

    public function update(Request $request, ActionItem $actionItem): JsonResponse
    {
        $validated = $request->validate([
            'status' => ['sometimes', Rule::in(ActionItem::STATUSES)],
            'assigned_to' => ['sometimes', 'nullable', 'uuid', 'exists:users,id'],
            'resolution_note' => ['sometimes', 'nullable', 'string', 'max:2000'],
            'severity' => ['sometimes', Rule::in(ActionItem::SEVERITIES)],
        ]);

        if (array_key_exists('assigned_to', $validated)) {
            $actionItem->assigned_to = $validated['assigned_to'];
        }

        if (array_key_exists('severity', $validated)) {
            $actionItem->severity = $validated['severity'];
        }

        if (array_key_exists('resolution_note', $validated)) {
            $actionItem->resolution_note = $validated['resolution_note'];
        }

        if (isset($validated['status']) && $validated['status'] !== $actionItem->status) {
            $actionItem->status = $validated['status'];

            if ($validated['status'] === 'resolved') {
                $actionItem->resolved_at = now();
                $actionItem->resolved_by = $request->user()->id;
            } else {
                // Re-opening clears the resolution stamp.
                $actionItem->resolved_at = null;
                $actionItem->resolved_by = null;
            }
        }

        $actionItem->save();

        return response()->json($this->serializeActionItem($actionItem->refresh()));
    }
}
