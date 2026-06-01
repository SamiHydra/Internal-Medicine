<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Department;
use App\Models\Notification;
use App\Models\User;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Validator;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

/**
 * Public self-enrollment for the Academic module. Residents and consultants
 * create their own account (mirroring the nurse access-request flow): the user
 * is created active and all admins are notified so they can review or deactivate.
 */
class AcademicRegistrationController extends Controller
{
    public function store(Request $request): JsonResponse
    {
        $validated = Validator::make($this->normalize($request), [
            'full_name' => ['required', 'string', 'max:255'],
            'email' => ['required', 'email', 'max:255'],
            'password' => ['required', 'string', 'min:8'],
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

        $homeWard = $this->resolveHomeWard($validated['home_ward_id'] ?? null);

        $user = User::query()->create([
            'full_name' => trim(preg_replace('/\s+/', ' ', $validated['full_name'])),
            'email' => $email,
            'username' => null,
            'password' => $validated['password'],
            'role_key' => $validated['role'],
            'title' => $validated['role'] === 'consultant' ? 'Consultant' : 'Resident',
            'home_ward_id' => $homeWard?->id,
            'active' => true,
            'password_change_required' => false,
        ]);
        $user->forceFill(['email_verified_at' => now()])->save();

        $this->notifyAdmins($user);

        return response()->json([
            'signedIn' => false,
            'role' => $user->role_key,
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

    private function notifyAdmins(User $user): void
    {
        $roleLabel = $user->role_key === 'consultant' ? 'Consultant' : 'Resident';

        User::query()
            ->where('active', true)
            ->whereIn('role_key', ['superadmin', 'admin'])
            ->get()
            ->each(fn (User $admin) => Notification::query()->create([
                'recipient_id' => $admin->id,
                'type' => 'nurse_access_request',
                'title' => 'Academic enrollment',
                'message' => "{$user->full_name} enrolled as a {$roleLabel}.",
                'related_route' => '/admin/users',
                'related_entity' => 'academic_enrollment',
                'related_id' => $user->id,
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
