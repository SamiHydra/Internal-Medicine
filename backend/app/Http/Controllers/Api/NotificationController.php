<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Notification;
use App\Support\Authorization\Permissions;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Gate;

class NotificationController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        Gate::authorize('viewAny', Notification::class);

        $validated = $request->validate([
            'recipient_id' => ['sometimes', 'uuid'],
            'type' => ['sometimes', 'string', 'max:64'],
            'unread' => ['sometimes', 'boolean'],
            'limit' => ['sometimes', 'integer', 'min:1', 'max:200'],
        ]);
        $user = $request->user();
        $recipientId = Permissions::isAdminRole($user->role_key)
            ? ($validated['recipient_id'] ?? $user->id)
            : $user->id;
        $query = Notification::query()
            ->where('recipient_id', $recipientId)
            ->latest('created_at');

        if (isset($validated['type'])) {
            $query->where('type', $validated['type']);
        }

        if (array_key_exists('unread', $validated)) {
            $validated['unread']
                ? $query->whereNull('read_at')
                : $query->whereNotNull('read_at');
        }

        return response()->json([
            'data' => $query
                ->limit($validated['limit'] ?? 100)
                ->get()
                ->map(fn (Notification $notification) => $this->serializeNotification($notification)),
        ]);
    }

    public function markRead(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'ids' => ['required', 'array', 'min:1'],
            'ids.*' => ['uuid'],
        ]);
        $notifications = $this->visibleNotificationQuery($request)
            ->whereIn('id', $validated['ids'])
            ->get();

        $notifications->each(function (Notification $notification): void {
            Gate::authorize('update', $notification);
            $notification->forceFill(['read_at' => $notification->read_at ?? now()])->save();
        });

        return response()->json([
            'updated' => $notifications->count(),
            'data' => $notifications->map(fn (Notification $notification) => $this->serializeNotification($notification->refresh()))->values(),
        ]);
    }

    public function markAllRead(Request $request): JsonResponse
    {
        Gate::authorize('viewAny', Notification::class);

        $updated = $this->visibleNotificationQuery($request)
            ->whereNull('read_at')
            ->update(['read_at' => now()]);

        return response()->json(['updated' => $updated]);
    }

    public function destroy(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'ids' => ['required', 'array', 'min:1'],
            'ids.*' => ['uuid'],
        ]);
        $notifications = $this->visibleNotificationQuery($request)
            ->whereIn('id', $validated['ids'])
            ->get();

        $notifications->each(function (Notification $notification): void {
            Gate::authorize('delete', $notification);
            $notification->delete();
        });

        return response()->json(['deleted' => $notifications->count()]);
    }

    public function restore(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'notifications' => ['required', 'array', 'min:1', 'max:50'],
            'notifications.*.id' => ['required', 'uuid'],
            'notifications.*.userId' => ['required', 'uuid'],
            'notifications.*.type' => ['required', 'string', 'max:64'],
            'notifications.*.title' => ['required', 'string', 'max:255'],
            'notifications.*.message' => ['required', 'string'],
            'notifications.*.createdAt' => ['nullable', 'date'],
            'notifications.*.readAt' => ['nullable', 'date'],
            'notifications.*.relatedRoute' => ['nullable', 'string', 'max:255'],
            'notifications.*.relatedReportId' => ['nullable', 'uuid'],
        ]);
        $user = $request->user();
        $isAdmin = Permissions::isAdminRole($user->role_key);
        $restored = collect($validated['notifications'])
            ->filter(fn (array $notification) => $isAdmin || $notification['userId'] === $user->id)
            ->map(function (array $notification) use ($user, $isAdmin): ?Notification {
                // Non-admins can only ever restore notifications onto their own
                // account; admins may target the supplied recipient.
                $recipientId = $isAdmin ? $notification['userId'] : $user->id;

                // Guard against IDOR: updateOrCreate keyed only on `id` would let a
                // caller overwrite (hijack/clobber) another user's existing
                // notification by guessing its UUID. Refuse when the row already
                // exists under a different recipient.
                $existing = Notification::query()->find($notification['id']);
                if ($existing && $existing->recipient_id !== $recipientId) {
                    return null;
                }

                return Notification::query()->updateOrCreate(
                    ['id' => $notification['id']],
                    [
                        'recipient_id' => $recipientId,
                        'type' => $notification['type'],
                        'title' => $notification['title'],
                        'message' => $notification['message'],
                        'created_at' => $notification['createdAt'] ?? now(),
                        'read_at' => $notification['readAt'] ?? null,
                        'related_route' => $notification['relatedRoute'] ?? '/',
                        'related_id' => $notification['relatedReportId'] ?? null,
                    ],
                );
            })
            ->filter()
            ->values();

        return response()->json([
            'restored' => $restored->count(),
            'data' => $restored->map(fn (Notification $notification) => $this->serializeNotification($notification))->values(),
        ]);
    }

    private function visibleNotificationQuery(Request $request): Builder
    {
        $user = $request->user();

        if (Permissions::isAdminRole($user->role_key) && $request->filled('recipient_id')) {
            return Notification::query()->where('recipient_id', $request->string('recipient_id')->toString());
        }

        return Notification::query()->where('recipient_id', $user->id);
    }

    /**
     * @return array<string, mixed>
     */
    private function serializeNotification(Notification $notification): array
    {
        return [
            'id' => $notification->id,
            'userId' => $notification->recipient_id,
            'type' => $notification->type,
            'title' => $notification->title,
            'message' => $notification->message,
            'createdAt' => $notification->created_at?->toJSON(),
            'readAt' => $notification->read_at?->toJSON(),
            'relatedRoute' => $notification->related_route ?? '/',
            'relatedEntity' => $notification->related_entity,
            'relatedReportId' => $notification->related_id,
        ];
    }
}
