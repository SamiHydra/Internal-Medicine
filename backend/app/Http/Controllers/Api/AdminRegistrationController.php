<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\AdminAccessRequest;
use App\Models\Notification;
use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Validator;
use Illuminate\Support\Str;
use Illuminate\Validation\Rules\Password;

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

        // Hash BEFORE the state checks below and reuse the result on the write
        // path (the 'hashed' cast passes an already-hashed value through). At
        // BCRYPT_ROUNDS=12 that is ~370ms of work, so hashing only when a row is
        // written made the "address is free" branch measurably slower than the
        // silent ones and a stopwatch recovered the bit the identical body hides.
        $passwordHash = Hash::make($validated['password']);

        // Deliberately non-committal, exactly like PasswordResetController@forgot:
        // "created", "that address already has an account" and "that address
        // already has a request pending" all return this same body, so an
        // anonymous prober cannot classify addresses (three states per probe at
        // 10 requests/min/IP). The copy still tells a legitimate applicant what
        // to do next without asserting which of the three states they are in.
        $submitted = response()->json([
            'status' => 'pending',
            'message' => 'Your admin access request was submitted and is awaiting approval. If you already have an account, sign in instead.',
        ], 201);

        if (User::query()->whereRaw('lower(email) = ?', [$email])->exists()) {
            return $submitted;
        }

        if (AdminAccessRequest::query()->where('status', 'pending')->whereRaw('lower(email) = ?', [$email])->exists()) {
            return $submitted;
        }

        $adminRequest = AdminAccessRequest::query()->create([
            'full_name' => trim(preg_replace('/\s+/', ' ', $validated['full_name'])),
            'email' => $email,
            'username' => null,
            'password' => $passwordHash,
            // Never trust a client-supplied role: admin self-signup is always 'admin'.
            'requested_role' => 'admin',
            'status' => 'pending',
            'notes' => $validated['notes'] ?? null,
            'requested_at' => now(),
        ]);

        $this->notifyApprovers($adminRequest);

        return $submitted;
    }

    private function notifyApprovers(AdminAccessRequest $adminRequest): void
    {
        // Only superadmin + admin can approve a pending admin (Clinical Director excluded).
        $recipientIds = User::query()
            ->where('active', true)
            ->whereIn('role_key', ['superadmin', 'admin'])
            ->pluck('id');

        if ($recipientIds->isEmpty()) {
            return;
        }

        // One bulk insert rather than a round trip per approver: this runs inside
        // an unauthenticated request, so its cost must not scale with the number
        // of admins on the instance.
        $model = new Notification;
        $rows = $recipientIds->map(fn (string $recipientId): array => [
            'id' => $model->newUniqueId(),
            'recipient_id' => $recipientId,
            'type' => 'admin_access_request',
            'title' => 'Admin access request',
            'message' => "{$adminRequest->full_name} requested an admin account.",
            'related_route' => '/admin/users',
            'related_entity' => 'admin_access_request',
            'related_id' => $adminRequest->id,
            'read_at' => null,
            'created_at' => now(),
        ])->all();

        Notification::query()->insert($rows);
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
