<?php

namespace Tests\Feature;

use App\Models\DutyAssignment;
use App\Models\DutyType;
use App\Models\Section;
use App\Models\TransferRequest;
use App\Models\User;
use Database\Seeders\RoleSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
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
