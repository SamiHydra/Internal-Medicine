<?php

namespace App\Http\Controllers\Api\Admin;

use App\Http\Controllers\Api\Concerns\SerializesAdminResources;
use App\Http\Controllers\Controller;
use App\Models\AccessRequest;
use App\Services\Admin\AccessRequestReviewService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Gate;
use Illuminate\Validation\Rule;

class AccessRequestController extends Controller
{
    use SerializesAdminResources;

    public function __construct(
        private readonly AccessRequestReviewService $reviewService,
    ) {}

    public function index(Request $request): JsonResponse
    {
        Gate::authorize('viewAny', AccessRequest::class);

        $validated = $request->validate([
            'status' => ['sometimes', Rule::in(['pending', 'approved', 'rejected'])],
        ]);
        $query = AccessRequest::query()
            ->with(['user', 'reviewer', 'items.department', 'items.template'])
            ->latest('requested_at');

        if (isset($validated['status'])) {
            $query->where('status', $validated['status']);
        }

        return response()->json([
            'data' => $query->get()->map(fn (AccessRequest $accessRequest) => $this->serializeAccessRequest($accessRequest)),
        ]);
    }

    public function show(AccessRequest $accessRequest): JsonResponse
    {
        Gate::authorize('view', $accessRequest);

        return response()->json($this->serializeAccessRequest($accessRequest));
    }

    public function review(Request $request, AccessRequest $accessRequest): JsonResponse
    {
        Gate::authorize('review', $accessRequest);

        $validated = $request->validate([
            'decision' => ['required', Rule::in(['approved', 'rejected'])],
        ]);
        $reviewedRequest = $this->reviewService->review($request->user(), $accessRequest, $validated['decision']);

        return response()->json($this->serializeAccessRequest($reviewedRequest));
    }

    public function approve(Request $request, AccessRequest $accessRequest): JsonResponse
    {
        Gate::authorize('review', $accessRequest);

        $reviewedRequest = $this->reviewService->review($request->user(), $accessRequest, 'approved');

        return response()->json($this->serializeAccessRequest($reviewedRequest));
    }

    public function reject(Request $request, AccessRequest $accessRequest): JsonResponse
    {
        Gate::authorize('review', $accessRequest);

        $reviewedRequest = $this->reviewService->review($request->user(), $accessRequest, 'rejected');

        return response()->json($this->serializeAccessRequest($reviewedRequest));
    }
}
