<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Api\Concerns\SerializesAdminResources;
use App\Http\Controllers\Controller;
use App\Models\AccessRequest;
use App\Models\AccessRequestItem;
use App\Models\Department;
use App\Models\Notification;
use App\Models\ReportTemplate;
use App\Models\User;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rules\Password;
use Illuminate\Validation\ValidationException;

class AccessRequestSubmissionController extends Controller
{
    use SerializesAdminResources;

    public function store(Request $request): JsonResponse
    {
        $actor = Auth::guard('web')->user();
        $isAuthenticated = $actor instanceof User;

        $validated = $request->validate([
            'full_name' => [$isAuthenticated ? 'sometimes' : 'required_without:fullName', 'string', 'max:255'],
            'fullName' => [$isAuthenticated ? 'sometimes' : 'required_without:full_name', 'string', 'max:255'],
            'email' => [$isAuthenticated ? 'sometimes' : 'required', 'email', 'max:255'],
            'password' => [$isAuthenticated ? 'sometimes' : 'required', 'string', Password::defaults()],
            'requested_assignments' => ['required_without:requestedAssignments', 'array', 'min:1'],
            'requestedAssignments' => ['required_without:requested_assignments', 'array', 'min:1'],
            'requested_assignments.*.department_id' => ['sometimes', 'string', 'max:80'],
            'requestedAssignments.*.departmentId' => ['sometimes', 'string', 'max:80'],
            'requested_assignments.*.template_id' => ['sometimes', 'string', 'max:80'],
            'requestedAssignments.*.templateId' => ['sometimes', 'string', 'max:80'],
            'notes' => ['nullable', 'string', 'max:1000'],
        ]);

        return DB::transaction(function () use ($actor, $isAuthenticated, $validated): JsonResponse {
            $user = $isAuthenticated
                ? $actor
                : $this->createApplicantUser($validated);

            $requestedAssignments = $validated['requested_assignments'] ?? $validated['requestedAssignments'];
            $resolvedAssignments = $this->resolveRequestedAssignments($requestedAssignments);

            $accessRequest = AccessRequest::query()->create([
                'user_id' => $user->id,
                'email' => strtolower(trim($validated['email'] ?? $user->email)),
                'status' => 'pending',
                'notes' => $validated['notes'] ?? null,
                'requested_at' => now(),
            ]);

            foreach ($resolvedAssignments as $assignment) {
                AccessRequestItem::query()->create([
                    'access_request_id' => $accessRequest->id,
                    'department_id' => $assignment['department']->id,
                    'template_id' => $assignment['template']->id,
                ]);
            }

            $this->notifyAdmins($accessRequest, $user);

            return response()->json([
                'signedIn' => $isAuthenticated,
                'data' => $this->serializeAccessRequest($accessRequest->load(['user', 'reviewer', 'items.department', 'items.template'])),
            ], 201);
        });
    }

    private function createApplicantUser(array $validated): User
    {
        $email = strtolower(trim($validated['email']));

        if (User::query()->whereRaw('lower(email) = ?', [$email])->exists()) {
            throw ValidationException::withMessages([
                'email' => 'An account with this email already exists. Sign in before requesting more access.',
            ]);
        }

        // Create the applicant INACTIVE: a self-submitted access request is an
        // unvetted, unapproved person. Keeping active=false means login is blocked
        // by AuthController/EnsureActiveUser until an admin approves the request
        // (AccessRequestReviewService flips active=true on approval). A rejected
        // request simply leaves the account inactive - never authenticatable.
        return User::query()->create([
            'full_name' => trim(preg_replace('/\s+/', ' ', $validated['full_name'] ?? $validated['fullName'])),
            'email' => $email,
            'username' => null,
            'password' => $validated['password'],
            'role_key' => 'nurse',
            'title' => 'Applicant Nurse',
            'active' => false,
            'password_change_required' => false,
        ]);
    }

    private function resolveRequestedAssignments(array $requestedAssignments): array
    {
        return collect($requestedAssignments)
            ->map(function (array $item): array {
                $departmentIdentifier = $item['department_id'] ?? $item['departmentId'] ?? null;
                $templateIdentifier = $item['template_id'] ?? $item['templateId'] ?? null;

                if (! $departmentIdentifier || ! $templateIdentifier) {
                    throw ValidationException::withMessages([
                        'requestedAssignments' => 'Each requested assignment needs a department and template.',
                    ]);
                }

                $department = Department::query()
                    ->where(fn (Builder $query) => $query->where('id', $departmentIdentifier)->orWhere('slug', $departmentIdentifier))
                    ->where('active', true)
                    ->firstOrFail();
                $template = ReportTemplate::query()
                    ->where(fn (Builder $query) => $query->where('id', $templateIdentifier)->orWhere('slug', $templateIdentifier))
                    ->where('active', true)
                    ->firstOrFail();

                if ($department->template_id !== $template->id) {
                    throw ValidationException::withMessages([
                        'requestedAssignments' => 'The selected template must match the selected department.',
                    ]);
                }

                return compact('department', 'template');
            })
            ->unique(fn (array $item) => $item['department']->id.'|'.$item['template']->id)
            ->values()
            ->all();
    }

    private function notifyAdmins(AccessRequest $accessRequest, User $requester): void
    {
        User::query()
            ->where('active', true)
            ->whereIn('role_key', ['superadmin', 'admin'])
            ->get()
            ->each(fn (User $admin) => Notification::query()->create([
                'recipient_id' => $admin->id,
                'type' => 'nurse_access_request',
                'title' => 'Access request submitted',
                'message' => "{$requester->full_name} requested reporting access.",
                'related_route' => '/admin/users',
                'related_entity' => 'access_request',
                'related_id' => $accessRequest->id,
                'created_at' => now(),
            ]));
    }
}
