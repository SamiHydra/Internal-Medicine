<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Notification;
use App\Models\Report;
use App\Models\ReportComment;
use App\Models\User;
use App\Services\Admin\AdminAuditService;
use App\Support\Authorization\Permissions;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;
use Illuminate\Validation\ValidationException;

class ReportCommentController extends Controller
{
    public function __construct(
        private readonly AdminAuditService $auditService,
    ) {}

    public function index(Request $request, Report $report): JsonResponse
    {
        Gate::authorize('view', $report);

        $comments = ReportComment::query()
            ->with('author')
            ->where('report_id', $report->id)
            ->orderBy('created_at')
            ->get();

        return response()->json([
            'data' => $comments->map(fn (ReportComment $comment) => $this->serialize($comment))->values(),
        ]);
    }

    public function store(Request $request, Report $report): JsonResponse
    {
        Gate::authorize('view', $report);

        $validated = $request->validate([
            'body' => ['required', 'string', 'max:2000'],
            'parent_id' => ['sometimes', 'nullable', 'uuid'],
            'parentId' => ['sometimes', 'nullable', 'uuid'],
        ]);

        $parentId = $validated['parent_id'] ?? $validated['parentId'] ?? null;

        if ($parentId !== null) {
            $parentExists = ReportComment::query()
                ->where('id', $parentId)
                ->where('report_id', $report->id)
                ->exists();

            if (! $parentExists) {
                throw ValidationException::withMessages([
                    'parent_id' => 'The parent comment must belong to this report.',
                ]);
            }
        }

        $author = $request->user();
        $comment = DB::transaction(function () use ($request, $report, $author, $parentId, $validated): ReportComment {
            $comment = ReportComment::query()->create([
                'report_id' => $report->id,
                'author_id' => $author->id,
                'parent_id' => $parentId,
                'body' => trim($validated['body']),
            ]);

            // A comment is the written explanation behind a submitted number,
            // so its arrival is part of the report's trail, whoever wrote it.
            $this->auditService->record($author, 'comment', 'report_comment', $comment->id, null, $this->auditValues($comment), $request);

            return $comment;
        });

        $this->notifyParticipants($report, $author);

        return response()->json($this->serialize($comment->load('author')), 201);
    }

    public function destroy(Request $request, Report $report, ReportComment $comment): JsonResponse
    {
        Gate::authorize('view', $report);

        $user = $request->user();
        $isAuthor = $comment->author_id === $user->id;
        $isAdmin = Permissions::isAdminRole($user->role_key);

        if ($comment->report_id !== $report->id || (! $isAuthor && ! $isAdmin)) {
            abort(403, 'You cannot delete this comment.');
        }

        // The row is hard-deleted, so the audit entry is the only place the
        // removed text survives. Same transaction: no delete without its trail.
        DB::transaction(function () use ($request, $user, $comment): void {
            $this->auditService->record($user, 'delete', 'report_comment', $comment->id, $this->auditValues($comment), null, $request);
            $comment->delete();
        });

        return response()->json(['deleted' => true]);
    }

    private function notifyParticipants(Report $report, User $author): void
    {
        $report->loadMissing(['assignment', 'department']);
        $departmentName = $report->department?->name ?? 'A report';
        $route = sprintf('/reports/%s/%s', $report->assignment_id, $report->reporting_period_id);

        // Admin commented -> ping the owning nurse. Nurse commented -> ping admins.
        $recipientIds = Permissions::isAdminRole($author->role_key)
            ? collect([$report->assignment?->nurse_id])->filter()->values()
            : User::query()
                ->whereIn('role_key', ['superadmin', 'admin'])
                ->where('active', true)
                ->pluck('id');

        // Also notify everyone who has already participated in the thread (the
        // parent author and any prior commenter) so a reply never silently skips
        // a participant who falls outside the role bucket above.
        $priorParticipantIds = ReportComment::query()
            ->where('report_id', $report->id)
            ->pluck('author_id');

        $recipientIds = $recipientIds
            ->merge($priorParticipantIds)
            ->filter(fn (?string $id): bool => $id !== null && $id !== $author->id)
            ->unique()
            ->values();

        if ($recipientIds->isEmpty()) {
            return;
        }

        $model = new Notification;
        $rows = $recipientIds->map(fn (string $recipientId): array => [
            'id' => $model->newUniqueId(),
            'recipient_id' => $recipientId,
            'type' => 'report_comment',
            'title' => 'New report comment',
            'message' => sprintf('%s commented on %s.', $author->full_name, $departmentName),
            'related_route' => $route,
            'related_entity' => 'report_comment',
            'related_id' => $report->id,
            'read_at' => null,
            'created_at' => now(),
        ])->all();

        Notification::query()->insert($rows);
    }

    /**
     * @return array<string, mixed>
     */
    private function auditValues(ReportComment $comment): array
    {
        return [
            'reportId' => $comment->report_id,
            'authorId' => $comment->author_id,
            'parentId' => $comment->parent_id,
            'body' => $comment->body,
        ];
    }

    /**
     * @return array<string, mixed>
     */
    private function serialize(ReportComment $comment): array
    {
        return [
            'id' => $comment->id,
            'reportId' => $comment->report_id,
            'parentId' => $comment->parent_id,
            'authorId' => $comment->author_id,
            'authorName' => $comment->author?->full_name ?? 'Unknown user',
            'authorRole' => $comment->author?->role_key,
            'body' => $comment->body,
            'createdAt' => $comment->created_at?->toJSON(),
            'updatedAt' => $comment->updated_at?->toJSON(),
        ];
    }
}
