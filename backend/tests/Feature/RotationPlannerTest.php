<?php

namespace Tests\Feature;

use App\Models\DutyAssignment;
use App\Models\DutyType;
use App\Models\RotationCalendar;
use App\Models\User;
use App\Services\Academic\RotationCalendarService;
use Database\Seeders\RoleSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Tests\TestCase;

class RotationPlannerTest extends TestCase
{
    use RefreshDatabase;

    private User $admin;

    protected function setUp(): void
    {
        parent::setUp();

        $this->seed(RoleSeeder::class);
        $this->admin = User::factory()->role('admin', 'Administrator')->create();
    }

    private function monthCalendar(): RotationCalendar
    {
        return app(RotationCalendarService::class)
            ->createCalendar(1, '2026/27', Carbon::parse('2026-09-01'), 'calendar_month', null, 12);
    }

    private function dutyTypeId(string $slug): string
    {
        return DutyType::query()->where('slug', $slug)->firstOrFail()->id;
    }

    public function test_plan_save_writes_block_aligned_ranges_with_planner_source(): void
    {
        $calendar = $this->monthCalendar();
        $resident = User::factory()->role('resident', 'Resident')->create(['training_year' => 1]);
        $block = $calendar->blocks[1]; // October 2026

        $this->actingAs($this->admin)
            ->postJson("/api/admin/rotations/{$calendar->id}/plan", [
                'assignments' => [
                    ['userId' => $resident->id, 'blockId' => $block->id, 'dutyTypeId' => $this->dutyTypeId('nephrology_ward_service')],
                ],
            ])
            ->assertOk();

        $this->assertTrue(
            DutyAssignment::query()
                ->where('user_id', $resident->id)
                ->where('source', 'rotation_planner')
                ->whereDate('starts_on', '2026-10-01')
                ->whereDate('ends_on', '2026-10-31')
                ->exists(),
        );

        $this->assertDatabaseHas('admin_audit_logs', [
            'entity_type' => 'rotation_calendar',
            'action' => 'save_rotation_plan',
            'entity_id' => $calendar->id,
        ]);
    }

    public function test_replanning_a_cell_replaces_and_clearing_removes(): void
    {
        $calendar = $this->monthCalendar();
        $resident = User::factory()->role('resident', 'Resident')->create(['training_year' => 1]);
        $block = $calendar->blocks[0];

        foreach (['nephrology_ward_service', 'opd'] as $slug) {
            $this->actingAs($this->admin)
                ->postJson("/api/admin/rotations/{$calendar->id}/plan", [
                    'assignments' => [
                        ['userId' => $resident->id, 'blockId' => $block->id, 'dutyTypeId' => $this->dutyTypeId($slug)],
                    ],
                ])
                ->assertOk();
        }

        $this->assertSame(1, DutyAssignment::query()->where('user_id', $resident->id)->count());
        $this->assertSame(
            $this->dutyTypeId('opd'),
            DutyAssignment::query()->where('user_id', $resident->id)->value('duty_type_id'),
        );

        $this->actingAs($this->admin)
            ->postJson("/api/admin/rotations/{$calendar->id}/plan", [
                'assignments' => [
                    ['userId' => $resident->id, 'blockId' => $block->id, 'dutyTypeId' => null],
                ],
            ])
            ->assertOk();

        $this->assertSame(0, DutyAssignment::query()->where('user_id', $resident->id)->count());
    }

    public function test_group_plan_expands_to_every_member_of_the_rotation_group(): void
    {
        $calendar = app(RotationCalendarService::class)
            ->createCalendar(3, '2026/27', Carbon::parse('2026-09-14'), 'fixed_weeks', 8, 6);

        $groupA = User::factory()->role('resident', 'Resident')->count(2)->create([
            'training_year' => 3,
            'rotation_group' => 'A',
        ]);
        $groupB = User::factory()->role('resident', 'Resident')->create([
            'training_year' => 3,
            'rotation_group' => 'B',
        ]);

        $block = $calendar->blocks[0];

        $this->actingAs($this->admin)
            ->postJson("/api/admin/rotations/{$calendar->id}/plan", [
                'groupPlan' => [
                    ['rotationGroup' => 'A', 'blockId' => $block->id, 'dutyTypeId' => $this->dutyTypeId('opd')],
                ],
            ])
            ->assertOk();

        foreach ($groupA as $member) {
            $this->assertTrue(
                DutyAssignment::query()
                    ->where('user_id', $member->id)
                    ->whereDate('starts_on', $block->starts_on->toDateString())
                    ->whereDate('ends_on', $block->ends_on->toDateString())
                    ->exists(),
            );
        }

        $this->assertSame(0, DutyAssignment::query()->where('user_id', $groupB->id)->count());
    }

    public function test_plan_matrix_lists_only_the_calendar_training_year_and_current_cells(): void
    {
        $calendar = $this->monthCalendar();
        $yearOne = User::factory()->role('resident', 'Resident')->create(['training_year' => 1]);
        User::factory()->role('resident', 'Resident')->create(['training_year' => 2]);

        $block = $calendar->blocks[0];
        $this->actingAs($this->admin)
            ->postJson("/api/admin/rotations/{$calendar->id}/plan", [
                'assignments' => [
                    ['userId' => $yearOne->id, 'blockId' => $block->id, 'dutyTypeId' => $this->dutyTypeId('opd')],
                ],
            ])
            ->assertOk();

        $plan = $this->actingAs($this->admin)
            ->getJson("/api/admin/rotations/{$calendar->id}/plan")
            ->assertOk()
            ->json();

        $this->assertCount(1, $plan['residents']);
        $this->assertSame($yearOne->id, $plan['residents'][0]['id']);
        $this->assertCount(1, $plan['assignments']);
        $this->assertSame($block->id, $plan['assignments'][0]['blockId']);

        // Monthly duty types only in the pickers.
        $this->assertNotContains(
            'daily',
            collect($plan['dutyTypes'])->pluck('granularity')->filter()->all(),
        );
    }

    public function test_planner_rejects_daily_duty_types_and_foreign_blocks(): void
    {
        $calendar = $this->monthCalendar();
        $other = app(RotationCalendarService::class)
            ->createCalendar(2, '2026/27', Carbon::parse('2026-09-01'), 'calendar_month', null, 12);
        $resident = User::factory()->role('resident', 'Resident')->create(['training_year' => 1]);

        $this->actingAs($this->admin)
            ->postJson("/api/admin/rotations/{$calendar->id}/plan", [
                'assignments' => [
                    ['userId' => $resident->id, 'blockId' => $calendar->blocks[0]->id, 'dutyTypeId' => $this->dutyTypeId('transition_ward_duty')],
                ],
            ])
            ->assertStatus(422);

        $this->actingAs($this->admin)
            ->postJson("/api/admin/rotations/{$calendar->id}/plan", [
                'assignments' => [
                    ['userId' => $resident->id, 'blockId' => $other->blocks[0]->id, 'dutyTypeId' => $this->dutyTypeId('opd')],
                ],
            ])
            ->assertStatus(422);
    }

    public function test_non_admin_roles_cannot_reach_the_planner(): void
    {
        $calendar = $this->monthCalendar();

        foreach (['consultant', 'nurse', 'resident'] as $role) {
            $user = User::factory()->role($role, ucfirst($role))->create();
            $this->actingAs($user)->getJson("/api/admin/rotations/{$calendar->id}/plan")->assertForbidden();
        }
    }
}
