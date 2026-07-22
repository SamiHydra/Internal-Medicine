<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\User;
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
        if (! $user || ! Hash::check($validated['password'], $user->password)) {
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

        // The 'password' cast hashes the value; clearing the flag releases the user
        // from the EnsurePasswordChanged gate on the next request.
        $user->forceFill([
            'password' => $validated['password'],
            'password_change_required' => false,
        ])->save();

        return response()->json($this->sessionPayload($user->refresh()));
    }

    public function logout(Request $request): JsonResponse
    {
        Auth::guard('web')->logout();

        if ($request->hasSession()) {
            $request->session()->invalidate();
            $request->session()->regenerateToken();
        }

        Auth::forgetGuards();

        return response()->json(null, 204);
    }

    private function findUserForIdentifier(string $identifier): ?User
    {
        return User::query()
            ->whereRaw('lower(email) = ?', [$identifier])
            ->orWhereRaw("lower(coalesce(username, '')) = ?", [$identifier])
            ->orderByRaw('case when lower(email) = ? then 0 else 1 end', [$identifier])
            ->orderBy('created_at')
            ->first();
    }

    /**
     * @return array<string, mixed>
     */
    private function sessionPayload(User $user): array
    {
        $user->load([
            'role',
            'assignments' => fn ($query) => $query
                ->where('active', true)
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
