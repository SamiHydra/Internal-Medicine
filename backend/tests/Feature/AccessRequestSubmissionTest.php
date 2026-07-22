<?php

namespace Tests\Feature;

use App\Models\AccessRequest;
use App\Models\Department;
use App\Models\Notification;
use App\Models\ReportTemplate;
use App\Models\User;
use Database\Seeders\DepartmentSeeder;
use Database\Seeders\ReportTemplateSeeder;
use Database\Seeders\RoleSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

/**
 * POST /api/access-requests is the one public route that also honours a session
 * cookie, which is what makes it worth its own suite: the anonymous branch must
 * disclose nothing and must not squat addresses, and the signed-in branch must
 * re-apply the gates the missing auth middleware would have applied.
 */
class AccessRequestSubmissionTest extends TestCase
{
    use RefreshDatabase;

    private Department $department;

    private ReportTemplate $template;

    private User $admin;

    protected function setUp(): void
    {
        parent::setUp();

        foreach ([RoleSeeder::class, ReportTemplateSeeder::class, DepartmentSeeder::class] as $seeder) {
            $this->seed($seeder);
        }

        $this->department = Department::query()->where('slug', 'gi_neuro_inpatient')->firstOrFail();
        $this->template = ReportTemplate::query()->whereKey($this->department->template_id)->firstOrFail();
        $this->admin = User::factory()->role('admin', 'Administrator')->create();
    }

    /**
     * @param  array<string, mixed>  $overrides
     */
    private function payload(array $overrides = []): array
    {
        return array_merge([
            'fullName' => 'New Applicant',
            'email' => 'new.applicant@example.test',
            'password' => 'StPaul2026!',
            'requestedAssignments' => [
                ['departmentId' => $this->department->slug, 'templateId' => $this->template->slug],
            ],
        ], $overrides);
    }

    /**
     * C-SEC-004: free address, address with an account and address with a
     * request already pending must be indistinguishable to an anonymous prober,
     * the way PasswordResetController@forgot already is.
     */
    public function test_the_anonymous_branch_does_not_disclose_whether_an_address_is_known(): void
    {
        User::factory()->create(['email' => 'taken@example.test']);
        $this->postJson('/api/access-requests', $this->payload())->assertCreated();

        $free = $this->postJson('/api/access-requests', $this->payload(['email' => 'nobody@example.test']));
        $withAccount = $this->postJson('/api/access-requests', $this->payload(['email' => 'taken@example.test']));
        $withPending = $this->postJson('/api/access-requests', $this->payload(['email' => 'new.applicant@example.test']));

        foreach ([$withAccount, $withPending] as $probe) {
            $this->assertSame($free->getStatusCode(), $probe->getStatusCode());
            $this->assertSame($free->getContent(), $probe->getContent());
        }

        // Silent means silent: no second request and no extra admin fan-out for
        // the two probes that must not write.
        $this->assertSame(0, AccessRequest::query()->where('email', 'taken@example.test')->count());
        $this->assertSame(1, AccessRequest::query()->where('email', 'new.applicant@example.test')->count());
    }

    /**
     * The silencing must not swallow a genuinely invalid payload, otherwise a
     * prober gets the oracle back by sending a bad department.
     */
    public function test_an_unresolvable_assignment_fails_the_same_way_for_a_known_address(): void
    {
        User::factory()->create(['email' => 'taken@example.test']);

        $free = $this->postJson('/api/access-requests', $this->payload([
            'email' => 'nobody@example.test',
            'requestedAssignments' => [['departmentId' => 'no_such_ward', 'templateId' => $this->template->slug]],
        ]));
        $known = $this->postJson('/api/access-requests', $this->payload([
            'email' => 'taken@example.test',
            'requestedAssignments' => [['departmentId' => 'no_such_ward', 'templateId' => $this->template->slug]],
        ]));

        $this->assertSame($free->getStatusCode(), $known->getStatusCode());
        $this->assertNotSame(201, $free->getStatusCode());
    }

    /**
     * C-SEC-002: one anonymous request used to lock an address out of all three
     * signup paths forever. An applicant row that was never activated, never
     * signed in and holds no live request is re-claimable.
     */
    public function test_an_abandoned_applicant_row_is_reclaimable_once_its_request_is_rejected(): void
    {
        $this->postJson('/api/access-requests', $this->payload([
            'fullName' => 'Squatter',
            'password' => 'Squatter2026!',
        ]))->assertCreated();

        // Rejected directly rather than through the admin endpoint: actingAs()
        // would leave the test session signed in as the admin and the next
        // submission would take the authenticated branch.
        AccessRequest::query()->firstOrFail()->forceFill([
            'status' => 'rejected',
            'reviewed_at' => now(),
            'reviewed_by' => $this->admin->id,
        ])->save();

        // The real owner of the address can now claim the row back.
        $this->postJson('/api/access-requests', $this->payload([
            'fullName' => 'Real Owner',
            'password' => 'RealOwner2026!',
        ]))->assertCreated();

        $applicant = User::query()->whereRaw('lower(email) = ?', ['new.applicant@example.test'])->firstOrFail();
        $this->assertSame('Real Owner', $applicant->full_name);
        $this->assertTrue(Hash::check('RealOwner2026!', $applicant->password));
        $this->assertFalse((bool) $applicant->active);
        $this->assertSame(2, AccessRequest::query()->where('user_id', $applicant->id)->count());
    }

    /**
     * The re-claim must be narrow: a live pending request, a real account and an
     * account that has ever signed in are all left untouched, so it cannot be
     * turned into a password-reset primitive.
     */
    public function test_reclaiming_never_touches_a_live_or_real_account(): void
    {
        $this->postJson('/api/access-requests', $this->payload())->assertCreated();
        $applicant = User::query()->whereRaw('lower(email) = ?', ['new.applicant@example.test'])->firstOrFail();

        // A pending request is live, so the row keeps its original credentials.
        $this->postJson('/api/access-requests', $this->payload([
            'fullName' => 'Attacker',
            'password' => 'Attacker2026!',
        ]))->assertCreated();

        $applicant->refresh();
        $this->assertSame('New Applicant', $applicant->full_name);
        $this->assertTrue(Hash::check('StPaul2026!', $applicant->password));

        // A real nurse account is never re-claimable either, even when an admin
        // has deactivated it and it has never been signed in to.
        $nurse = User::factory()->create([
            'email' => 'real.nurse@example.test',
            'username' => null,
            'password' => Hash::make('Nurse2026!'),
            'active' => false,
            'last_login_at' => null,
        ]);

        $this->postJson('/api/access-requests', $this->payload([
            'email' => 'real.nurse@example.test',
            'fullName' => 'Attacker',
            'password' => 'Attacker2026!',
        ]))->assertCreated();

        $nurse->refresh();
        $this->assertTrue(Hash::check('Nurse2026!', $nurse->password));
        $this->assertSame(0, AccessRequest::query()->where('user_id', $nurse->id)->count());
    }

    /**
     * C-SEC-003: the route carries no auth middleware yet reads the session, so
     * EnsureActiveUser and EnsurePasswordChanged never ran on it. A revoked
     * account could still write rows and fan notifications out to every admin.
     */
    public function test_a_deactivated_session_cannot_submit(): void
    {
        $nurse = User::factory()->create(['email' => 'nurse@example.test', 'active' => false]);

        $this->actingAs($nurse)
            ->postJson('/api/access-requests', $this->payload())
            ->assertForbidden()
            ->assertJsonPath('message', 'This account is inactive.');

        $this->assertSame(0, AccessRequest::query()->count());
    }

    public function test_a_session_owing_a_password_change_cannot_submit(): void
    {
        $nurse = User::factory()->create([
            'email' => 'nurse@example.test',
            'password_change_required' => true,
        ]);

        $this->actingAs($nurse)
            ->postJson('/api/access-requests', $this->payload())
            ->assertForbidden()
            ->assertJsonPath('passwordChangeRequired', true);

        $this->assertSame(0, AccessRequest::query()->count());
    }

    /**
     * C-SEC-002: the signed-in branch had no duplicate guard at all, so one
     * client could stack pending requests and re-trigger the admin fan-out with
     * a byte-identical body.
     */
    public function test_a_signed_in_nurse_cannot_stack_pending_requests(): void
    {
        $nurse = User::factory()->create(['email' => 'nurse@example.test']);

        $this->actingAs($nurse)
            ->postJson('/api/access-requests', $this->payload())
            ->assertCreated()
            ->assertJsonPath('signedIn', true)
            ->assertJsonPath('data.status', 'pending');

        $this->actingAs($nurse)
            ->postJson('/api/access-requests', $this->payload())
            ->assertStatus(422)
            ->assertJsonValidationErrors('requestedAssignments');

        $this->assertSame(1, AccessRequest::query()->where('user_id', $nurse->id)->count());

        // Once the first request has been reviewed a new one is allowed again.
        AccessRequest::query()->firstOrFail()->forceFill(['status' => 'rejected'])->save();

        $this->actingAs($nurse)
            ->postJson('/api/access-requests', $this->payload())
            ->assertCreated();

        $this->assertSame(2, AccessRequest::query()->where('user_id', $nurse->id)->count());
    }

    /**
     * C-SEC-002: resolveRequestedAssignments runs two lookups per entry before
     * ->unique() collapses them, so an unbounded array turned one anonymous
     * request into thousands of queries for a single persisted row.
     */
    public function test_the_requested_assignment_array_is_bounded(): void
    {
        $entry = ['departmentId' => $this->department->slug, 'templateId' => $this->template->slug];

        $this->postJson('/api/access-requests', $this->payload([
            'requestedAssignments' => array_fill(0, 21, $entry),
        ]))
            ->assertStatus(422)
            ->assertJsonValidationErrors('requestedAssignments');

        $this->assertSame(0, AccessRequest::query()->count());

        $this->postJson('/api/access-requests', $this->payload([
            'requestedAssignments' => array_fill(0, 20, $entry),
        ]))->assertCreated();
    }

    /**
     * C-SEC-002: the admin fan-out used to be one INSERT round trip per admin,
     * driven by an unauthenticated request. It is now a single bulk insert, and
     * still reaches exactly the active approvers.
     */
    public function test_the_admin_fan_out_is_a_single_insert_and_still_reaches_every_approver(): void
    {
        $superadmin = User::factory()->role('superadmin', 'Maintenance')->create();
        $secondAdmin = User::factory()->role('admin', 'Administrator')->create();
        $inactiveAdmin = User::factory()->role('admin', 'Administrator')->create(['active' => false]);
        $nurse = User::factory()->create();

        DB::enableQueryLog();
        $this->postJson('/api/access-requests', $this->payload())->assertCreated();
        $insertCount = collect(DB::getQueryLog())
            ->filter(fn (array $query): bool => str_contains(strtolower($query['query']), 'insert into "notifications"')
                || str_contains(strtolower($query['query']), 'insert into `notifications`'))
            ->count();
        DB::disableQueryLog();

        $this->assertSame(1, $insertCount);

        $notified = Notification::query()->where('type', 'nurse_access_request')->pluck('recipient_id');
        $this->assertEqualsCanonicalizing(
            [$this->admin->id, $superadmin->id, $secondAdmin->id],
            $notified->all(),
        );
        $this->assertNotContains($inactiveAdmin->id, $notified->all());
        $this->assertNotContains($nurse->id, $notified->all());
    }
}
