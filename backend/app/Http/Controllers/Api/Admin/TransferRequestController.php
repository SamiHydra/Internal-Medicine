<?php

namespace App\Http\Controllers\Api\Admin;

use App\Http\Controllers\Controller;
use App\Models\Section;
use App\Models\TransferRequest;
use App\Models\User;
use App\Services\Academic\TransferService;
use App\Support\Authorization\Permissions;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Gate;
use Illuminate\Validation\Rule;

/**
 * The review side of section transfers. Reachable by admins and by
 * consultants who head a section: the route permission is coarse
 * (transfers.review) and the policy narrows each decision to the head of the
 * DESTINATION section.
 */
class TransferRequestController extends Controller
{
    public function __construct(
        private readonly TransferService $transferService,
    ) {}

    public function index(Request $request): JsonResponse
    {
        Gate::authorize('viewAny', TransferRequest::class);

        $validated = $request->validate([
            'status' => ['sometimes', 'string', Rule::in(TransferRequest::STATUSES)],
        ]);

        $user = $request->user();

        $requests = TransferRequest::query()
            ->with(['user', 'fromSection', 'toSection', 'decidedBy'])
            ->when(isset($validated['status']), fn ($query) => $query->where('status', $validated['status']))
            // Heads (non-admin reviewers) only see traffic touching their sections.
            ->when(! Permissions::isAdminRole($user->role_key), function ($query) use ($user): void {
                $headedSectionIds = Section::query()
                    ->where('head_user_id', $user->id)
                    ->pluck('id');

                $query->where(fn ($scope) => $scope
                    ->whereIn('to_section_id', $headedSectionIds)
                    ->orWhereIn('from_section_id', $headedSectionIds));
            })
            ->latest('created_at')
            ->limit(200)
            ->get();

        return response()->json([
            'data' => $requests->map(fn (TransferRequest $transfer) => $this->serialize($transfer)),
        ]);
    }

    public function approve(Request $request, TransferRequest $transferRequest): JsonResponse
    {
        Gate::authorize('decide', $transferRequest);

        $validated = $request->validate([
            'effectiveOn' => ['sometimes', 'nullable', 'date'],
            'immediate' => ['sometimes', 'boolean'],
        ]);

        $effectiveOn = null;

        if ($validated['immediate'] ?? false) {
            $effectiveOn = Carbon::today();
        } elseif (! empty($validated['effectiveOn'])) {
            $effectiveOn = Carbon::parse($validated['effectiveOn'])->startOfDay();
        }

        $approved = $this->transferService->approve($transferRequest, $request->user(), $effectiveOn);

        return response()->json($this->serialize($approved));
    }

    public function reject(Request $request, TransferRequest $transferRequest): JsonResponse
    {
        Gate::authorize('decide', $transferRequest);

        $rejected = $this->transferService->reject($transferRequest, $request->user());

        return response()->json($this->serialize($rejected));
    }

    private function serialize(TransferRequest $transfer): array
    {
        return [
            'id' => $transfer->id,
            'userId' => $transfer->user_id,
            'userName' => $transfer->user?->full_name,
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
