<?php

namespace App\Http\Controllers\Api\Admin;

use App\Http\Controllers\Api\Concerns\SerializesAdminResources;
use App\Http\Controllers\Controller;
use App\Models\User;
use App\Services\Admin\AdminAuditService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

class ClaimSuperadminController extends Controller
{
    use SerializesAdminResources;

    public function __construct(
        private readonly AdminAuditService $auditService,
    ) {}

    public function store(Request $request): JsonResponse
    {
        $actor = $request->user();
        $existingSuperadmin = User::query()
            ->where('role_key', 'superadmin')
            ->where('id', '!=', $actor->id)
            ->exists();

        if ($existingSuperadmin && $actor->role_key !== 'superadmin') {
            throw ValidationException::withMessages([
                'user' => 'A superadmin account already exists.',
            ]);
        }

        if (! in_array($actor->role_key, ['superadmin', 'admin', 'doctor_admin'], true)) {
            abort(403);
        }

        $validated = $request->validate([
            'full_name' => ['required_without:fullName', 'string', 'max:255'],
            'fullName' => ['required_without:full_name', 'string', 'max:255'],
            'username' => ['required', 'string', 'min:3', 'max:64', 'regex:/^[a-zA-Z0-9._-]+$/', Rule::unique('users', 'username')->ignore($actor->id)],
            'email' => ['required', 'email', 'max:255', Rule::unique('users', 'email')->ignore($actor->id)],
            'password' => ['required', 'string', 'min:8'],
        ]);

        $oldValues = $actor->only(['email', 'username', 'full_name', 'title', 'role_key']);
        $actor->forceFill([
            'full_name' => $validated['full_name'] ?? $validated['fullName'],
            'username' => $validated['username'],
            'email' => strtolower(trim($validated['email'])),
            'password' => $validated['password'],
            'role_key' => 'superadmin',
            'title' => 'Super Administrator',
            'active' => true,
            'password_change_required' => false,
        ])->save();
        $actor->refresh();

        $this->auditService->record($actor, 'claim_superadmin', 'user', $actor->id, $oldValues, $actor->only(['email', 'username', 'full_name', 'title', 'role_key']), $request);

        return response()->json([
            'currentEmail' => $actor->email,
            'pendingEmail' => null,
            'user' => $this->serializeUser($actor),
        ]);
    }
}
