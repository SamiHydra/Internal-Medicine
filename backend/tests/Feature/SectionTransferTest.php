<?php

namespace Tests\Feature;

use App\Models\DutyAssignment;
use App\Models\DutyType;
use App\Models\Section;
use App\Models\TransferRequest;
use App\Models\User;
use App\Services\Academic\TransferService;
use App\Services\Admin\AdminAuditService;
use Database\Seeders\RoleSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;
use Mockery\MockInterface;
use Tests\TestCase;

class SectionTransferTest extends TestCase
{
    use RefreshDatabase;

    private User $admin;

    private User $consultant;

    private User $destinationHead;

    private Section $nephrology;

    private Section $cardiology;

    protected function setUp(): void
    {
        parent::setUp();

        $this->seed(RoleSeeder::class);
        $this->travelTo(Carbon::parse('2026-07-15 09:00:00'));

        $this->admin = User::factory()->role('admin', 'Administrator')->create();

        $this->nephrology = Section::query()->where('slug', 'nephrology')->firstOrFail();
        $this->cardiology = Section::query()->where('slug', 'cardiology')->firstOrFail();

        $this->consultant = User::factory()->role('consultant', 'Consultant')->create([
            'section_id' => $this->nephrology->id,
        ]);
        $this->destinationHead = User::factory()->role('consultant', 'Consultant')->create([
            'section_id' => $this->cardiology->id,
        ]);
        $this->cardiology->forceFill(['head_user_id' => $this->destinationHead->id])->save();
    }

    protected function tearDown(): void
    {
        $this->travelBack();

        parent::tearDown();
    }

    private function fileRequest(): TransferRequest
    {
        $response = $this->actingAs($this->consultant)
            ->postJson('/api/academic/transfer-requests', [
                'toSectionId' => $this->cardiology->id,
                'reason' => 'Subspecialty interest.',
            ])
            ->assertCreated();

        return TransferRequest::query()->findOrFail($response->json('id'));
    }

    public function test_consultant_files_a_request_and_the_destination_head_is_notified(): void
    {
        $request = $this->fileRequest();

        $this->assertSame('pending', $request->status);
        $this->assertSame($this->nephrology->id, $request->from_section_id);

        $this->assertDatabaseHas('notifications', [
            'recipient_id' => $this->destinationHead->id,
            'type' => 'transfer_requested',
            'related_id' => $request->id,
        ]);
    }

    public function test_duplicate_pending_request_and_same_section_request_are_rejected(): void
    {
        $this->fileRequest();

        $this->actingAs($this->consultant)
            ->postJson('/api/academic/transfer-requests', ['toSectionId' => $this->cardiology->id])
            ->assertStatus(422);

        $other = User::factory()->role('consultant', 'Consultant')->create([
            'section_id' => $this->cardiology->id,
        ]);

        $this->actingAs($other)
            ->postJson('/api/academic/transfer-requests', ['toSectionId' => $this->cardiology->id])
            ->assertStatus(422);
    }

    public function test_consultant_without_a_section_cannot_file(): void
    {
        $unplaced = User::factory()->role('consultant', 'Consultant')->create(['section_id' => null]);

        $this->actingAs($unplaced)
            ->postJson('/api/academic/transfer-requests', ['toSectionId' => $this->cardiology->id])
            ->assertStatus(422);
    }

    public function test_only_the_destination_head_or_an_admin_can_decide(): void
    {
        $request = $this->fileRequest();

        // A consultant who heads nothing is inside the coarse permission but
        // outside the policy.
        $bystander = User::factory()->role('consultant', 'Consultant')->create([
            'section_id' => $this->nephrology->id,
        ]);
        $this->actingAs($bystander)
            ->postJson("/api/admin/transfer-requests/{$request->id}/approve")
            ->assertForbidden();

        // The ORIGIN head has no approval authority either; the destination
        // accepts the member.
        $originHead = User::factory()->role('consultant', 'Consultant')->create([
            'section_id' => $this->nephrology->id,
        ]);
        $this->nephrology->forceFill(['head_user_id' => $originHead->id])->save();
        $this->actingAs($originHead)
            ->postJson("/api/admin/transfer-requests/{$request->id}/approve")
            ->assertForbidden();

        $this->actingAs($this->destinationHead)
            ->postJson("/api/admin/transfer-requests/{$request->id}/approve")
            ->assertOk();
    }

    public function test_approval_defaults_to_the_next_month_boundary(): void
    {
        $request = $this->fileRequest();

        $this->actingAs($this->destinationHead)
            ->postJson("/api/admin/transfer-requests/{$request->id}/approve")
            ->assertOk()
            ->assertJsonPath('status', 'approved')
            ->assertJsonPath('effectiveOn', '2026-08-01');

        // Not applied yet: the consultant still belongs to the origin section.
        $this->assertSame($this->nephrology->id, $this->consultant->refresh()->section_id);
        $this->assertNull($request->refresh()->applied_at);

        $this->assertDatabaseHas('admin_audit_logs', [
            'entity_type' => 'transfer_request',
            'action' => 'approve',
            'entity_id' => $request->id,
        ]);
    }

    public function test_admin_immediate_override_applies_inline_and_closes_the_old_ward_month(): void
    {
        // The consultant is serving a Nephrology ward month that the transfer
        // must truncate to the day before it takes effect.
        $wardService = DutyType::query()->where('slug', 'nephrology_ward_service')->firstOrFail();
        $assignment = DutyAssignment::query()->create([
            'user_id' => $this->consultant->id,
            'duty_type_id' => $wardService->id,
            'starts_on' => '2026-07-01',
            'ends_on' => '2026-07-31',
            'source' => 'admin',
            'created_by' => $this->admin->id,
        ]);

        $request = $this->fileRequest();

        $this->actingAs($this->admin)
            ->postJson("/api/admin/transfer-requests/{$request->id}/approve", ['immediate' => true])
            ->assertOk()
            ->assertJsonPath('status', 'approved')
            ->assertJsonPath('effectiveOn', '2026-07-15');

        $this->assertSame($this->cardiology->id, $this->consultant->refresh()->section_id);
        $this->assertNotNull($request->refresh()->applied_at);
        $this->assertSame('2026-07-14', $assignment->refresh()->ends_on->toDateString());

        // Requester and both heads are told the move happened.
        $this->assertDatabaseHas('notifications', [
            'recipient_id' => $this->consultant->id,
            'type' => 'transfer_applied',
        ]);
        $this->assertDatabaseHas('notifications', [
            'recipient_id' => $this->destinationHead->id,
            'type' => 'transfer_applied',
        ]);
    }

    public function test_rejection_notifies_the_requester_and_writes_an_audit_row(): void
    {
        $request = $this->fileRequest();

        $this->actingAs($this->destinationHead)
            ->postJson("/api/admin/transfer-requests/{$request->id}/reject")
            ->assertOk()
            ->assertJsonPath('status', 'rejected');

        $this->assertDatabaseHas('notifications', [
            'recipient_id' => $this->consultant->id,
            'type' => 'transfer_decided',
        ]);
        $this->assertDatabaseHas('admin_audit_logs', [
            'entity_type' => 'transfer_request',
            'action' => 'reject',
            'entity_id' => $request->id,
        ]);
    }

    public function test_only_the_owner_can_cancel_and_only_while_pending(): void
    {
        $request = $this->fileRequest();

        $other = User::factory()->role('consultant', 'Consultant')->create([
            'section_id' => $this->nephrology->id,
        ]);

        $this->actingAs($other)
            ->postJson("/api/academic/transfer-requests/{$request->id}/cancel")
            ->assertForbidden();

        $this->actingAs($this->consultant)
            ->postJson("/api/academic/transfer-requests/{$request->id}/cancel")
            ->assertOk()
            ->assertJsonPath('status', 'cancelled');

        // A decided request can no longer be cancelled.
        $this->actingAs($this->consultant)
            ->postJson("/api/academic/transfer-requests/{$request->id}/cancel")
            ->assertForbidden();
    }

    public function test_scheduled_command_applies_due_transfers_exactly_once(): void
    {
        $request = $this->fileRequest();

        $this->actingAs($this->destinationHead)
            ->postJson("/api/admin/transfer-requests/{$request->id}/approve", ['effectiveOn' => '2026-07-20'])
            ->assertOk();

        // Before the effective date nothing applies.
        $this->artisan('academic:apply-section-transfers')->expectsOutputToContain('applied: 0');
        $this->assertSame($this->nephrology->id, $this->consultant->refresh()->section_id);

        $this->travelTo(Carbon::parse('2026-07-20 00:30:00'));

        $this->artisan('academic:apply-section-transfers')->expectsOutputToContain('applied: 1');
        $this->assertSame($this->cardiology->id, $this->consultant->refresh()->section_id);
        $this->assertNotNull($request->refresh()->applied_at);

        // Idempotent: a second run finds nothing.
        $this->artisan('academic:apply-section-transfers')->expectsOutputToContain('applied: 0');
    }

    public function test_retried_transfer_transitions_do_not_duplicate_audits_or_notifications(): void
    {
        $request = $this->fileRequest();
        $service = app(TransferService::class);

        $service->approve($request, $this->destinationHead, Carbon::parse('2026-07-20'));
        $service->approve($request, $this->destinationHead, Carbon::parse('2026-07-20'));

        $this->assertSame(1, DB::table('admin_audit_logs')
            ->where('entity_type', 'transfer_request')
            ->where('entity_id', $request->id)
            ->where('action', 'approve')
            ->count());
        $this->assertSame(1, DB::table('notifications')
            ->where('related_id', $request->id)
            ->where('type', 'transfer_decided')
            ->count());

        $this->travelTo(Carbon::parse('2026-07-20 00:30:00'));

        // The original date is now in the past, but this is a retry of an
        // already-committed decision, not a new invalid approval.
        $service->approve($request, $this->destinationHead, Carbon::parse('2026-07-20'));
        $this->assertTrue($service->apply($request));
        $this->assertFalse($service->apply($request));
        $this->assertSame(1, DB::table('admin_audit_logs')
            ->where('entity_type', 'transfer_request')
            ->where('entity_id', $request->id)
            ->where('action', 'apply')
            ->count());

        foreach (DB::table('notifications')->where('related_id', $request->id)->where('type', 'transfer_applied')->pluck('recipient_id')->countBy() as $count) {
            $this->assertSame(1, $count);
        }
    }

    public function test_reject_and_cancel_retries_are_idempotent_and_conflicting_decisions_fail(): void
    {
        $service = app(TransferService::class);
        $rejected = $this->fileRequest();

        $service->reject($rejected, $this->destinationHead);
        $service->reject($rejected, $this->destinationHead);

        $this->assertSame(1, DB::table('admin_audit_logs')
            ->where('entity_id', $rejected->id)
            ->where('action', 'reject')
            ->count());
        $this->assertSame(1, DB::table('notifications')
            ->where('related_id', $rejected->id)
            ->where('type', 'transfer_decided')
            ->count());

        try {
            $service->approve($rejected, $this->destinationHead, Carbon::parse('2026-07-20'));
            $this->fail('A rejected request was approved by a stale caller.');
        } catch (ValidationException $exception) {
            $this->assertArrayHasKey('request', $exception->errors());
        }

        $cancelled = $service->request($this->consultant->refresh(), $this->cardiology->refresh(), null);
        $service->cancel($cancelled, $this->consultant);
        $service->cancel($cancelled, $this->consultant);

        $this->assertSame('cancelled', $cancelled->refresh()->status);

        // The retry must not double-write, same as reject above.
        $this->assertSame(1, DB::table('admin_audit_logs')
            ->where('entity_id', $cancelled->id)
            ->where('action', 'cancel')
            ->count());
    }

    public function test_transfer_state_and_side_effects_roll_back_together(): void
    {
        $request = $this->fileRequest();

        $this->mock(AdminAuditService::class, function (MockInterface $mock): void {
            $mock->shouldReceive('record')->once()->andThrow(new \RuntimeException('Simulated audit failure.'));
        });

        try {
            app(TransferService::class)->approve($request, $this->destinationHead, Carbon::parse('2026-07-20'));
            $this->fail('The simulated audit failure should abort the transfer transaction.');
        } catch (\RuntimeException $exception) {
            $this->assertSame('Simulated audit failure.', $exception->getMessage());
        }

        $request->refresh();
        $this->assertSame('pending', $request->status);
        $this->assertNull($request->decided_at);
        $this->assertSame(0, DB::table('notifications')
            ->where('related_id', $request->id)
            ->where('type', 'transfer_decided')
            ->count());
    }

    public function test_head_review_queue_is_scoped_and_workspace_carries_the_pending_count(): void
    {
        $request = $this->fileRequest();

        $queue = $this->actingAs($this->destinationHead)
            ->getJson('/api/admin/transfer-requests?status=pending')
            ->assertOk()
            ->json('data');

        $this->assertCount(1, $queue);
        $this->assertSame($request->id, $queue[0]['id']);

        // A head of an untouched section sees an empty queue.
        $pulmonology = Section::query()->where('slug', 'pulmonology')->firstOrFail();
        $otherHead = User::factory()->role('consultant', 'Consultant')->create([
            'section_id' => $pulmonology->id,
        ]);
        $pulmonology->forceFill(['head_user_id' => $otherHead->id])->save();

        $this->assertCount(
            0,
            $this->actingAs($otherHead)->getJson('/api/admin/transfer-requests?status=pending')->json('data'),
        );

        $headAcademic = $this->actingAs($this->destinationHead)->getJson('/api/workspace')->json('academic');
        $this->assertSame(1, $headAcademic['pendingTransferCount']);

        $adminAcademic = $this->actingAs($this->admin)->getJson('/api/workspace')->json('academic');
        $this->assertSame(1, $adminAcademic['pendingTransferCount']);
    }

    public function test_admin_can_set_a_consultant_section_directly(): void
    {
        $this->actingAs($this->admin)
            ->postJson("/api/admin/academic/sections/{$this->cardiology->id}/set-consultant", [
                'userId' => $this->consultant->id,
            ])
            ->assertOk();

        $this->assertSame($this->cardiology->id, $this->consultant->refresh()->section_id);

        $this->assertDatabaseHas('admin_audit_logs', [
            'entity_type' => 'section',
            'action' => 'set_consultant_section',
        ]);

        // A nurse (or any non-roster role) is denied.
        $nurse = User::factory()->role('nurse', 'Nurse')->create();
        $this->actingAs($nurse)
            ->postJson("/api/admin/academic/sections/{$this->cardiology->id}/set-consultant", [
                'userId' => $this->consultant->id,
            ])
            ->assertForbidden();
    }
}
