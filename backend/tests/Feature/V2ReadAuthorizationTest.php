<?php

namespace Tests\Feature;

use App\Models\AppSetting;
use App\Models\RepAssignment;
use App\Models\Section;
use App\Models\Student;
use App\Models\StudentBatch;
use App\Models\TeachingSession;
use App\Models\TransferRequest;
use App\Models\User;
use Database\Seeders\RoleSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Cache;
use Tests\TestCase;

class V2ReadAuthorizationTest extends TestCase
{
    use RefreshDatabase;

    private User $admin;

    protected function setUp(): void
    {
        parent::setUp();

        $this->seed(RoleSeeder::class);
        $this->travelTo(Carbon::parse('2026-09-14 08:00:00'));
        $this->admin = User::factory()->role('admin', 'Administrator')->create();
    }

    protected function tearDown(): void
    {
        $this->travelBack();

        parent::tearDown();
    }

    public function test_morning_today_rejects_users_without_the_coarse_permission(): void
    {
        $nurse = User::factory()->role('nurse', 'Nurse')->create();

        $this->actingAs($nurse)
            ->getJson('/api/academic/morning-sessions/today')
            ->assertForbidden();

        $this->assertDatabaseCount('morning_sessions', 0);
    }

    public function test_morning_today_gives_non_designated_academics_a_safe_state_without_lazy_open(): void
    {
        $recorder = User::factory()->role('resident', 'Resident')->create();
        $this->setMorningRecorders([$recorder->id]);

        foreach (['resident', 'consultant'] as $role) {
            $bystander = User::factory()->role($role, ucfirst($role))->create();

            $this->actingAs($bystander)
                ->getJson('/api/academic/morning-sessions/today')
                ->assertOk()
                ->assertJsonPath('session', null)
                ->assertJsonPath('isSessionDay', true)
                ->assertJsonPath('canRecord', false);
        }

        $this->assertDatabaseCount('morning_sessions', 0);
    }

    public function test_morning_today_allows_the_designated_recorder_to_open_and_read_the_roster(): void
    {
        $recorder = User::factory()->role('resident', 'Resident')->create();
        $this->setMorningRecorders([$recorder->id]);

        $this->actingAs($recorder)
            ->getJson('/api/academic/morning-sessions/today')
            ->assertOk()
            ->assertJsonPath('isSessionDay', true)
            ->assertJsonPath('canRecord', true)
            ->assertJsonStructure(['session' => ['id', 'people']]);

        $this->assertDatabaseCount('morning_sessions', 1);
    }

    public function test_teaching_my_sessions_requires_permission_and_an_active_scoped_assignment(): void
    {
        $batch = $this->makeBatch('C1', 'C1 2026-A');
        $otherBatch = $this->makeBatch('C1', 'C1 2026-B');

        $lecture = $this->makeTeachingSession($batch, 'lecture');
        $this->makeTeachingSession($batch, 'bedside', 'A');
        $this->makeTeachingSession($otherBatch, 'lecture');

        $consultant = User::factory()->role('consultant', 'Consultant')->create();
        $this->actingAs($consultant)
            ->getJson('/api/teaching/my-sessions')
            ->assertForbidden();

        $unassignedRep = User::factory()->role('student_rep', 'Student representative')->create();
        $this->actingAs($unassignedRep)
            ->getJson('/api/teaching/my-sessions')
            ->assertForbidden();

        $groupRep = User::factory()->role('student_rep', 'Student representative')->create();
        RepAssignment::query()->create([
            'user_id' => $groupRep->id,
            'batch_id' => $batch->id,
            'scope' => 'group',
            'active' => true,
        ]);

        $response = $this->actingAs($groupRep)
            ->getJson('/api/teaching/my-sessions')
            ->assertOk()
            ->assertJsonPath('scope.scope', 'group')
            ->json('data');

        $this->assertSame([$lecture->id], array_column($response, 'id'));
    }

    public function test_teaching_today_requires_permission_and_allows_an_active_consultant(): void
    {
        $batch = $this->makeBatch('C1', 'C1 2026-A');
        $session = $this->makeTeachingSession($batch, 'lecture');
        $student = Student::query()->create([
            'batch_id' => $batch->id,
            'full_name' => 'Student One',
            'subgroup' => 'A',
        ]);

        $rep = User::factory()->role('student_rep', 'Student representative')->create();
        $this->actingAs($rep)
            ->getJson('/api/teaching/today')
            ->assertForbidden();

        $consultant = User::factory()->role('consultant', 'Consultant')->create();
        $data = $this->actingAs($consultant)
            ->getJson('/api/teaching/today')
            ->assertOk()
            ->json('data');

        $this->assertSame($session->id, $data[0]['id']);
        $this->assertSame([$student->id], array_column($data[0]['roster'], 'id'));
    }

    public function test_transfer_mine_requires_permission_and_returns_only_the_owner_requests(): void
    {
        $from = Section::query()->where('slug', 'nephrology')->firstOrFail();
        $to = Section::query()->where('slug', 'cardiology')->firstOrFail();
        $owner = User::factory()->role('consultant', 'Consultant')->create(['section_id' => $from->id]);
        $other = User::factory()->role('consultant', 'Consultant')->create(['section_id' => $from->id]);

        $ownersRequest = $this->makeTransferRequest($owner, $from, $to);
        $this->makeTransferRequest($other, $from, $to);

        $nurse = User::factory()->role('nurse', 'Nurse')->create();
        $this->actingAs($nurse)
            ->getJson('/api/academic/transfer-requests/mine')
            ->assertForbidden();

        $data = $this->actingAs($owner)
            ->getJson('/api/academic/transfer-requests/mine')
            ->assertOk()
            ->json('data');

        $this->assertSame([$ownersRequest->id], array_column($data, 'id'));
    }

    /** @param list<string> $recorderIds */
    private function setMorningRecorders(array $recorderIds): void
    {
        AppSetting::query()->updateOrCreate(
            ['setting_key' => 'academic_morning'],
            ['value_json' => [
                'session_days' => [1, 3, 5],
                'session_time' => '08:00',
                'recorder_ids' => $recorderIds,
            ], 'updated_by' => $this->admin->id],
        );
        Cache::forget('app-settings:structured:v2');
    }

    private function makeBatch(string $cohort, string $label): StudentBatch
    {
        return StudentBatch::query()->create([
            'cohort' => $cohort,
            'label' => $label,
            'starts_on' => '2026-09-14',
            'ends_on' => '2026-12-06',
        ]);
    }

    private function makeTeachingSession(
        StudentBatch $batch,
        string $activityType,
        ?string $subgroup = null,
    ): TeachingSession {
        return TeachingSession::query()->create([
            'batch_id' => $batch->id,
            'subgroup' => $subgroup,
            'activity_type' => $activityType,
            'scheduled_date' => '2026-09-14',
            'status' => 'pending',
        ]);
    }

    private function makeTransferRequest(User $user, Section $from, Section $to): TransferRequest
    {
        return TransferRequest::query()->create([
            'user_id' => $user->id,
            'from_section_id' => $from->id,
            'to_section_id' => $to->id,
            'status' => 'pending',
        ]);
    }
}
