<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\User;
use App\Services\Admin\AdminAuditService;
use App\Services\Workspace\WorkspaceRevisionToken;
use App\Support\Authorization\Permissions;
use App\Support\RoleTitles;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;
use Illuminate\Validation\Rules\Password;
use Illuminate\Validation\ValidationException;

class AuthController extends Controller
{
    /**
     * A valid bcrypt hash checked when no user matches the identifier, so an
     * unknown identifier costs the same bcrypt work as a known one and response
     * time cannot be used to tell which identifiers exist. Cost 12, matching the
     * default BCRYPT_ROUNDS; regenerate it if that config changes.
     */
    private const NO_USER_PASSWORD_HASH = '$2y$12$FX6Hs3lmAm3ZXzMcBAWq0.CetT/jNh2m76HgshAKTJF6bm8hTYARO';

    public function __construct(
        private readonly AdminAuditService $auditService,
    ) {}

    public function login(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'identifier' => ['required', 'string', 'max:255'],
            'password' => ['required', 'string'],
            'remember' => ['sometimes', 'boolean'],
        ]);

        $identifier = Str::lower(trim($validated['identifier']));
        $user = $this->findUserForIdentifier($identifier);

        // Every unapproved state ends here, byte for byte. A distinct "your
        // request is still awaiting approval" reply looks password-gated and is
        // not: the public registration endpoints answer non-committally but
        // still store the password the ANONYMOUS caller chose, so a prober who
        // submits (email, password) and then signs in with the same pair reads
        // the approval branch as "that address had no account" and the failure
        // branch as "that address is taken". One extra request recovers the
        // whole bit those endpoints exist to hide.
        // Always run the hash check, even with no user, against a constant hash
        // so the response time is identical whether or not the identifier exists.
        // A short-circuit here (no user => no bcrypt) is a timing oracle that
        // recovers the very bit the constant auth.failed message above hides.
        $passwordValid = Hash::check(
            $validated['password'],
            $user?->password ?? self::NO_USER_PASSWORD_HASH,
        );

        if (! $user || ! $passwordValid) {
            throw ValidationException::withMessages([
                'identifier' => __('auth.failed'),
            ]);
        }

        if (! $user->active) {
            // Same oracle in the nurse track, which DOES create an inactive
            // users row carrying the caller-supplied password: a never-activated
            // account must be indistinguishable from an unknown address. An
            // account that has signed in before is safe to name - no anonymous
            // prober can know its password - and that is the case where a
            // deactivated member of staff needs the real reason.
            if ($user->last_login_at === null) {
                throw ValidationException::withMessages([
                    'identifier' => __('auth.failed'),
                ]);
            }

            return response()->json([
                'message' => 'This account is inactive.',
            ], 403);
        }

        Auth::guard('web')->login($user, $request->boolean('remember'));

        if ($request->hasSession()) {
            $request->session()->regenerate();
        }

        $user->forceFill(['last_login_at' => now()])->save();

        return response()->json($this->sessionPayload($user->refresh()));
    }

    public function me(Request $request): JsonResponse
    {
        return response()->json($this->sessionPayload($request->user()));
    }

    public function changePassword(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'current_password' => ['required', 'string'],
            'password' => ['required', 'string', Password::defaults(), 'confirmed', 'different:current_password'],
        ]);

        $user = $request->user();

        if (! Hash::check($validated['current_password'], $user->password)) {
            throw ValidationException::withMessages([
                'current_password' => 'Your current password is incorrect.',
            ]);
        }

        $oldValues = $user->only(['password_change_required']);

        // The 'password' cast hashes the value; clearing the flag releases the user
        // from the EnsurePasswordChanged gate on the next request.
        $user->forceFill([
            'password' => $validated['password'],
            'password_change_required' => false,
        ])->save();

        // Record the fact of the change, never the password or its hash, so a
        // credential change from a hijacked session still leaves a trail.
        $this->auditService->record(
            $user,
            'change_password',
            'user',
            $user->id,
            $oldValues,
            ['password_change_required' => false, 'method' => 'self_service'],
            $request,
        );

        return response()->json($this->sessionPayload($user->refresh()));
    }

    public function logout(Request $request): JsonResponse
    {
        Auth::guard('web')->logout();

        if ($request->hasSession()) {
            // The revision-poll credential is bound to this session; drop its
            // registration before the id is rotated away (QA-016).
            app(WorkspaceRevisionToken::class)->revoke($request->session()->getId());

            $request->session()->invalidate();
            $request->session()->regenerateToken();
        }

        Auth::forgetGuards();

        return response()->json(null, 204);
    }

    private function findUserForIdentifier(string $identifier): ?User
    {
        // Email has precedence when an identifier could match both fields.
        // Both columns are normalized on write, so these are two cheap indexed
        // point lookups instead of one lower()/coalesce()/CASE table scan.
        return User::query()->where('email', $identifier)->first()
            ?? User::query()->where('username', $identifier)->oldest('created_at')->first();
    }

    /**
     * @return array<string, mixed>
     */
    private function sessionPayload(User $user): array
    {
        // Assignments are reporting scope, so they are only part of the session
        // for accounts that currently hold the reporting permission.
        $canReport = Permissions::userCan($user, Permissions::REPORTS_VIEW_ASSIGNED);

        $user->load([
            'role',
            'assignments' => fn ($query) => $query
                ->where('active', true)
                ->when(! $canReport, fn ($scoped) => $scoped->whereRaw('1 = 0'))
                ->with(['department', 'template'])
                ->orderBy('approved_at'),
        ]);

        return [
            'user' => [
                'id' => $user->id,
                'fullName' => $user->full_name,
                'email' => $user->email,
                'username' => $user->username,
                'role' => $user->role_key,
                'roleLabel' => $user->role?->label,
                'title' => $user->title ?? RoleTitles::default($user->role_key),
                'active' => $user->active,
                'phone' => $user->phone,
                'passwordChangeRequired' => $user->password_change_required,
                'lastLoginAt' => $user->last_login_at?->toJSON(),
            ],
            'assignments' => $user->assignments->map(fn ($assignment) => [
                'id' => $assignment->id,
                'nurseId' => $assignment->nurse_id,
                'departmentId' => $assignment->department_id,
                'departmentSlug' => $assignment->department?->slug,
                'departmentName' => $assignment->department?->name,
                'departmentFamily' => $assignment->department?->family,
                'templateId' => $assignment->template_id,
                'templateSlug' => $assignment->template?->slug,
                'templateName' => $assignment->template?->name,
                'active' => $assignment->active,
                'approvedAt' => $assignment->approved_at?->toJSON(),
            ])->values(),
            'permissions' => Permissions::forUser($user),
        ];
    }
}
