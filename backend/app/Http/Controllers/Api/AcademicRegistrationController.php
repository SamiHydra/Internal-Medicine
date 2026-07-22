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
use Illuminate\Support\Facades\Hash;
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

        // Resolve the ward FIRST so a genuinely invalid payload still 422s; only
        // the email-state checks below are silenced.
        $homeWard = $this->resolveHomeWard($validated['home_ward_id'] ?? null);

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
            'message' => 'Your enrollment request was submitted and is awaiting approval. If you already have an account, sign in instead.',
        ], 201);

        if (User::query()->whereRaw('lower(email) = ?', [$email])->exists()) {
            return $submitted;
        }

        if (AdminAccessRequest::query()->where('status', 'pending')->whereRaw('lower(email) = ?', [$email])->exists()) {
            return $submitted;
        }

        $enrollmentRequest = AdminAccessRequest::query()->create([
            'full_name' => trim(preg_replace('/\s+/', ' ', $validated['full_name'])),
            'email' => $email,
            'username' => null,
            'password' => $passwordHash,
            'requested_role' => $validated['role'],
            'status' => 'pending',
            'home_ward_id' => $homeWard?->id,
            'notes' => $validated['notes'] ?? null,
            'requested_at' => now(),
        ]);

        $this->notifyApprovers($enrollmentRequest);

        return $submitted;
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
            'title' => 'Academic enrollment request',
            'message' => "{$enrollmentRequest->full_name} requested a {$roleLabel} account.",
            'related_route' => '/admin/users',
            'related_entity' => 'admin_access_request',
            'related_id' => $enrollmentRequest->id,
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
