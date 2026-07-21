<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\AdminAccessRequest;
use App\Models\Department;
use App\Models\Notification;
use App\Models\User;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Validator;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;
use Illuminate\Validation\Rules\Password;
use Illuminate\Validation\ValidationException;

/**
 * Public self-enrollment for the Academic module. Residents and consultants
 * apply for their own account, and like the admin track they only create a
 * PENDING request - no account exists until an approver approves it, so the
 * applicant cannot log in or act until then. The queue is shared with admin
 * signups (the admin_access_requests table name is historical); the requested
 * role is pinned to the validated resident|consultant value.
 */
class AcademicRegistrationController extends Controller
{
    public function store(Request $request): JsonResponse
    {
        $validated = Validator::make($this->normalize($request), [
            'full_name' => ['required', 'string', 'max:255'],
            'email' => ['required', 'email', 'max:255'],
            'password' => ['required', 'string', Password::defaults()],
            'role' => ['required', Rule::in(['resident', 'consultant'])],
            'home_ward_id' => ['nullable', 'string', 'max:80'],
            'notes' => ['nullable', 'string', 'max:1000'],
        ])->validate();

        $email = strtolower(trim($validated['email']));

        if (User::query()->whereRaw('lower(email) = ?', [$email])->exists()) {
            throw ValidationException::withMessages([
                'email' => 'An account with this email already exists. Sign in instead.',
            ]);
        }

        if (AdminAccessRequest::query()->where('status', 'pending')->whereRaw('lower(email) = ?', [$email])->exists()) {
            throw ValidationException::withMessages([
                'email' => 'An enrollment request with this email is already awaiting approval.',
            ]);
        }

        $homeWard = $this->resolveHomeWard($validated['home_ward_id'] ?? null);

        $enrollmentRequest = AdminAccessRequest::query()->create([
            'full_name' => trim(preg_replace('/\s+/', ' ', $validated['full_name'])),
            'email' => $email,
            'username' => null,
            'password' => $validated['password'],
            'requested_role' => $validated['role'],
            'status' => 'pending',
            'home_ward_id' => $homeWard?->id,
            'notes' => $validated['notes'] ?? null,
            'requested_at' => now(),
        ]);

        $this->notifyApprovers($enrollmentRequest);

        return response()->json([
            'status' => 'pending',
            'message' => 'Your enrollment request was submitted and is awaiting approval.',
        ], 201);
    }

    private function resolveHomeWard(?string $identifier): ?Department
    {
        if (! $identifier) {
            return null;
        }

        // Accept a DB id OR a slug (the SPA picks wards from its slug-based catalog).
        $ward = Department::query()
            ->where(fn (Builder $query) => $query->where('id', $identifier)->orWhere('slug', $identifier))
            ->where('active', true)
            ->first();

        if (! $ward) {
            throw ValidationException::withMessages([
                'homeWardId' => 'The selected ward could not be found.',
            ]);
        }

        return $ward;
    }

    private function notifyApprovers(AdminAccessRequest $enrollmentRequest): void
    {
        $roleLabel = $enrollmentRequest->requested_role === 'consultant' ? 'Consultant' : 'Resident';

        // Only superadmin + admin can approve the account queue.
        User::query()
            ->where('active', true)
            ->whereIn('role_key', ['superadmin', 'admin'])
            ->get()
            ->each(fn (User $approver) => Notification::query()->create([
                'recipient_id' => $approver->id,
                'type' => 'admin_access_request',
                'title' => 'Academic enrollment request',
                'message' => "{$enrollmentRequest->full_name} requested a {$roleLabel} account.",
                'related_route' => '/admin/users',
                'related_entity' => 'admin_access_request',
                'related_id' => $enrollmentRequest->id,
                'created_at' => now(),
            ]));
    }

    /**
     * Accept snake_case and camelCase input by normalizing top-level keys.
     *
     * @return array<string, mixed>
     */
    private function normalize(Request $request): array
    {
        $data = [];
        foreach ($request->all() as $key => $value) {
            $data[Str::snake($key)] = $value;
        }

        return $data;
    }
}
