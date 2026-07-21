<?php

namespace App\Support\Audit;

/**
 * The one place that knows what an audited entity type MEANS.
 *
 * `admin_audit_logs` stores free-form `action` / `entity_type` strings, which
 * kept the writer simple but left two holes: nothing could tell a clinical row
 * from an academic one, and the UI had to guess at labels (rendering
 * `save_roster_month` as "Save_roster_month"). Both holes close here rather
 * than in a migration, so no backfill is needed and existing rows gain their
 * workspace and label retroactively.
 *
 * Registering a new auditable surface is one line in ENTITIES - and, if the
 * action is not already common, one line in ACTIONS.
 */
final class AuditRegistry
{
    public const WORKSPACE_CLINICAL = 'clinical';

    public const WORKSPACE_ACADEMIC = 'academic';

    /**
     * Cross-cutting surfaces (accounts, settings, access) belong to neither
     * workspace and stay visible in both - hiding an account change from an
     * academic admin would be worse than showing it twice.
     */
    public const WORKSPACE_SYSTEM = 'system';

    /**
     * entity_type => [workspace, label]
     *
     * @var array<string, array{workspace: string, label: string}>
     */
    private const ENTITIES = [
        // -- Clinical ------------------------------------------------------
        'report_template' => [self::WORKSPACE_CLINICAL, 'Report template'],
        'department' => [self::WORKSPACE_CLINICAL, 'Department'],
        'report_assignment' => [self::WORKSPACE_CLINICAL, 'Report assignment'],

        // -- Academic: structure -------------------------------------------
        'ward' => [self::WORKSPACE_ACADEMIC, 'Ward'],
        'section' => [self::WORKSPACE_ACADEMIC, 'Section'],
        'duty_type' => [self::WORKSPACE_ACADEMIC, 'Duty type'],
        'rotation_calendar' => [self::WORKSPACE_ACADEMIC, 'Rotation calendar'],
        'duty_roster' => [self::WORKSPACE_ACADEMIC, 'Duty roster'],
        'transfer_request' => [self::WORKSPACE_ACADEMIC, 'Section transfer'],

        // -- Academic: undergraduate programme -----------------------------
        'student_batch' => [self::WORKSPACE_ACADEMIC, 'Student batch'],
        'student' => [self::WORKSPACE_ACADEMIC, 'Student'],
        'subgroup_placement' => [self::WORKSPACE_ACADEMIC, 'Placement'],
        'rep_assignment' => [self::WORKSPACE_ACADEMIC, 'Student rep'],
        'teaching_activity_schedule' => [self::WORKSPACE_ACADEMIC, 'Teaching schedule'],
        'teaching_session' => [self::WORKSPACE_ACADEMIC, 'Teaching session'],

        // -- Academic: daily operations ------------------------------------
        'morning_session' => [self::WORKSPACE_ACADEMIC, 'Morning session'],
        'morning_roster_override' => [self::WORKSPACE_ACADEMIC, 'Morning roster override'],

        // -- Academic: evaluations -----------------------------------------
        'evaluation_form' => [self::WORKSPACE_ACADEMIC, 'Evaluation form'],
        'resident_evaluation' => [self::WORKSPACE_ACADEMIC, 'Resident evaluation'],
        'consultant_evaluation' => [self::WORKSPACE_ACADEMIC, 'Consultant evaluation'],
        'student_evaluation' => [self::WORKSPACE_ACADEMIC, 'Student evaluation'],

        // -- System (both workspaces) --------------------------------------
        'user' => [self::WORKSPACE_SYSTEM, 'User account'],
        'app_settings' => [self::WORKSPACE_SYSTEM, 'Settings'],
        'access_request' => [self::WORKSPACE_SYSTEM, 'Access request'],
        // Historical key: the queue now carries academic enrollments too.
        'admin_access_request' => [self::WORKSPACE_SYSTEM, 'Account request'],
    ];

    /**
     * action => label. Kept verb-first and past tense so a row reads as a
     * sentence: "Recorded - Morning session".
     *
     * @var array<string, string>
     */
    private const ACTIONS = [
        'create' => 'Created',
        'create_draft' => 'Drafted',
        'create_external' => 'Added externally',
        'upsert' => 'Created',
        'update' => 'Updated',
        'update_content' => 'Content edited',
        'update_structure' => 'Structure edited',
        'delete' => 'Removed',
        'deactivate' => 'Deactivated',
        'set_active' => 'Availability changed',
        'set_field_active' => 'Field availability changed',
        'set_consultant_section' => 'Section reassigned',
        'publish' => 'Published',
        'import' => 'Imported',
        'record' => 'Recorded',
        'record_attendance' => 'Attendance recorded',
        'submit' => 'Submitted',
        'correct' => 'Corrected',
        'cancel' => 'Cancelled',
        'request' => 'Requested',
        'approve' => 'Approved',
        'reject' => 'Rejected',
        'review' => 'Reviewed',
        'apply' => 'Applied',
        'approve_admin_request' => 'Account request approved',
        'reject_admin_request' => 'Account request rejected',
        'reset_password' => 'Password reset',
        'save_roster_month' => 'Roster month saved',
        'save_daily_duty' => 'Duty assigned',
        'remove_daily_duty' => 'Duty cleared',
        'save_rotation_plan' => 'Rotation plan saved',
    ];

    /**
     * An unregistered entity type resolves to SYSTEM on purpose: a surface
     * someone forgot to register still shows up in every workspace rather than
     * silently vanishing from the trail.
     */
    public static function workspaceFor(string $entityType): string
    {
        return self::ENTITIES[$entityType][0] ?? self::WORKSPACE_SYSTEM;
    }

    public static function labelFor(string $entityType): string
    {
        return self::ENTITIES[$entityType][1]
            ?? ucfirst(str_replace('_', ' ', $entityType));
    }

    public static function actionLabelFor(string $action): string
    {
        return self::ACTIONS[$action]
            ?? ucfirst(str_replace('_', ' ', $action));
    }

    /**
     * Entity types a workspace should see: its own plus the system-wide ones.
     *
     * @return list<string>
     */
    public static function entityTypesFor(string $workspace): array
    {
        $types = [];

        foreach (self::ENTITIES as $entityType => [$entityWorkspace]) {
            if ($entityWorkspace === $workspace || $entityWorkspace === self::WORKSPACE_SYSTEM) {
                $types[] = $entityType;
            }
        }

        return $types;
    }

    /**
     * Entity types to EXCLUDE when scoping a query to a workspace - i.e. those
     * belonging exclusively to another one.
     *
     * Scoping subtracts rather than selects on purpose. Selecting registered
     * types would make an unregistered entity type invisible in every
     * workspace, so forgetting to register a new surface would silently erase
     * it from the trail. Subtracting means the default for anything unknown is
     * "shown", matching workspaceFor()'s SYSTEM fallback.
     *
     * @return list<string>
     */
    public static function entityTypesExcludedFrom(string $workspace): array
    {
        $types = [];

        foreach (self::ENTITIES as $entityType => [$entityWorkspace]) {
            if ($entityWorkspace !== $workspace && $entityWorkspace !== self::WORKSPACE_SYSTEM) {
                $types[] = $entityType;
            }
        }

        return $types;
    }

    /**
     * The registered entity types for a workspace, as {value,label} pairs for
     * a filter control. System types are included so the picker matches what
     * the list can actually contain.
     *
     * @return list<array{value: string, label: string, workspace: string}>
     */
    public static function filterOptionsFor(string $workspace): array
    {
        $options = [];

        foreach (self::ENTITIES as $entityType => [$entityWorkspace, $label]) {
            if ($entityWorkspace === $workspace || $entityWorkspace === self::WORKSPACE_SYSTEM) {
                $options[] = [
                    'value' => $entityType,
                    'label' => $label,
                    'workspace' => $entityWorkspace,
                ];
            }
        }

        usort($options, static fn (array $a, array $b) => $a['label'] <=> $b['label']);

        return $options;
    }
}
