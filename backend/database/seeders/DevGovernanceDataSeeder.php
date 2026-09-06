<?php

namespace Database\Seeders;

use App\Models\AccessRequest;
use App\Models\AccessRequestItem;
use App\Models\AdminAccessRequest;
use App\Models\AdminAuditLog;
use App\Models\AuditLog;
use App\Models\Department;
use App\Models\Report;
use App\Models\ReportFieldDefinition;
use App\Models\Section;
use App\Models\StudentBatch;
use App\Models\TransferRequest;
use App\Models\User;
use App\Models\Ward;
use Illuminate\Database\Seeder;
use Illuminate\Support\Carbon;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;

/**
 * LOCAL-ONLY governance data: the audit trails and the approval queues.
 *
 * Everything else in the dev fixture describes what the hospital DID; this
 * describes what the administrators did about it, and what is still sitting on
 * their desk. Without it the audit screens are empty and every approval queue
 * reads "nothing to review", which hides a whole class of the product.
 *
 * Two distinct trails are seeded, because the app keeps them apart:
 *  - audit_logs: field-level edits to a submitted clinical report (who changed
 *    which cell, from what, to what);
 *  - admin_audit_logs: administrative actions on users, departments, batches
 *    and requests.
 *
 * Pending work is seeded on BOTH sides: clinical nurses awaiting a ward
 * assignment, academic staff awaiting enrolment, admins awaiting approval, and
 * consultants awaiting a section transfer.
 *
 * Never runs in production or testing.
 */
class DevGovernanceDataSeeder extends Seeder
{
    private const RANDOM_SEED = 20260727;

    private const DEV_PASSWORD = 'StPaul2026!';

    /** Trailing weeks of report edits that leave a field-level audit trail. */
    private const AUDIT_WINDOW_WEEKS = 12;

    /** Field-level edits to raise per edited report. */
    private const EDITS_PER_REPORT = 3;

    public function run(): void
    {
        if (app()->environment('production', 'testing')) {
            return;
        }

        mt_srand(self::RANDOM_SEED);

        $admins = User::query()
            ->whereIn('role_key', ['superadmin', 'admin'])
            ->where('active', true)
            ->orderBy('full_name')
            ->get();

        if ($admins->isEmpty()) {
            $this->command?->warn('No admins found; run DevUserSeeder first.');

            return;
        }

        // Clean slate, so re-running never doubles a queue an admin is meant to
        // work through. Dev only.
        AuditLog::query()->delete();
        AdminAuditLog::query()->delete();
        AccessRequestItem::query()->delete();
        AccessRequest::query()->delete();
        AdminAccessRequest::query()->delete();
        TransferRequest::query()->delete();

        $reportEdits = $this->seedReportAuditTrail();
        $clinical = $this->seedClinicalAccessRequests($admins);
        $academic = $this->seedAcademicEnrolmentRequests();
        $adminRequests = $this->seedAdminAccessRequests();
        $transfers = $this->seedTransferRequests();
        $adminActions = $this->seedAdminAuditTrail($admins);

        $this->command?->info(sprintf(
            'Governance: %d report-field edits, %d admin actions logged.',
            $reportEdits,
            $adminActions,
        ));
        $this->command?->info(sprintf(
            'Pending queues - clinical access: %d, academic enrolment: %d, admin access: %d, section transfers: %d.',
            $clinical,
            $academic,
            $adminRequests,
            $transfers,
        ));
    }

    /**
     * Field-level history for reports that were edited after submission. The
     * report's own status already says an edit happened; this supplies the
     * "what changed" the audit screen exists to answer.
     */
    private function seedReportAuditTrail(): int
    {
        $reports = Report::query()
            ->where('status', 'edited_after_submission')
            ->whereNotNull('submitted_at')
            ->with(['department', 'reportingPeriod'])
            ->latest('submitted_at')
            ->limit(self::AUDIT_WINDOW_WEEKS * 30)
            ->get();

        if ($reports->isEmpty()) {
            return 0;
        }

        $numericFields = ReportFieldDefinition::query()
            ->whereIn('field_kind', ['integer', 'decimal'])
            ->where('active', true)
            ->get()
            ->groupBy('template_id');

        $nurseNames = User::query()
            ->where('role_key', 'nurse')
            ->pluck('full_name', 'id');

        $rows = [];

        foreach ($reports as $report) {
            $fields = $numericFields[$report->template_id] ?? collect();

            if ($fields->isEmpty()) {
                continue;
            }

            $editor = $report->updated_by;
            $editedAt = Carbon::parse($report->submitted_at)->addHours(mt_rand(3, 60));

            for ($i = 0; $i < self::EDITS_PER_REPORT; $i++) {
                $field = $fields[mt_rand(0, $fields->count() - 1)];
                $old = mt_rand(0, 40);
                // A correction is usually small; the occasional big one is the
                // kind of change an auditor actually wants to find.
                $new = max(0, $old + (mt_rand(1, 10) === 1 ? mt_rand(-25, 25) : mt_rand(-4, 4)));

                $rows[] = [
                    'id' => (string) Str::uuid(),
                    'report_id' => $report->id,
                    'field_definition_id' => $field->id,
                    'field_key' => $field->field_key,
                    'day_name' => ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'][mt_rand(0, 4)],
                    'old_value' => (string) $old,
                    'new_value' => (string) $new,
                    'changed_by' => $editor,
                    'changed_by_name' => $nurseNames[$editor] ?? 'Ward staff',
                    // This table carries no timestamps of its own; changed_at is
                    // the only clock it keeps.
                    'changed_at' => $editedAt->copy()->addMinutes($i * mt_rand(5, 90)),
                    'department_id' => $report->department_id,
                    'template_id' => $report->template_id,
                ];
            }
        }

        foreach (array_chunk($rows, 500) as $chunk) {
            AuditLog::query()->insert($chunk);
        }

        return count($rows);
    }

    /**
     * Nurses asking to report for a ward. A few are still waiting (the queue an
     * admin opens the app to clear), the rest are decided history so the
     * reviewed columns are not uniformly empty.
     *
     * @param  Collection<int, User>  $admins
     */
    private function seedClinicalAccessRequests($admins): int
    {
        $departments = Department::query()->where('active', true)->get();
        $nurses = User::query()->where('role_key', 'nurse')->orderBy('full_name')->get();

        if ($departments->isEmpty() || $nurses->isEmpty()) {
            return 0;
        }

        $pending = 0;

        foreach ($nurses->take(9)->values() as $index => $nurse) {
            // First five are the live queue; the rest are settled history.
            $status = $index < 5 ? 'pending' : ($index % 2 === 0 ? 'approved' : 'rejected');
            $requestedAt = now()->subDays(mt_rand(1, $status === 'pending' ? 9 : 120));

            $request = AccessRequest::query()->create([
                'user_id' => $nurse->id,
                'email' => $nurse->email,
                'status' => $status,
                'notes' => $status === 'rejected'
                    ? 'Already covered by the current ward assignment.'
                    : 'Requesting reporting access for the wards below.',
                'requested_at' => $requestedAt,
                'reviewed_at' => $status === 'pending' ? null : $requestedAt->copy()->addDays(mt_rand(1, 4)),
                'reviewed_by' => $status === 'pending' ? null : $admins->random()->id,
            ]);

            // One or two wards per request, as a nurse would actually ask for.
            foreach ($departments->random(min(2, $departments->count())) as $department) {
                AccessRequestItem::query()->create([
                    'access_request_id' => $request->id,
                    'department_id' => $department->id,
                    'template_id' => $department->template_id,
                ]);
            }

            $pending += $status === 'pending' ? 1 : 0;
        }

        return $pending;
    }

    /**
     * Residents and consultants enrolling into the academic module. These carry
     * a hashed password because approval provisions the real account from them.
     */
    private function seedAcademicEnrolmentRequests(): int
    {
        // home_ward_id points at DEPARTMENTS (the inpatient reporting units),
        // not at the academic wards table - same column name, different thing.
        $homeWards = Department::query()
            ->where('active', true)
            ->where('family', 'inpatient')
            ->get();

        $candidates = [
            ['full_name' => 'Dr. Yonas Terefe', 'role' => 'resident', 'year' => 1, 'group' => 'A'],
            ['full_name' => 'Dr. Meaza Alemayehu', 'role' => 'resident', 'year' => 2, 'group' => 'B'],
            ['full_name' => 'Dr. Nahom Bekele', 'role' => 'resident', 'year' => 3, 'group' => 'A'],
            ['full_name' => 'Dr. Frehiwot Assefa', 'role' => 'consultant', 'year' => null, 'group' => null],
            ['full_name' => 'Dr. Solomon Getachew', 'role' => 'consultant', 'year' => null, 'group' => null],
        ];

        foreach ($candidates as $index => $candidate) {
            $handle = strtolower(str_replace([' ', 'dr.'], ['.', ''], trim($candidate['full_name'])));
            $handle = trim(preg_replace('/\.+/', '.', $handle), '.');

            AdminAccessRequest::query()->create([
                'full_name' => $candidate['full_name'],
                'email' => $handle.'@stpaulhospital.demo',
                'username' => $handle,
                'password' => Hash::make(self::DEV_PASSWORD),
                'requested_role' => $candidate['role'],
                'status' => 'pending',
                'home_ward_id' => $homeWards->isEmpty() ? null : $homeWards->random()->id,
                'training_year' => $candidate['year'],
                'rotation_group' => $candidate['group'],
                'notes' => $candidate['role'] === 'resident'
                    ? 'Starting the internal medicine residency this intake.'
                    : 'Joining from the referral hospital; awaiting section placement.',
                'requested_at' => now()->subDays($index + 1),
            ]);
        }

        return count($candidates);
    }

    /** Administrative doctors awaiting approval of a self-signup. */
    private function seedAdminAccessRequests(): int
    {
        $candidates = [
            ['full_name' => 'Dr. Hiwot Mengesha', 'handle' => 'hiwot.mengesha'],
            ['full_name' => 'Dr. Abiy Tesfaye', 'handle' => 'abiy.tesfaye'],
        ];

        foreach ($candidates as $index => $candidate) {
            AdminAccessRequest::query()->create([
                'full_name' => $candidate['full_name'],
                'email' => $candidate['handle'].'@stpaulos.local',
                'username' => $candidate['handle'],
                'password' => Hash::make(self::DEV_PASSWORD),
                'requested_role' => 'admin',
                'status' => 'pending',
                'notes' => 'Quality office; needs administrative access to the reporting platform.',
                'requested_at' => now()->subDays($index + 2),
            ]);
        }

        return count($candidates);
    }

    /**
     * Consultants asking to move section. The academic workspace surfaces a
     * pending count for these, and a section head can only see their own.
     */
    private function seedTransferRequests(): int
    {
        $sections = Section::query()->where('active', true)->orderBy('name')->get();

        if ($sections->count() < 2) {
            return 0;
        }

        $consultants = User::query()
            ->where('role_key', 'consultant')
            ->where('active', true)
            ->whereNotNull('section_id')
            ->orderBy('full_name')
            ->limit(6)
            ->get();

        $pending = 0;

        foreach ($consultants as $index => $consultant) {
            $destination = $sections->firstWhere(fn (Section $section) => $section->id !== $consultant->section_id);

            if ($destination === null) {
                continue;
            }

            // Three still open, the rest already decided, so the history tab is
            // not empty either.
            $status = $index < 3 ? 'pending' : ($index % 2 === 0 ? 'approved' : 'rejected');
            $requestedAt = now()->subDays(mt_rand(2, 40));

            TransferRequest::query()->create([
                'user_id' => $consultant->id,
                'from_section_id' => $consultant->section_id,
                'to_section_id' => $destination->id,
                'reason' => 'Subspecialty interest aligns with the receiving section.',
                'status' => $status,
                'decided_by' => $status === 'pending' ? null : User::query()->where('role_key', 'superadmin')->value('id'),
                'decided_at' => $status === 'pending' ? null : $requestedAt->copy()->addDays(3),
                'effective_on' => now()->addMonth()->startOfMonth()->toDateString(),
                'created_at' => $requestedAt,
                'updated_at' => $requestedAt,
            ]);

            $pending += $status === 'pending' ? 1 : 0;
        }

        return $pending;
    }

    /**
     * The administrative trail: the same actions and entity names the live
     * controllers record, so filtering the audit screen by action or entity
     * behaves exactly as it will in production.
     *
     * @param  Collection<int, User>  $admins
     */
    private function seedAdminAuditTrail($admins): int
    {
        $users = User::query()->inRandomOrder()->limit(40)->get();
        $departments = Department::query()->limit(12)->get();
        $batches = StudentBatch::query()->get();
        $accessRequests = AccessRequest::query()->whereNot('status', 'pending')->get();
        $transfers = TransferRequest::query()->whereNot('status', 'pending')->get();

        $entries = [];

        foreach ($users as $index => $user) {
            $entries[] = [
                'action' => ['create', 'update', 'set_active', 'deactivate'][$index % 4],
                'entity_type' => 'user',
                'entity_id' => $user->id,
                'new_values' => ['full_name' => $user->full_name, 'role_key' => $user->role_key, 'active' => (bool) $user->active],
            ];
        }

        foreach ($departments as $index => $department) {
            $entries[] = [
                'action' => ['update', 'set_active', 'create'][$index % 3],
                'entity_type' => 'department',
                'entity_id' => $department->id,
                'new_values' => ['name' => $department->name, 'family' => $department->family, 'bed_count' => $department->bed_count],
            ];
        }

        foreach ($batches as $index => $batch) {
            $entries[] = [
                'action' => ['create', 'update', 'deactivate'][$index % 3],
                'entity_type' => 'student_batch',
                'entity_id' => $batch->id,
                'new_values' => ['label' => $batch->label, 'cohort' => $batch->cohort, 'active' => (bool) $batch->active],
            ];
        }

        foreach ($accessRequests as $request) {
            $entries[] = [
                'action' => 'review',
                'entity_type' => 'access_request',
                'entity_id' => $request->id,
                'new_values' => ['status' => $request->status],
            ];
        }

        foreach ($transfers as $transfer) {
            $entries[] = [
                'action' => $transfer->status === 'approved' ? 'approve' : 'reject',
                'entity_type' => 'transfer_request',
                'entity_id' => $transfer->id,
                'new_values' => ['status' => $transfer->status],
            ];
        }

        // Settings changes, so the trail is not only about people and wards.
        foreach (['critical_non_zero_fields', 'metric_targets', 'academic_morning'] as $settingKey) {
            $entries[] = [
                'action' => 'update',
                'entity_type' => 'app_setting',
                'entity_id' => $settingKey,
                'new_values' => ['setting_key' => $settingKey],
            ];
        }

        $rows = [];

        foreach ($entries as $index => $entry) {
            $actor = $admins[$index % $admins->count()];
            // Spread across the last quarter, weighted toward recent days so the
            // default (newest-first) view opens on believable activity.
            $createdAt = now()->subMinutes((int) round(mt_rand(30, 60 * 24 * 90) ** 0.9));

            $rows[] = [
                'id' => (string) Str::uuid(),
                'user_id' => $actor->id,
                'user_name' => $actor->full_name,
                'action' => $entry['action'],
                'entity_type' => $entry['entity_type'],
                'entity_id' => $entry['entity_id'],
                'old_values' => null,
                'new_values' => json_encode($entry['new_values']),
                'ip_address' => '10.20.'.mt_rand(1, 8).'.'.mt_rand(2, 250),
                'user_agent' => 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) StPaulReporting/1.0',
                // created_at only: this table has no updated_at.
                'created_at' => $createdAt,
            ];
        }

        foreach (array_chunk($rows, 500) as $chunk) {
            AdminAuditLog::query()->insert($chunk);
        }

        return count($rows);
    }
}
