<?php

namespace App\Http\Controllers\Api\Admin;

use App\Http\Controllers\Api\Concerns\SerializesAdminResources;
use App\Http\Controllers\Controller;
use App\Models\AdminAccessRequest;
use App\Services\Admin\AdminAccessRequestReviewService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Gate;
use Illuminate\Validation\Rule;

class AdminAccessRequestController extends Controller
{
    use SerializesAdminResources;

    public function __construct(
        private readonly AdminAccessRequestReviewService $reviewService,
    ) {}

    public function index(Request $request): JsonResponse
    {
        Gate::authorize('viewAny', AdminAccessRequest::class);

        $validated = $request->validate([
            'status' => ['sometimes', Rule::in(['pending', 'approved', 'rejected'])],
        ]);

        $query = AdminAccessRequest::query()
            ->with(['reviewer', 'createdUser'])
            ->latest('requested_at');

        if (isset($validated['status'])) {
            $query->where('status', $validated['status']);
        }

        return response()->json([
            'data' => $query->get()->map(fn (AdminAccessRequest $adminRequest) => $this->serializeAdminAccessRequest($adminRequest)),
        ]);
    }

    public function approve(Request $request, AdminAccessRequest $adminAccessRequest): JsonResponse
    {
        Gate::authorize('review', $adminAccessRequest);

        $reviewed = $this->reviewService->review($request->user(), $adminAccessRequest, 'approved');

        return response()->json($this->serializeAdminAccessRequest($reviewed));
    }

    public function reject(Request $request, AdminAccessRequest $adminAccessRequest): JsonResponse
    {
        Gate::authorize('review', $adminAccessRequest);

        $reviewed = $this->reviewService->review($request->user(), $adminAccessRequest, 'rejected');

        return response()->json($this->serializeAdminAccessRequest($reviewed));
    }
}
