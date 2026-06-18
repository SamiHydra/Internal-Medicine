<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\User;
use App\Support\Authorization\Permissions;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;
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

        if (! $user || ! Hash::check($validated['password'], $user->password)) {
            throw ValidationException::withMessages([
                'identifier' => __('auth.failed'),
            ]);
        }

        if (! $user->active) {
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
            'password' => ['required', 'string', \Illuminate\Validation\Rules\Password::defaults(), 'confirmed', 'different:current_password'],
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
                'title' => $user->title ?? $this->defaultTitle($user->role_key),
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

    private function defaultTitle(string $roleKey): string
    {
        return match ($roleKey) {
            'superadmin' => 'Maintenance',
            'admin' => 'Administrator',
            'resident' => 'Resident',
            'consultant' => 'Consultant',
            default => 'Nurse',
        };
    }
}
