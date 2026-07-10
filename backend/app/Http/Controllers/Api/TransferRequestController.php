<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Section;
use App\Models\TransferRequest;
use App\Services\Academic\TransferService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Gate;
use Illuminate\Validation\Rule;

/**
 * The consultant-facing side of section transfers: file a request, list own
 * requests, cancel a pending one, and fetch the section options for the form.
 */
class TransferRequestController extends Controller
{
    public function __construct(
        private readonly TransferService $transferService,
    ) {}

    public function formOptions(Request $request): JsonResponse
    {
        Gate::authorize('create', TransferRequest::class);

        $user = $request->user();

        return response()->json([
            'currentSectionId' => $user->section_id,
            'currentSectionName' => $user->section?->name,
            'sections' => Section::query()
                ->where('active', true)
                ->when($user->section_id !== null, fn ($query) => $query->where('id', '!=', $user->section_id))
                ->orderBy('name')
                ->get()
                ->map(fn (Section $section) => [
                    'id' => $section->id,
                    'name' => $section->name,
                ])
                ->values(),
        ]);
    }

    public function store(Request $request): JsonResponse
    {
        Gate::authorize('create', TransferRequest::class);

        $validated = $request->validate([
            'toSectionId' => ['required', 'string', Rule::exists('sections', 'id')],
            'reason' => ['sometimes', 'nullable', 'string', 'max:1000'],
        ]);

        $transfer = $this->transferService->request(
            $request->user(),
            Section::query()->findOrFail($validated['toSectionId']),
            $validated['reason'] ?? null,
        );

        return response()->json($this->serialize($transfer), 201);
    }

    public function mine(Request $request): JsonResponse
    {
        return response()->json([
            'data' => TransferRequest::query()
                ->with(['fromSection', 'toSection', 'decidedBy'])
                ->where('user_id', $request->user()->id)
                ->latest('created_at')
                ->limit(20)
                ->get()
                ->map(fn (TransferRequest $transfer) => $this->serialize($transfer)),
        ]);
    }

    public function cancel(Request $request, TransferRequest $transferRequest): JsonResponse
    {
        Gate::authorize('cancel', $transferRequest);

        $cancelled = $this->transferService->cancel($transferRequest);

        return response()->json($this->serialize($cancelled));
    }

    private function serialize(TransferRequest $transfer): array
    {
        return [
            'id' => $transfer->id,
            'userId' => $transfer->user_id,
            'fromSectionId' => $transfer->from_section_id,
            'fromSectionName' => $transfer->fromSection?->name,
            'toSectionId' => $transfer->to_section_id,
            'toSectionName' => $transfer->toSection?->name,
            'reason' => $transfer->reason,
            'status' => $transfer->status,
            'decidedByName' => $transfer->decidedBy?->full_name,
            'decidedAt' => $transfer->decided_at?->toJSON(),
            'effectiveOn' => $transfer->effective_on?->toDateString(),
            'appliedAt' => $transfer->applied_at?->toJSON(),
            'requestedAt' => $transfer->created_at?->toJSON(),
        ];
    }
}
