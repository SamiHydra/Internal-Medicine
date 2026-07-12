<?php

namespace Tests\Feature;

use App\Models\DutyAssignment;
use App\Models\DutyType;
use App\Models\RotationCalendar;
use App\Models\Section;
use App\Models\User;
use App\Models\Ward;
use App\Services\Academic\RosterService;
use App\Services\Academic\RotationCalendarService;
use Database\Seeders\RoleSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Illuminate\Validation\ValidationException;
use Tests\TestCase;

class RosterTest extends TestCase
{
    use RefreshDatabase;

    private RosterService $roster;

    private RotationCalendarService $calendars;

    private User $admin;

    protected function setUp(): void
    {
        parent::setUp();

        $this->seed(RoleSeeder::class);

        $this->roster = app(RosterService::class);
        $this->calendars = app(RotationCalendarService::class);
        $this->admin = User::factory()->role('admin', 'Administrator')->create();
    }

    private function dutyType(string $slug): DutyType
    {
        // The duty-type catalog is created by the seed_academic_structure data
        // migration, so it exists in every freshly migrated test database.
        return DutyType::query()->where('slug', $slug)->firstOrFail();
    }

    private function assign(User $user, string $dutyTypeSlug, string $from, string $to): DutyAssignment
    {
        return $this->roster->createAssignment(
            $user,
            $this->dutyType($dutyTypeSlug),
            Carbon::parse($from),
            Carbon::parse($to),
            'admin',
            $this->admin,
        );
    }

    // ---- Pairing keys ----

    public function test_pairing_keys_for_ward_service_opd_dialysis_and_leave(): void
    {
        $resident = User::factory()->role('resident', 'Resident')->create();
        $date = Carbon::parse('2026-07-10');

        $this->assign($resident, 'nephrology_ward_service', '2026-07-01', '2026-07-31');
        $wardId = $this->dutyType('nephrology_ward_service')->ward_id;
        $this->assertSame(['ward:'.$wardId], $this->roster->pairingKeysFor($resident, $date));

        $opdResident = User::factory()->role('resident', 'Resident')->create();
        $this->assign($opdResident, 'opd', '2026-07-01', '2026-07-31');
        $this->assertSame(['group:opd'], $this->roster->pairingKeysFor($opdResident, $date));

        $dialysisConsultant = User::factory()->role('consultant', 'Consultant')->create();
        $this->assign($dialysisConsultant, 'dialysis', '2026-07-01', '2026-07-31');
        $this->assertSame([], $this->roster->pairingKeysFor($dialysisConsultant, $date));

        $onLeave = User::factory()->role('resident', 'Resident')->create();
        $this->assign($onLeave, 'annual_leave', '2026-07-01', '2026-07-31');
        $this->assertSame([], $this->roster->pairingKeysFor($onLeave, $date));
    }

    public function test_transition_duty_pairs_only_on_shared_days(): void
    {
        $first = User::factory()->role('consultant', 'Consultant')->create();
        $second = User::factory()->role('consultant', 'Consultant')->create();

        $this->assign($first, 'transition_ward_duty', '2026-07-10', '2026-07-10');
        $this->assign($second, 'transition_ward_duty', '2026-07-10', '2026-07-10');
        $this->assertTrue($this->roster->canPair($first, $second, Carbon::parse('2026-07-10')));

        $third = User::factory()->role('consultant', 'Consultant')->create();
        $this->assign($third, 'transition_ward_duty', '2026-07-11', '2026-07-11');
        $this->assertFalse($this->roster->canPair($first, $third, Carbon::parse('2026-07-10')));
        $this->assertFalse($this->roster->canPair($first, $third, Carbon::parse('2026-07-11')));
    }

    public function test_can_pair_is_false_when_dates_do_not_overlap_despite_matching_ward(): void
    {
        $resident = User::factory()->role('resident', 'Resident')->create();
        $consultant = User::factory()->role('consultant', 'Consultant')->create();

        $this->assign($resident, 'pulmonology_ward_service', '2026-07-01', '2026-07-31');
        $this->assign($consultant, 'pulmonology_ward_service', '2026-08-01', '2026-08-31');

        $this->assertFalse($this->roster->canPair($resident, $consultant, Carbon::parse('2026-07-15')));
        $this->assertFalse($this->roster->canPair($resident, $consultant, Carbon::parse('2026-08-15')));
    }

    public function test_shared_ward_across_two_sections_pairs_their_people(): void
    {
        // Cardiology and Endocrinology ward services point at the same
        // physical ward, so their holders pair with each other.
        $resident = User::factory()->role('resident', 'Resident')->create();
        $consultant = User::factory()->role('consultant', 'Consultant')->create();

        $this->assign($resident, 'cardiology_ward_service', '2026-07-01', '2026-07-31');
        $this->assign($consultant, 'endocrinology_ward_service', '2026-07-01', '2026-07-31');

        $this->assertTrue($this->roster->canPair($resident, $consultant, Carbon::parse('2026-07-15')));
    }

    public function test_peers_for_returns_only_same_pairing_key_users_of_the_requested_role(): void
    {
        $resident = User::factory()->role('resident', 'Resident')->create();
        $sameWard = User::factory()->role('consultant', 'Consultant')->create();
        $otherWard = User::factory()->role('consultant', 'Consultant')->create();
        $sameWardResident = User::factory()->role('resident', 'Resident')->create();

        $this->assign($resident, 'nephrology_ward_service', '2026-07-01', '2026-07-31');
        $this->assign($sameWard, 'nephrology_ward_service', '2026-07-01', '2026-07-31');
        $this->assign($otherWard, 'pulmonology_ward_service', '2026-07-01', '2026-07-31');
        $this->assign($sameWardResident, 'nephrology_ward_service', '2026-07-01', '2026-07-31');

        $peers = $this->roster->peersFor($resident, Carbon::parse('2026-07-15'), 'consultant');

        $this->assertSame([$sameWard->id], $peers->pluck('id')->all());
    }

    public function test_morning_roster_includes_non_pairing_duties_and_excludes_leave_and_external(): void
    {
        $onDialysis = User::factory()->role('consultant', 'Consultant')->create();
        $onLeave = User::factory()->role('consultant', 'Consultant')->create();
        $external = User::factory()->role('resident', 'Resident')->create();
        $onWard = User::factory()->role('resident', 'Resident')->create();
        $unassigned = User::factory()->role('resident', 'Resident')->create();

        $this->assign($onDialysis, 'dialysis', '2026-07-01', '2026-07-31');
        $this->assign($onLeave, 'annual_leave', '2026-07-01', '2026-07-31');
        $this->assign($external, 'icu', '2026-07-01', '2026-07-31');
        $this->assign($onWard, 'oncology_ward_service', '2026-07-01', '2026-07-31');

        $roster = $this->roster->morningRosterOn(Carbon::parse('2026-07-10'))->pluck('id');

        $this->assertTrue($roster->contains($onDialysis->id));
        $this->assertTrue($roster->contains($onWard->id));
        $this->assertFalse($roster->contains($onLeave->id));
        $this->assertFalse($roster->contains($external->id));
        $this->assertFalse($roster->contains($unassigned->id));
    }

    // ---- Overlap guard ----

    public function test_overlap_guard_rejects_second_monthly_assignment_but_accepts_stacked_daily(): void
    {
        $consultant = User::factory()->role('consultant', 'Consultant')->create();

        $this->assign($consultant, 'nephrology_ward_service', '2026-07-01', '2026-07-31');

        try {
            $this->assign($consultant, 'dialysis', '2026-07-15', '2026-08-14');
            $this->fail('Expected the monthly overlap guard to reject the second assignment.');
        } catch (ValidationException $exception) {
            $this->assertArrayHasKey('startsOn', $exception->errors());
        }

        // A day-level duty stacks legitimately on top of the service month.
        $daily = $this->assign($consultant, 'transition_ward_duty', '2026-07-15', '2026-07-15');
        $this->assertDatabaseHas('duty_assignments', ['id' => $daily->id]);
    }

    // ---- Rotation calendars ----

    public function test_fixed_weeks_calendar_generates_contiguous_blocks(): void
    {
        $calendar = $this->calendars->createCalendar(3, '2026/27', Carbon::parse('2026-09-14'), 'fixed_weeks', 8, 6);

        $blocks = $calendar->blocks;
        $this->assertCount(6, $blocks);

        foreach ($blocks as $index => $block) {
            $this->assertSame(56, (int) Carbon::parse($block->starts_on)->diffInDays(Carbon::parse($block->ends_on)) + 1);

            if ($index > 0) {
                $previous = $blocks[$index - 1];
                $this->assertSame(
                    Carbon::parse($previous->ends_on)->addDay()->toDateString(),
                    Carbon::parse($block->starts_on)->toDateString(),
                    'Year 3 blocks must be back-to-back with no gap.',
                );
            }
        }
    }

    public function test_calendar_month_blocks_align_to_month_boundaries(): void
    {
        $calendar = $this->calendars->createCalendar(1, '2026/27', Carbon::parse('2026-09-01'), 'calendar_month', null, 4);

        $blocks = $calendar->blocks;
        $this->assertCount(4, $blocks);
        $this->assertSame('2026-09-01', $blocks[0]->starts_on->toDateString());
        $this->assertSame('2026-09-30', $blocks[0]->ends_on->toDateString());
        $this->assertSame('2026-10-01', $blocks[1]->starts_on->toDateString());
        $this->assertSame('2026-12-31', $blocks[3]->ends_on->toDateString());
    }

    public function test_current_block_and_next_boundary(): void
    {
        $this->calendars->createCalendar(2, '2026/27', Carbon::parse('2026-09-01'), 'calendar_month', null, 12);

        $block = $this->calendars->currentBlockFor(2, Carbon::parse('2026-11-15'));
        $this->assertNotNull($block);
        $this->assertSame('2026-11-01', $block->starts_on->toDateString());

        $this->assertSame(
            '2026-12-01',
            $this->calendars->nextBoundaryAfter(Carbon::parse('2026-11-15'))->toDateString(),
        );
    }

    // ---- Admin API + authorization ----

    public function test_admin_can_manage_structure_through_the_api_and_audit_rows_are_written(): void
    {
        $ward = $this->actingAs($this->admin)
            ->postJson('/api/admin/academic/wards', ['name' => 'New Teaching Ward'])
            ->assertCreated()
            ->json();

        $section = $this->actingAs($this->admin)
            ->postJson('/api/admin/academic/sections', ['name' => 'Rheumatology'])
            ->assertCreated()
            ->json();

        $this->actingAs($this->admin)
            ->postJson('/api/admin/academic/duty-types', [
                'name' => 'Rheumatology Ward Service',
                'sectionId' => $section['id'],
                'wardId' => $ward['id'],
                'category' => 'ward_service',
                'granularity' => 'monthly',
                'pairsForEvaluation' => true,
            ])
            ->assertCreated()
            ->assertJsonPath('wardName', 'New Teaching Ward');

        $calendar = $this->actingAs($this->admin)
            ->postJson('/api/admin/rotations/calendars', [
                'trainingYear' => 3,
                'academicYearLabel' => '2026/27',
                'startsOn' => '2026-09-14',
                'blockKind' => 'fixed_weeks',
                'blockLengthWeeks' => 8,
                'blocksCount' => 6,
            ])
            ->assertCreated()
            ->json();

        $this->assertCount(6, $calendar['blocks']);

        foreach (['ward', 'section', 'duty_type', 'rotation_calendar'] as $entityType) {
            $this->assertDatabaseHas('admin_audit_logs', [
                'entity_type' => $entityType,
                'action' => 'create',
                'user_id' => $this->admin->id,
            ]);
        }
    }

    public function test_non_admin_roles_are_denied_on_structure_roster_and_rotation_endpoints(): void
    {
        $consultant = User::factory()->role('consultant', 'Consultant')->create();
        $nurse = User::factory()->role('nurse', 'Nurse')->create();

        foreach ([$consultant, $nurse] as $user) {
            $this->actingAs($user)->getJson('/api/admin/academic/wards')->assertForbidden();
            $this->actingAs($user)->postJson('/api/admin/academic/wards', ['name' => 'X'])->assertForbidden();
            $this->actingAs($user)->getJson('/api/admin/rotations/calendars')->assertForbidden();
            $this->actingAs($user)->getJson('/api/admin/roster/2026/7')->assertForbidden();
        }
    }

    public function test_duty_roster_month_read_and_writes(): void
    {
        $consultant = User::factory()->role('consultant', 'Consultant')->create(['full_name' => 'Dr. Roster Target']);

        $nephrologyService = $this->dutyType('nephrology_ward_service');

        $this->actingAs($this->admin)
            ->putJson('/api/admin/roster/2026/7', [
                'assignments' => [
                    ['userId' => $consultant->id, 'dutyTypeId' => $nephrologyService->id],
                ],
            ])
            ->assertOk();

        $this->assertTrue(
            DutyAssignment::query()
                ->where('user_id', $consultant->id)
                ->where('duty_type_id', $nephrologyService->id)
                ->whereDate('starts_on', '2026-07-01')
                ->whereDate('ends_on', '2026-07-31')
                ->exists(),
        );

        // Re-planning the same month replaces rather than rejects.
        $dialysis = $this->dutyType('dialysis');
        $this->actingAs($this->admin)
            ->putJson('/api/admin/roster/2026/7', [
                'assignments' => [
                    ['userId' => $consultant->id, 'dutyTypeId' => $dialysis->id],
                ],
            ])
            ->assertOk();

        $this->assertSame(1, DutyAssignment::query()->where('user_id', $consultant->id)->count());
        $this->assertDatabaseHas('duty_assignments', [
            'user_id' => $consultant->id,
            'duty_type_id' => $dialysis->id,
        ]);

        // Daily strip write + month read surface both granularities.
        $this->actingAs($this->admin)
            ->postJson('/api/admin/roster/daily', [
                'userId' => $consultant->id,
                'dutyTypeId' => $this->dutyType('transition_ward_duty')->id,
                'date' => '2026-07-20',
            ])
            ->assertCreated();

        $month = $this->actingAs($this->admin)->getJson('/api/admin/roster/2026/7')->assertOk()->json();
        $person = collect($month['people'])->firstWhere('id', $consultant->id);

        $this->assertCount(1, $person['monthly']);
        $this->assertCount(1, $person['daily']);

        // A month cell rejects a daily-granularity duty type.
        $this->actingAs($this->admin)
            ->putJson('/api/admin/roster/2026/7', [
                'assignments' => [
                    ['userId' => $consultant->id, 'dutyTypeId' => $this->dutyType('transition_ward_duty')->id],
                ],
            ])
            ->assertStatus(422);
    }

    public function test_workspace_bootstrap_carries_placement_and_setup_signals(): void
    {
        $resident = User::factory()->role('resident', 'Resident')->create();
        $this->assign($resident, 'oncology_ward_service', now()->startOfMonth()->toDateString(), now()->endOfMonth()->toDateString());

        $academic = $this->actingAs($resident)->getJson('/api/workspace')->assertOk()->json('academic');
        $this->assertSame('Oncology Ward Service', $academic['currentPlacement']['dutyTypeName']);
        $this->assertNotNull($academic['currentPlacement']['wardId']);
        $this->assertNull($academic['academicSetup']);

        $unassigned = User::factory()->role('consultant', 'Consultant')->create();
        $adminAcademic = $this->actingAs($this->admin)->getJson('/api/workspace')->assertOk()->json('academic');

        $this->assertTrue($adminAcademic['academicSetup']['calendarsMissing']);
        // The unassigned consultant (no section, no duty) is counted in both signals.
        $this->assertGreaterThanOrEqual(1, $adminAcademic['academicSetup']['consultantsWithoutSection']);
        $this->assertGreaterThanOrEqual(1, $adminAcademic['academicSetup']['peopleWithoutAssignment']);

        $head = User::factory()->role('consultant', 'Consultant')->create();
        Section::query()->where('slug', 'nephrology')->update(['head_user_id' => $head->id]);
        $headAcademic = $this->actingAs($head)->getJson('/api/workspace')->assertOk()->json('academic');
        $this->assertCount(1, $headAcademic['headsSections']);
    }

    public function test_seeded_structure_exists_after_migrations(): void
    {
        $this->assertSame(6, Ward::query()->count());
        $this->assertSame(8, Section::query()->count());
        $this->assertTrue(DutyType::query()->where('slug', 'opd')->where('pairing_group', 'opd')->exists());
        $this->assertTrue(DutyType::query()->where('slug', 'transition_ward_duty')->where('granularity', 'daily')->exists());
        $this->assertSame(
            DutyType::query()->where('slug', 'cardiology_ward_service')->value('ward_id'),
            DutyType::query()->where('slug', 'endocrinology_ward_service')->value('ward_id'),
        );
    }

    // ---- Review-pass regression: carving, not wholesale replacement ----

    public function test_replanning_one_month_carves_a_cross_month_block_instead_of_deleting_it(): void
    {
        $resident = User::factory()->role('resident', 'Resident')->create();

        // A two-month block: July + August.
        $this->assign($resident, 'nephrology_ward_service', '2026-07-01', '2026-08-31');

        // Re-planning AUGUST must not erase the July half of the block.
        $this->roster->bulkAssign([[
            'user_id' => $resident->id,
            'duty_type_id' => $this->dutyType('opd')->id,
            'starts_on' => '2026-08-01',
            'ends_on' => '2026-08-31',
        ]], 'admin', $this->admin);

        $rows = DutyAssignment::query()->where('user_id', $resident->id)->orderBy('starts_on')->get();
        $this->assertCount(2, $rows);
        $this->assertSame('2026-07-01', $rows[0]->starts_on->toDateString());
        $this->assertSame('2026-07-31', $rows[0]->ends_on->toDateString());
        $this->assertSame($this->dutyType('opd')->id, $rows[1]->duty_type_id);

        // Carving a window out of the middle splits the block in two.
        $resident2 = User::factory()->role('resident', 'Resident')->create();
        $this->assign($resident2, 'nephrology_ward_service', '2026-07-01', '2026-09-30');
        $this->roster->carveMonthlyWindow($resident2->id, '2026-08-01', '2026-08-31');

        $pieces = DutyAssignment::query()->where('user_id', $resident2->id)->orderBy('starts_on')->get();
        $this->assertCount(2, $pieces);
        $this->assertSame(['2026-07-01', '2026-07-31'], [$pieces[0]->starts_on->toDateString(), $pieces[0]->ends_on->toDateString()]);
        $this->assertSame(['2026-09-01', '2026-09-30'], [$pieces[1]->starts_on->toDateString(), $pieces[1]->ends_on->toDateString()]);
        $this->assertSame($pieces[0]->duty_type_id, $pieces[1]->duty_type_id);

        // A fully-covered assignment is still simply removed.
        $this->roster->carveMonthlyWindow($resident2->id, '2026-06-01', '2026-10-31');
        $this->assertSame(0, DutyAssignment::query()->where('user_id', $resident2->id)->count());
    }
}
