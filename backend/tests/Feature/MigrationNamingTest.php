<?php

namespace Tests\Feature;

use Illuminate\Support\Facades\File;
use Tests\TestCase;

/**
 * QA-021: several migrations carry timestamps later than the real calendar
 * date. They are applied on existing databases under those names, so renaming
 * them would make `migrate` treat the renamed files as brand-new migrations and
 * fail on tables that already exist. The rule instead is that every migration
 * added from now on must sort AFTER the latest of those files, so a fresh
 * install and an already-migrated server run the new files in the same order.
 * Name new files 2026_10_04_000020_..., 2026_10_04_000030_... (and so on)
 * until the real date has passed 2026-10-04.
 */
class MigrationNamingTest extends TestCase
{
    /**
     * The last migration that was already applied when this rule was adopted.
     */
    private const LATEST_ADOPTED = '2026_10_04_000010_deep_link_action_item_notifications';

    /**
     * Migrations that existed when the rule was adopted. Any file that sorts
     * on or before LATEST_ADOPTED but is not in this list is a new migration
     * that was named too early.
     *
     * @var list<string>
     */
    private const ADOPTED = [
        '0001_01_01_000001_create_cache_table',
        '0001_01_01_000002_create_jobs_table',
        '2026_05_25_173723_create_personal_access_tokens_table',
        '2026_05_25_180000_create_roles_table',
        '2026_05_25_180010_create_users_table',
        '2026_05_25_180020_create_report_templates_table',
        '2026_05_25_180030_create_departments_table',
        '2026_05_25_180040_create_report_field_definitions_table',
        '2026_05_25_180050_create_reporting_periods_table',
        '2026_05_25_180060_create_report_assignments_table',
        '2026_05_25_180070_create_access_requests_table',
        '2026_05_25_180080_create_access_request_items_table',
        '2026_05_25_180090_create_reports_table',
        '2026_05_25_180100_create_report_field_values_table',
        '2026_05_25_180110_create_calculated_metrics_table',
        '2026_05_25_180120_create_report_status_history_table',
        '2026_05_25_180130_create_audit_logs_table',
        '2026_05_25_180140_create_admin_audit_logs_table',
        '2026_05_25_180150_create_notifications_table',
        '2026_05_25_180160_create_app_settings_table',
        '2026_05_29_000000_add_performance_indexes',
        '2026_05_29_010000_add_home_ward_to_users',
        '2026_05_29_010010_create_consultant_evaluations_table',
        '2026_05_29_010020_create_resident_evaluations_table',
        '2026_05_31_010000_create_admin_access_requests_table',
        '2026_06_01_010000_remove_doctor_admin_role',
        '2026_06_02_120000_add_active_to_report_field_definitions',
        '2026_06_02_130000_add_workspace_performance_indexes',
        '2026_06_09_000000_widen_notification_related_entity',
        '2026_06_09_010000_index_report_field_values_updated_at',
        '2026_06_10_000000_create_action_items_table',
        '2026_06_11_000000_create_report_comments_table',
        '2026_06_27_000000_add_academic_evaluation_read_indexes',
        '2026_07_15_000010_create_wards_table',
        '2026_07_15_000020_create_sections_table',
        '2026_07_15_000030_create_duty_types_table',
        '2026_07_15_000040_add_ward_id_to_departments',
        '2026_07_15_000050_add_academic_columns_to_users',
        '2026_07_15_000060_create_duty_assignments_table',
        '2026_07_15_000070_create_rotation_calendars_table',
        '2026_07_15_000080_create_rotation_blocks_table',
        '2026_07_15_000090_seed_academic_structure',
        '2026_07_15_000100_backfill_duty_assignments',
        '2026_07_22_000010_create_transfer_requests_table',
        '2026_07_29_000010_add_ward_ref_to_evaluations',
        '2026_07_29_000020_prepare_resident_evaluations_for_external_entry',
        '2026_08_05_000010_create_evaluation_forms_tables',
        '2026_08_05_000020_create_evaluations_tables',
        '2026_08_05_000030_seed_evaluation_forms',
        '2026_08_05_000040_copy_legacy_evaluations',
        '2026_08_12_000010_create_undergraduate_tables',
        '2026_08_12_000020_seed_undergraduate_defaults',
        '2026_08_19_000010_create_morning_sessions_tables',
        '2026_08_26_000010_mark_score_item_fields_core',
        '2026_08_30_000010_enforce_evaluation_form_active_status_uniqueness',
        '2026_08_30_000020_enforce_evaluation_header_invariants',
        '2026_08_30_000030_enforce_rep_assignment_uniqueness',
        '2026_08_30_000040_restore_evaluation_core_field_contract',
        '2026_08_30_000050_create_leadership_digest_deliveries_table',
        '2026_09_02_000010_add_workspace_to_roles_table',
        '2026_09_09_000010_add_home_ward_to_admin_access_requests',
        '2026_09_09_000020_add_academic_profile_to_admin_access_requests',
        '2026_09_16_000010_relax_admin_audit_log_entity_id',
        '2026_09_16_000020_enforce_evaluation_submission_uniqueness',
        '2026_09_16_000030_restore_sqlite_enum_check_constraints',
        '2026_09_20_000010_add_consultant_overall_rating',
        '2026_09_27_000005_normalize_user_login_identifiers',
        '2026_09_27_000010_add_audit_retention_indexes',
        '2026_10_01_000010_add_student_attendance_student_present_index',
        '2026_10_01_000020_create_performance_metrics_table',
        '2026_10_01_000030_create_analytics_exports_table',
        '2026_10_01_000040_create_workspace_revision_ledger',
        '2026_10_01_000050_normalize_approved_nurse_titles',
        '2026_10_02_000010_strengthen_clinical_action_governance',
        '2026_10_03_000010_relink_critical_alert_notifications',
        '2026_10_03_000020_add_filters_to_analytics_exports',
        '2026_10_04_000010_deep_link_action_item_notifications',
    ];

    public function test_new_migrations_sort_after_the_latest_adopted_migration(): void
    {
        $names = collect(File::files(database_path('migrations')))
            ->map(fn ($file) => $file->getFilenameWithoutExtension())
            ->sort()
            ->values();

        $this->assertContains(self::LATEST_ADOPTED, $names, 'The adopted migrations must never be renamed or removed.');

        $misnamed = $names
            ->filter(fn (string $name) => strcmp($name, self::LATEST_ADOPTED) <= 0)
            ->reject(fn (string $name) => in_array($name, self::ADOPTED, true))
            ->values()
            ->all();

        $this->assertSame([], $misnamed, sprintf(
            'These migrations sort before %s, which is already applied on existing databases. '.
            'Rename them with a later timestamp (2026_10_04_000020_... or later) so every database runs them in the same order.',
            self::LATEST_ADOPTED,
        ));

        $missing = array_values(array_diff(self::ADOPTED, $names->all()));
        $this->assertSame([], $missing, 'Adopted migrations are applied on existing databases and must never be renamed or removed.');

        // Laravel applies migrations in filename order; timestamps must therefore be unique.
        $this->assertSame($names->count(), $names->unique()->count());
    }
}
