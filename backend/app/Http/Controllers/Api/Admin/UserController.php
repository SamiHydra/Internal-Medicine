<?php

namespace App\Http\Controllers\Api\Admin;

use App\Http\Controllers\Api\Concerns\SerializesAdminResources;
use App\Http\Controllers\Controller;
use App\Models\User;
use App\Services\Admin\AdminAuditService;
use App\Support\Authorization\Permissions;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Gate;
use Illuminate\Validation\Rule;

class UserController extends Controller
{
    use SerializesAdminResources;

    public function __construct(
        private readonly AdminAuditService $auditService,
    ) {}

    public function index(Request $request): JsonResponse
    {
        Gate::authorize('viewAny', User::class);

        $validated = $request->validate([
            'role' => ['sometimes', Rule::in(['superadmin', 'admin', 'doctor_admin', 'nurse'])],
            'active' => ['sometimes', 'boolean'],
            'q' => ['sometimes', 'string', 'max:100'],
        ]);

        $query = User::query()
            ->with(['assignments.department', 'assignments.template'])
            ->orderBy('full_name');

        if (isset($validated['role'])) {
            $query->where('role_key', $validated['role']);
        }

        if (array_key_exists('active', $validated)) {
            $query->where('active', (bool) $validated['active']);
        }

        if (isset($validated['q'])) {
            $search = '%'.strtolower($validated['q']).'%';
            $query->where(function ($builder) use ($search): void {
                $builder->whereRaw('lower(full_name) like ?', [$search])
                    ->orWhereRaw('lower(email) like ?', [$search])
                    ->orWhereRaw('lower(username) like ?', [$search]);
            });
        }

        return response()->json([
            'data' => $query->get()->map(fn (User $user) => $this->serializeUser($user)),
        ]);
    }

    public function store(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'full_name' => ['required_without:fullName', 'string', 'max:255'],
            'fullName' => ['required_without:full_name', 'string', 'max:255'],
            'email' => ['required', 'email', 'max:255', 'unique:users,email'],
            'username' => ['nullable', 'string', 'min:3', 'max:64', 'regex:/^[a-zA-Z0-9._-]+$/', 'unique:users,username'],
            'password' => ['required', 'string', 'min:8'],
            'role_key' => ['required_without:role', Rule::in(['admin', 'doctor_admin', 'nurse'])],
            'role' => ['required_without:role_key', Rule::in(['admin', 'doctor_admin', 'nurse'])],
            'title' => ['nullable', 'string', 'max:255'],
            'phone' => ['nullable', 'string', 'max:32'],
            'active' => ['sometimes', 'boolean'],
            'password_change_required' => ['sometimes', 'boolean'],
            'passwordChangeRequired' => ['sometimes', 'boolean'],
        ]);
        $roleKey = $validated['role_key'] ?? $validated['role'];

        if (Permissions::isAdminRole($roleKey)) {
            Gate::authorize('createAdmin', User::class);
        } else {
            Gate::authorize('create', User::class);
        }

        $user = User::query()->create([
            'full_name' => $validated['full_name'] ?? $validated['fullName'],
            'email' => strtolower(trim($validated['email'])),
            'username' => $validated['username'] ?? null,
            'password' => $validated['password'],
            'role_key' => $roleKey,
            'title' => $validated['title'] ?? $this->defaultTitle($roleKey),
            'phone' => $validated['phone'] ?? null,
            'active' => (bool) ($validated['active'] ?? true),
            'password_change_required' => (bool) ($validated['password_change_required'] ?? $validated['passwordChangeRequired'] ?? true),
        ]);

        $this->auditService->record($request->user(), 'create', 'user', $user->id, null, $this->auditUserValues($user), $request);

        return response()->json($this->serializeUser($user->load('assignments')), 201);
    }

    public function show(User $user): JsonResponse
    {
        Gate::authorize('view', $user);

        return response()->json($this->serializeUser($user));
    }

    public function update(Request $request, User $user): JsonResponse
    {
        Gate::authorize('update', $user);

        $validated = $request->validate([
            'full_name' => ['sometimes', 'string', 'max:255'],
            'fullName' => ['sometimes', 'string', 'max:255'],
            'email' => ['sometimes', 'email', 'max:255', Rule::unique('users', 'email')->ignore($user->id)],
            'username' => ['sometimes', 'nullable', 'string', 'min:3', 'max:64', 'regex:/^[a-zA-Z0-9._-]+$/', Rule::unique('users', 'username')->ignore($user->id)],
            'role_key' => ['sometimes', Rule::in(['admin', 'doctor_admin', 'nurse'])],
            'role' => ['sometimes', Rule::in(['admin', 'doctor_admin', 'nurse'])],
            'title' => ['sometimes', 'nullable', 'string', 'max:255'],
            'phone' => ['sometimes', 'nullable', 'string', 'max:32'],
        ]);

        $oldValues = $this->auditUserValues($user);
        $nextRole = $validated['role_key'] ?? $validated['role'] ?? null;

        if ($nextRole !== null && Permissions::isAdminRole($nextRole)) {
            Gate::authorize('createAdmin', User::class);
        }

        $updates = [];

        foreach ([
            'full_name' => 'fullName',
            'email' => 'email',
            'username' => 'username',
            'title' => 'title',
            'phone' => 'phone',
        ] as $snakeKey => $camelKey) {
            if (array_key_exists($snakeKey, $validated) || array_key_exists($camelKey, $validated)) {
                $updates[$snakeKey] = $validated[$snakeKey] ?? $validated[$camelKey];
            }
        }

        if ($nextRole !== null) {
            $updates['role_key'] = $nextRole;
            $updates['title'] ??= $this->defaultTitle($nextRole);
        }

        if (isset($updates['email'])) {
            $updates['email'] = strtolower(trim($updates['email']));
        }

        $user->forceFill($updates)->save();
        $user->refresh();

        $this->auditService->record($request->user(), 'update', 'user', $user->id, $oldValues, $this->auditUserValues($user), $request);

        return response()->json($this->serializeUser($user));
    }

    public function setActive(Request $request, User $user): JsonResponse
    {
        Gate::authorize('setActive', $user);

        $validated = $request->validate([
            'active' => ['required', 'boolean'],
        ]);
        $oldValues = $this->auditUserValues($user);

        $user->forceFill(['active' => (bool) $validated['active']])->save();
        $user->refresh();

        $this->auditService->record($request->user(), 'set_active', 'user', $user->id, $oldValues, $this->auditUserValues($user), $request);

        return response()->json($this->serializeUser($user));
    }

    public function resetPassword(Request $request, User $user): JsonResponse
    {
        Gate::authorize('update', $user);

        $validated = $request->validate([
            'password' => ['required', 'string', 'min:8'],
            'password_change_required' => ['sometimes', 'boolean'],
            'passwordChangeRequired' => ['sometimes', 'boolean'],
        ]);
        $oldValues = $user->only(['password_change_required', 'updated_at']);

        $user->forceFill([
            'password' => $validated['password'],
            'password_change_required' => (bool) ($validated['password_change_required'] ?? $validated['passwordChangeRequired'] ?? true),
        ])->save();
        $user->refresh();

        $this->auditService->record(
            $request->user(),
            'reset_password',
            'user',
            $user->id,
            $oldValues,
            $user->only(['password_change_required', 'updated_at']),
            $request,
        );

        return response()->json($this->serializeUser($user));
    }

    public function destroy(Request $request, User $user): JsonResponse
    {
        Gate::authorize('setActive', $user);

        $oldValues = $this->auditUserValues($user);
        $user->forceFill(['active' => false])->save();
        $user->refresh();

        $this->auditService->record($request->user(), 'deactivate', 'user', $user->id, $oldValues, $this->auditUserValues($user), $request);

        return response()->json($this->serializeUser($user));
    }

    /**
     * @return array<string, mixed>
     */
    private function auditUserValues(User $user): array
    {
        return $user->only([
            'id',
            'email',
            'username',
            'full_name',
            'title',
            'role_key',
            'phone',
            'active',
            'password_change_required',
        ]);
    }

    private function defaultTitle(string $roleKey): string
    {
        return match ($roleKey) {
            'admin' => 'Administrator',
            'doctor_admin' => 'Clinical Director',
            default => 'Nurse',
        };
    }
}
