<?php

namespace App\Http\Controllers\Api\Admin;

use App\Http\Controllers\Api\Concerns\SerializesAdminResources;
use App\Http\Controllers\Controller;
use App\Models\RepAssignment;
use App\Models\ReportAssignment;
use App\Models\Role;
use App\Models\User;
use App\Services\Admin\AdminAuditService;
use App\Support\Authorization\Permissions;
use App\Support\Authorization\Workspaces;
use App\Support\RoleTitles;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;
use Illuminate\Validation\Rule;
use Illuminate\Validation\Rules\Password;
use Illuminate\Validation\ValidationException;

class UserController extends Controller
{
    use SerializesAdminResources;

    /**
     * Roles an administrator may hand out directly. Everyone else (resident,
     * consultant) arrives through public signup plus approval, and superadmin
     * exists only via the console command. `update` accepts the same list as
     * `store` so a role picked by mistake can be corrected in place instead of
     * forcing the account to be deactivated and rebuilt under a new email.
     *
     * @var list<string>
     */
    private const ASSIGNABLE_ROLES = ['admin', 'nurse', 'student_rep'];

    public function __construct(
        private readonly AdminAuditService $auditService,
    ) {}

    public function index(Request $request): JsonResponse
    {
        Gate::authorize('viewAny', User::class);

        $validated = $request->validate([
            'role' => ['sometimes', Rule::in(['superadmin', 'admin', 'nurse', 'resident', 'consultant', 'student_rep'])],
            'workspace' => ['sometimes', Rule::in(Workspaces::selectable())],
            'active' => ['sometimes', 'boolean'],
            'q' => ['sometimes', 'string', 'max:100'],
            'page' => ['sometimes', 'integer', 'min:1'],
            'per_page' => ['sometimes', 'integer', 'min:1', 'max:100'],
            'perPage' => ['sometimes', 'integer', 'min:1', 'max:100'],
        ]);

        $query = User::query()
            ->with([
                'assignments.department',
                'assignments.template',
                'assignments.nurse',
                'assignments.approver',
            ])
            ->orderBy('full_name');

        if (isset($validated['role'])) {
            $query->where('role_key', $validated['role']);
        }

        // The roles table is the source of truth for the clinical/academic split,
        // so the roster never needs a hardcoded role list to stay in sync.
        if (isset($validated['workspace'])) {
            $query->whereIn('role_key', Role::query()
                ->whereIn('workspace', [$validated['workspace'], Workspaces::BOTH])
                ->select('role_key'));
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

        $users = $query->paginate((int) ($validated['per_page'] ?? $validated['perPage'] ?? 100));

        return response()->json([
            'data' => $users->getCollection()
                ->map(fn (User $user) => $this->serializeUser($user))
                ->values(),
            'meta' => [
                'currentPage' => $users->currentPage(),
                'lastPage' => $users->lastPage(),
                'perPage' => $users->perPage(),
                'total' => $users->total(),
            ],
        ]);
    }

    public function store(Request $request): JsonResponse
    {
        $this->canonicalizeEmail($request);

        $validated = $request->validate([
            'full_name' => ['required_without:fullName', 'string', 'max:255'],
            'fullName' => ['required_without:full_name', 'string', 'max:255'],
            'email' => ['required', 'email', 'max:255', 'unique:users,email'],
            'username' => ['nullable', 'string', 'min:3', 'max:64', 'regex:/^[a-zA-Z0-9._-]+$/', 'unique:users,username'],
            'password' => ['required', 'string', Password::defaults()],
            'role_key' => ['required_without:role', Rule::in(self::ASSIGNABLE_ROLES)],
            'role' => ['required_without:role_key', Rule::in(self::ASSIGNABLE_ROLES)],
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
        $this->canonicalizeEmail($request);

        $validated = $request->validate([
            'full_name' => ['sometimes', 'string', 'max:255'],
            'fullName' => ['sometimes', 'string', 'max:255'],
            'email' => ['sometimes', 'email', 'max:255', Rule::unique('users', 'email')->ignore($user->id)],
            'username' => ['sometimes', 'nullable', 'string', 'min:3', 'max:64', 'regex:/^[a-zA-Z0-9._-]+$/', Rule::unique('users', 'username')->ignore($user->id)],
            'role_key' => ['sometimes', Rule::in(self::ASSIGNABLE_ROLES)],
            'role' => ['sometimes', Rule::in(self::ASSIGNABLE_ROLES)],
            'title' => ['sometimes', 'nullable', 'string', 'max:255'],
            'phone' => ['sometimes', 'nullable', 'string', 'max:32'],
            // Academic placement attributes (V2): residents carry a training
            // year and a Year 3 rotation group; consultants carry a section.
            'trainingYear' => ['sometimes', 'nullable', 'integer', 'between:1,3'],
            'rotationGroup' => ['sometimes', 'nullable', 'string', 'max:8'],
            'sectionId' => ['sometimes', 'nullable', 'string', Rule::exists('sections', 'id')],
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

            // Reps carry no academic placement (no training year, rotation
            // group, or section), so a role correction must not leave the old
            // role's placement behind on the row.
            if ($nextRole === 'student_rep') {
                $updates['training_year'] = null;
                $updates['rotation_group'] = null;
                $updates['section_id'] = null;
            }
        }

        foreach ([
            'training_year' => 'trainingYear',
            'rotation_group' => 'rotationGroup',
            'section_id' => 'sectionId',
        ] as $snakeKey => $camelKey) {
            if (array_key_exists($camelKey, $validated)) {
                $updates[$snakeKey] = $validated[$camelKey];
            }
        }

        if (isset($updates['email'])) {
            $updates['email'] = strtolower(trim($updates['email']));
        }

        // The role guard and the write share one transaction on a locked row so
        // a concurrent assignment grant cannot slip between the check and the
        // save: a role never changes while stale clinical scope remains active.
        $user = DB::transaction(function () use ($user, $nextRole, $updates): User {
            $locked = User::query()->lockForUpdate()->findOrFail($user->id);

            if ($nextRole !== null && $nextRole !== $locked->role_key) {
                $this->assertRoleChangeIsSafe($locked, $nextRole);
            }

            $locked->forceFill($updates)->save();

            return $locked->refresh();
        });

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
            'password' => ['required', 'string', Password::defaults()],
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
     * A role change must never leave scope behind that only made sense for the
     * old role. Both directions are guarded:
     *
     * - A representative's batch assignment is only valid while the account
     *   still holds the rep role (UndergraduateAdminController::assertEligibleRep),
     *   so moving them off it would silently leave a batch with a rep who can no
     *   longer record anything.
     * - A nurse's active report assignments are clinical scope. Leaving them on
     *   an account that no longer holds the reporting permission is exactly the
     *   state the report policies now refuse; refusing the transition keeps the
     *   data model honest and makes the administrator retire the assignments
     *   deliberately (Users & Access, assignment studio) first.
     */
    private function assertRoleChangeIsSafe(User $user, string $nextRole): void
    {
        if ($nextRole === $user->role_key) {
            return;
        }

        if ($user->role_key === 'student_rep') {
            $hasActiveAssignment = RepAssignment::query()
                ->where('user_id', $user->id)
                ->where('active', true)
                ->exists();

            if ($hasActiveAssignment) {
                throw ValidationException::withMessages([
                    'role' => ['End this representative\'s active batch assignment before changing their role.'],
                ]);
            }
        }

        if ($user->role_key === 'nurse') {
            $hasActiveReportAssignment = ReportAssignment::query()
                ->where('nurse_id', $user->id)
                ->where('active', true)
                ->exists();

            if ($hasActiveReportAssignment) {
                throw ValidationException::withMessages([
                    'role' => ['Retire this nurse\'s active reporting assignments before changing their role.'],
                ]);
            }
        }
    }

    /**
     * Emails are one identity regardless of letter case. The model lowercases on
     * write, but the `unique` rule compared the raw input, so a case-variant
     * duplicate passed validation and then hit the database's unique index as
     * an HTTP 500 on SQLite (MariaDB's collation happened to mask it). Canonicalise
     * before validating so every engine answers 422 (QA-017).
     */
    private function canonicalizeEmail(Request $request): void
    {
        if ($request->has('email') && is_string($request->input('email'))) {
            $request->merge(['email' => strtolower(trim($request->input('email')))]);
        }
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
        return RoleTitles::default($roleKey);
    }
}
