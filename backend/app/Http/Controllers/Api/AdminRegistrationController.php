<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\AdminAccessRequest;
use App\Models\Notification;
use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Validator;
use Illuminate\Support\Str;
use Illuminate\Validation\Rules\Password;
use Illuminate\Validation\ValidationException;

/**
 * Public self-signup for ADMIN accounts. It creates only a PENDING request - no
 * account exists until a superadmin or admin approves it, so the applicant
 * cannot log in or act until then. The requested role is always 'admin'; the
 * maintenance owner (superadmin) can never be created through any app flow.
 * The queue is shared with academic enrollment (the admin_access_requests table
 * name is historical), which is why requested_role is written explicitly.
 */
class AdminRegistrationController extends Controller
{
    public function store(Request $request): JsonResponse
    {
        $validated = Validator::make($this->normalize($request), [
            'full_name' => ['required', 'string', 'max:255'],
            'email' => ['required', 'email', 'max:255'],
            'password' => ['required', 'string', Password::defaults()],
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
                'email' => 'An admin request with this email is already awaiting approval.',
            ]);
        }

        $adminRequest = AdminAccessRequest::query()->create([
            'full_name' => trim(preg_replace('/\s+/', ' ', $validated['full_name'])),
            'email' => $email,
            'username' => null,
            'password' => $validated['password'],
            // Never trust a client-supplied role: admin self-signup is always 'admin'.
            'requested_role' => 'admin',
            'status' => 'pending',
            'notes' => $validated['notes'] ?? null,
            'requested_at' => now(),
        ]);

        $this->notifyApprovers($adminRequest);

        return response()->json([
            'status' => 'pending',
            'message' => 'Your admin access request was submitted and is awaiting approval.',
        ], 201);
    }

    private function notifyApprovers(AdminAccessRequest $adminRequest): void
    {
        // Only superadmin + admin can approve a pending admin (Clinical Director excluded).
        User::query()
            ->where('active', true)
            ->whereIn('role_key', ['superadmin', 'admin'])
            ->get()
            ->each(fn (User $approver) => Notification::query()->create([
                'recipient_id' => $approver->id,
                'type' => 'admin_access_request',
                'title' => 'Admin access request',
                'message' => "{$adminRequest->full_name} requested an admin account.",
                'related_route' => '/admin/users',
                'related_entity' => 'admin_access_request',
                'related_id' => $adminRequest->id,
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
