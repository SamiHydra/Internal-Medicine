<?php

namespace App\Http\Controllers\Api\Admin;

use App\Http\Controllers\Controller;
use App\Models\ActionItem;
use App\Models\ActionItemEvidence;
use App\Services\Admin\AdminAuditService;
use App\Services\Reports\ActionItemService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Symfony\Component\HttpFoundation\StreamedResponse;

class ActionItemEvidenceController extends Controller
{
    public function __construct(
        private readonly ActionItemService $actionItems,
        private readonly AdminAuditService $auditService,
    ) {}

    public function store(Request $request, ActionItem $actionItem): JsonResponse
    {
        Gate::authorize('update', $actionItem);
        $validated = $request->validate([
            'file' => ['required', 'file', 'max:10240', 'mimes:pdf,jpg,jpeg,png,doc,docx,xls,xlsx,csv,txt'],
        ]);
        $file = $validated['file'];
        $extension = strtolower($file->extension() ?: 'bin');
        $path = sprintf('action-items/%s/%s.%s', $actionItem->id, Str::uuid(), $extension);
        Storage::disk('local')->putFileAs(dirname($path), $file, basename($path));

        try {
            $evidence = DB::transaction(function () use ($request, $actionItem, $file, $path): ActionItemEvidence {
                $evidence = ActionItemEvidence::query()->create([
                    'action_item_id' => $actionItem->id,
                    'uploaded_by' => $request->user()->id,
                    'original_name' => $this->safeOriginalName($file->getClientOriginalName()),
                    'disk' => 'local',
                    'file_path' => $path,
                    'mime_type' => (string) $file->getMimeType(),
                    'size_bytes' => $file->getSize(),
                    'created_at' => now(),
                ]);
                $this->actionItems->history($actionItem, 'evidence_uploaded', $actionItem->status, $actionItem->status, $evidence->original_name, $request->user()->id);
                $this->auditService->record($request->user(), 'upload_evidence', 'action_item', $actionItem->id, null, ['evidenceId' => $evidence->id, 'name' => $evidence->original_name], $request);

                return $evidence;
            });
        } catch (\Throwable $error) {
            Storage::disk('local')->delete($path);
            throw $error;
        }

        return response()->json([
            'id' => $evidence->id,
            'originalName' => $evidence->original_name,
            'mimeType' => $evidence->mime_type,
            'sizeBytes' => $evidence->size_bytes,
            'uploadedByName' => $request->user()->full_name,
            'createdAt' => $evidence->created_at?->toJSON(),
            'downloadUrl' => "/api/admin/action-items/{$actionItem->id}/evidence/{$evidence->id}/download",
        ], 201);
    }

    public function download(ActionItem $actionItem, ActionItemEvidence $evidence): StreamedResponse
    {
        Gate::authorize('view', $actionItem);
        abort_unless($evidence->action_item_id === $actionItem->id, 404);
        abort_unless(Storage::disk($evidence->disk)->exists($evidence->file_path), 404);

        return Storage::disk($evidence->disk)->download($evidence->file_path, $evidence->original_name, [
            'Content-Type' => $evidence->mime_type,
            'X-Content-Type-Options' => 'nosniff',
        ]);
    }

    public function destroy(Request $request, ActionItem $actionItem, ActionItemEvidence $evidence): JsonResponse
    {
        Gate::authorize('update', $actionItem);
        abort_unless($evidence->action_item_id === $actionItem->id, 404);

        DB::transaction(function () use ($request, $actionItem, $evidence): void {
            $this->auditService->record($request->user(), 'delete', 'action_item', $actionItem->id, ['evidenceId' => $evidence->id, 'name' => $evidence->original_name], null, $request);
            $evidence->delete();
        });
        Storage::disk($evidence->disk)->delete($evidence->file_path);

        return response()->json([], 204);
    }

    private function safeOriginalName(string $name): string
    {
        $basename = basename(str_replace('\\', '/', $name));
        $sanitized = preg_replace('/[^A-Za-z0-9._ -]/u', '_', $basename) ?: 'evidence';

        return Str::limit($sanitized, 200, '');
    }
}
