<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Api\Concerns\SerializesAdminResources;
use App\Http\Controllers\Controller;
use App\Models\AccessRequest;
use App\Models\AccessRequestItem;
use App\Models\Department;
use App\Models\Notification;
use App\Models\ReportTemplate;
use App\Models\User;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Validation\Rules\Password;
use Illuminate\Validation\ValidationException;

class AccessRequestSubmissionController extends Controller
{
    use SerializesAdminResources;

    /**
     * Title stamped on a self-submitted applicant row. It is the marker that
     * tells an unvetted applicant apart from a real account an admin created,
     * which is what makes an abandoned applicant row safely re-claimable.
     */
    private const APPLICANT_TITLE = 'Applicant Nurse';

    public function store(Request $request): JsonResponse
    {
        $actor = Auth::guard('web')->user();
        $isAuthenticated = $actor instanceof User;

        // This route is public (routes/api.php has no auth middleware on it) yet
        // it still honours a session cookie, so the gates the api middleware
        // would have applied have to be re-applied by hand. Without this an
        // account deactivated or forced into a password change mid-session keeps
        // writing rows and fanning notifications out to every admin, while every
        // other endpoint already refuses it.
        if ($isAuthenticated && ! $actor->active) {
            return response()->json([
                'message' => 'This account is inactive.',
            ], 403);
        }

        if ($isAuthenticated && $actor->password_change_required) {
            return response()->json([
                'message' => 'You must change your password before continuing.',
                'passwordChangeRequired' => true,
            ], 403);
        }

        $validated = $request->validate([
            'full_name' => [$isAuthenticated ? 'sometimes' : 'required_without:fullName', 'string', 'max:255'],
            'fullName' => [$isAuthenticated ? 'sometimes' : 'required_without:full_name', 'string', 'max:255'],
            'email' => [$isAuthenticated ? 'sometimes' : 'required', 'email', 'max:255'],
            'password' => [$isAuthenticated ? 'sometimes' : 'required', 'string', Password::defaults()],
            // Bounded: resolveRequestedAssignments() runs two lookups per entry
            // before ->unique() collapses them, so an unbounded array let one
            // anonymous request drive thousands of queries for a single row.
            'requested_assignments' => ['required_without:requestedAssignments', 'array', 'min:1', 'max:20'],
            'requestedAssignments' => ['required_without:requested_assignments', 'array', 'min:1', 'max:20'],
            'requested_assignments.*.department_id' => ['sometimes', 'string', 'max:80'],
            'requestedAssignments.*.departmentId' => ['sometimes', 'string', 'max:80'],
            'requested_assignments.*.template_id' => ['sometimes', 'string', 'max:80'],
            'requestedAssignments.*.templateId' => ['sometimes', 'string', 'max:80'],
            'notes' => ['nullable', 'string', 'max:1000'],
        ]);

        // The anonymous branch is guarded by the applicant-row lookup below; the
        // signed-in branch had no guard at all, so one client could stack pending
        // requests (and a fresh admin fan-out) without limit. Telling the actor
        // about their own pending request discloses nothing.
        if ($isAuthenticated && $this->hasLiveRequest($actor)) {
            throw ValidationException::withMessages([
                'requestedAssignments' => 'You already have an access request awaiting review.',
            ]);
        }

        // Hash outside the transaction, and unconditionally on the anonymous
        // branch. Doing it lazily inside resolveApplicantUser() meant only the
        // "address is free" path paid the ~370ms BCRYPT_ROUNDS=12 cost, so a
        // stopwatch recovered the very bit the identical body hides; doing it
        // inside would also hold the applicant row lock for that whole time.
        $passwordHash = $isAuthenticated ? null : Hash::make($validated['password']);

        return DB::transaction(function () use ($actor, $isAuthenticated, $validated, $passwordHash): JsonResponse {
            // Resolve the payload FIRST so a malformed department/template still
            // fails the same way whatever the email's state is; only the email
            // state itself is silenced below.
            $requestedAssignments = $validated['requested_assignments'] ?? $validated['requestedAssignments'];
            $resolvedAssignments = $this->resolveRequestedAssignments($requestedAssignments);

            $user = $isAuthenticated
                ? $actor
                : $this->resolveApplicantUser($validated, (string) $passwordHash);

            if (! $user) {
                // The address belongs to an account this anonymous caller must
                // not touch. Same body as the success path - see submitted().
                return $this->submitted();
            }

            $accessRequest = AccessRequest::query()->create([
                'user_id' => $user->id,
                'email' => strtolower(trim($validated['email'] ?? $user->email)),
                'status' => 'pending',
                'notes' => $validated['notes'] ?? null,
                'requested_at' => now(),
            ]);

            foreach ($resolvedAssignments as $assignment) {
                AccessRequestItem::query()->create([
                    'access_request_id' => $accessRequest->id,
                    'department_id' => $assignment['department']->id,
                    'template_id' => $assignment['template']->id,
                ]);
            }

            $this->notifyAdmins($accessRequest, $user);

            if (! $isAuthenticated) {
                return $this->submitted();
            }

            return response()->json([
                'signedIn' => true,
                'data' => $this->serializeAccessRequest($accessRequest->load(['user', 'reviewer', 'items.department', 'items.template'])),
            ], 201);
        });
    }

    /**
     * The one response every anonymous submission gets, whether a request was
     * created or silently skipped. Deliberately non-committal, exactly like
     * PasswordResetController@forgot: a distinct "an account with this email
     * already exists" reply let an anonymous prober classify addresses at 10
     * requests/min/IP. It also carries no serialized request, since a differing
     * body shape would leak the same thing the message no longer does.
     */
    private function submitted(): JsonResponse
    {
        return response()->json([
            'signedIn' => false,
            'status' => 'pending',
            'message' => 'Your access request was submitted and is awaiting approval. If you already have an account, sign in before requesting more access.',
        ], 201);
    }

    private function hasLiveRequest(User $user): bool
    {
        return AccessRequest::query()
            ->where('user_id', $user->id)
            ->where('status', 'pending')
            ->exists();
    }

    /**
     * Resolve the applicant behind an anonymous submission, or null when the
     * address is spoken for and the caller must be told nothing.
     */
    private function resolveApplicantUser(array $validated, string $passwordHash): ?User
    {
        $email = strtolower(trim($validated['email']));
        $fullName = trim(preg_replace('/\s+/', ' ', $validated['full_name'] ?? $validated['fullName']));

        $existing = User::query()
            ->whereRaw('lower(email) = ?', [$email])
            ->lockForUpdate()
            ->first();

        if ($existing) {
            // Anyone can post this form, so the row a previous submission left
            // behind must not squat an address forever: an applicant who was
            // never activated, never signed in and holds no live request is
            // re-claimable. A real account - or an applicant whose request is
            // still pending or already approved - is never touched.
            if (! $this->isReclaimableApplicant($existing)) {
                return null;
            }

            $existing->forceFill([
                'full_name' => $fullName,
                'password' => $passwordHash,
            ])->save();

            return $existing;
        }

        // Create the applicant INACTIVE: a self-submitted access request is an
        // unvetted, unapproved person. Keeping active=false means login is blocked
        // by AuthController/EnsureActiveUser until an admin approves the request
        // (AccessRequestReviewService flips active=true on approval). A rejected
        // request simply leaves the account inactive - never authenticatable.
        return User::query()->create([
            'full_name' => $fullName,
            'email' => $email,
            'username' => null,
            'password' => $passwordHash,
            'role_key' => 'nurse',
            'title' => self::APPLICANT_TITLE,
            'active' => false,
            'password_change_required' => false,
        ]);
    }

    private function isReclaimableApplicant(User $user): bool
    {
        if ($user->active || $user->role_key !== 'nurse' || $user->title !== self::APPLICANT_TITLE) {
            return false;
        }

        if ($user->username !== null || $user->last_login_at !== null) {
            return false;
        }

        return ! AccessRequest::query()
            ->where('user_id', $user->id)
            ->whereIn('status', ['pending', 'approved'])
            ->exists();
    }

    private function resolveRequestedAssignments(array $requestedAssignments): array
    {
        return collect($requestedAssignments)
            ->map(function (array $item): array {
                $departmentIdentifier = $item['department_id'] ?? $item['departmentId'] ?? null;
                $templateIdentifier = $item['template_id'] ?? $item['templateId'] ?? null;

                if (! $departmentIdentifier || ! $templateIdentifier) {
                    throw ValidationException::withMessages([
                        'requestedAssignments' => 'Each requested assignment needs a department and template.',
                    ]);
                }

                $department = Department::query()
                    ->where(fn (Builder $query) => $query->where('id', $departmentIdentifier)->orWhere('slug', $departmentIdentifier))
                    ->where('active', true)
                    ->firstOrFail();
                $template = ReportTemplate::query()
                    ->where(fn (Builder $query) => $query->where('id', $templateIdentifier)->orWhere('slug', $templateIdentifier))
                    ->where('active', true)
                    ->firstOrFail();

                if ($department->template_id !== $template->id) {
                    throw ValidationException::withMessages([
                        'requestedAssignments' => 'The selected template must match the selected department.',
                    ]);
                }

                return compact('department', 'template');
            })
            ->unique(fn (array $item) => $item['department']->id.'|'.$item['template']->id)
            ->values()
            ->all();
    }

    private function notifyAdmins(AccessRequest $accessRequest, User $requester): void
    {
        $recipientIds = User::query()
            ->where('active', true)
            ->whereIn('role_key', ['superadmin', 'admin'])
            ->pluck('id');

        if ($recipientIds->isEmpty()) {
            return;
        }

        // One bulk insert rather than a round trip per admin: this endpoint is
        // reachable unauthenticated, so its cost must not scale with the number
        // of admins on the instance.
        $model = new Notification;
        $rows = $recipientIds->map(fn (string $recipientId): array => [
            'id' => $model->newUniqueId(),
            'recipient_id' => $recipientId,
            'type' => 'nurse_access_request',
            'title' => 'Access request submitted',
            'message' => "{$requester->full_name} requested reporting access.",
            'related_route' => '/admin/users',
            'related_entity' => 'access_request',
            'related_id' => $accessRequest->id,
            'read_at' => null,
            'created_at' => now(),
        ])->all();

        Notification::query()->insert($rows);
    }
}
