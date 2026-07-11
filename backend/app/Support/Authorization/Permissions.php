<?php

namespace App\Support\Authorization;

use App\Models\User;

final class Permissions
{
    public const AUTH_VIEW_SELF = 'auth.viewSelf';

    public const USERS_VIEW = 'users.view';

    public const USERS_MANAGE = 'users.manage';

    public const ADMINS_MANAGE = 'admins.manage';

    public const ADMINS_APPROVE = 'admins.approve';

    public const DEPARTMENTS_MANAGE = 'departments.manage';

    public const TEMPLATES_MANAGE = 'templates.manage';

    /** Edit a template's safe content (labels, units, order, active days, signal thresholds, soft-disable). Admins + Maintenance. */
    public const TEMPLATES_EDIT_CONTENT = 'templates.editContent';

    /** Structural edits (rename keys, change field types, add/remove fields, slug/family). Maintenance only. */
    public const TEMPLATES_EDIT_STRUCTURE = 'templates.editStructure';

    public const ASSIGNMENTS_MANAGE = 'assignments.manage';

    public const ACCESS_REQUESTS_CREATE = 'accessRequests.create';

    public const ACCESS_REQUESTS_REVIEW = 'accessRequests.review';

    public const REPORTS_VIEW_ASSIGNED = 'reports.viewAssigned';

    public const REPORTS_VIEW_ANY = 'reports.viewAny';

    public const REPORTS_SUBMIT = 'reports.submit';

    public const REPORTS_LOCK = 'reports.lock';

    public const REPORTS_IMPORT = 'reports.import';

    public const ANALYTICS_VIEW = 'analytics.view';

    public const AUDIT_VIEW = 'audit.view';

    public const SETTINGS_MANAGE = 'settings.manage';

    public const ACTION_ITEMS_VIEW = 'actionItems.view';

    public const ACTION_ITEMS_MANAGE = 'actionItems.manage';

    public const NOTIFICATIONS_VIEW = 'notifications.view';

    public const ACADEMIC_SUBMIT = 'academic.submit';

    public const ACADEMIC_VIEW = 'academic.view';

    public const ACADEMIC_MANAGE = 'academic.manage';

    /** Wards, sections, and the duty-type catalog. */
    public const ACADEMIC_STRUCTURE_MANAGE = 'academicStructure.manage';

    /** The month-by-month consultant duty roster and day-level duties. */
    public const ROSTER_MANAGE = 'roster.manage';

    /** Rotation calendars and the resident rotation planner. */
    public const ROTATIONS_MANAGE = 'rotations.manage';

    /** Edit an evaluation form's safe content (labels, help text, order, option wording). Admins + Maintenance. */
    public const EVALUATION_FORMS_EDIT_CONTENT = 'evaluationForms.editContent';

    /** Structural evaluation-form edits (add/remove fields, change key or type) via draft + publish. Maintenance only. */
    public const EVALUATION_FORMS_EDIT_STRUCTURE = 'evaluationForms.editStructure';

    /** Record the department-wide morning session; the policy narrows to the designated recorder. */
    public const MORNING_ATTENDANCE_RECORD = 'morningAttendance.record';

    /** Record whether a scheduled teaching activity was held (student reps). */
    public const TEACHING_LOG_RECORD = 'teachingLog.record';

    /** Record per-student attendance for a teaching session (consultants). */
    public const STUDENT_ATTENDANCE_RECORD = 'studentAttendance.record';

    /** Student batches, rosters, placements, rep accounts, session oversight. */
    public const STUDENTS_MANAGE = 'students.manage';

    /** File or cancel one's own section-transfer request (consultants). */
    public const TRANSFERS_CREATE = 'transfers.create';

    /** Review transfer requests; the policy narrows consultants to destination-section heads. */
    public const TRANSFERS_REVIEW = 'transfers.review';

    private const ADMIN_ROLES = ['superadmin', 'admin'];

    private const ROLE_PERMISSIONS = [
        'superadmin' => [
            self::AUTH_VIEW_SELF,
            self::USERS_VIEW,
            self::USERS_MANAGE,
            self::ADMINS_MANAGE,
            self::ADMINS_APPROVE,
            self::DEPARTMENTS_MANAGE,
            self::TEMPLATES_MANAGE,
            self::TEMPLATES_EDIT_CONTENT,
            self::TEMPLATES_EDIT_STRUCTURE,
            self::ASSIGNMENTS_MANAGE,
            self::ACCESS_REQUESTS_REVIEW,
            self::REPORTS_VIEW_ANY,
            self::REPORTS_SUBMIT,
            self::REPORTS_LOCK,
            self::REPORTS_IMPORT,
            self::ANALYTICS_VIEW,
            self::AUDIT_VIEW,
            self::SETTINGS_MANAGE,
            self::ACTION_ITEMS_VIEW,
            self::ACTION_ITEMS_MANAGE,
            self::NOTIFICATIONS_VIEW,
            self::ACADEMIC_VIEW,
            self::ACADEMIC_MANAGE,
            self::ACADEMIC_STRUCTURE_MANAGE,
            self::ROSTER_MANAGE,
            self::ROTATIONS_MANAGE,
            self::TRANSFERS_REVIEW,
            self::EVALUATION_FORMS_EDIT_CONTENT,
            self::EVALUATION_FORMS_EDIT_STRUCTURE,
            self::TEACHING_LOG_RECORD,
            self::STUDENT_ATTENDANCE_RECORD,
            self::STUDENTS_MANAGE,
            self::MORNING_ATTENDANCE_RECORD,
        ],
        'admin' => [
            self::AUTH_VIEW_SELF,
            self::USERS_VIEW,
            self::USERS_MANAGE,
            self::ADMINS_APPROVE,
            self::DEPARTMENTS_MANAGE,
            self::TEMPLATES_MANAGE,
            self::TEMPLATES_EDIT_CONTENT,
            self::ASSIGNMENTS_MANAGE,
            self::ACCESS_REQUESTS_REVIEW,
            self::REPORTS_VIEW_ANY,
            self::REPORTS_SUBMIT,
            self::REPORTS_LOCK,
            self::REPORTS_IMPORT,
            self::ANALYTICS_VIEW,
            self::AUDIT_VIEW,
            self::SETTINGS_MANAGE,
            self::ACTION_ITEMS_VIEW,
            self::ACTION_ITEMS_MANAGE,
            self::NOTIFICATIONS_VIEW,
            self::ACADEMIC_VIEW,
            self::ACADEMIC_MANAGE,
            self::ACADEMIC_STRUCTURE_MANAGE,
            self::ROSTER_MANAGE,
            self::ROTATIONS_MANAGE,
            self::TRANSFERS_REVIEW,
            self::EVALUATION_FORMS_EDIT_CONTENT,
            self::TEACHING_LOG_RECORD,
            self::STUDENT_ATTENDANCE_RECORD,
            self::STUDENTS_MANAGE,
            self::MORNING_ATTENDANCE_RECORD,
        ],
        'nurse' => [
            self::AUTH_VIEW_SELF,
            self::ACCESS_REQUESTS_CREATE,
            self::REPORTS_VIEW_ASSIGNED,
            self::REPORTS_SUBMIT,
            self::NOTIFICATIONS_VIEW,
        ],
        'resident' => [
            self::AUTH_VIEW_SELF,
            self::ACADEMIC_SUBMIT,
            self::MORNING_ATTENDANCE_RECORD,
        ],
        'consultant' => [
            self::AUTH_VIEW_SELF,
            self::ACADEMIC_SUBMIT,
            self::TRANSFERS_CREATE,
            self::TRANSFERS_REVIEW,
            self::STUDENT_ATTENDANCE_RECORD,
            self::MORNING_ATTENDANCE_RECORD,
        ],
        // Student representatives record whether teaching happened, nothing
        // else. The ABSENCE of academic.submit / academic.view /
        // academic.manage here is the structural guarantee that reps can
        // never reach evaluation data (V2 guide 3.6); a test asserts it.
        'student_rep' => [
            self::AUTH_VIEW_SELF,
            self::NOTIFICATIONS_VIEW,
            self::TEACHING_LOG_RECORD,
        ],
    ];

    /**
     * @return list<string>
     */
    public static function all(): array
    {
        return array_values(array_unique(array_merge(...array_values(self::ROLE_PERMISSIONS))));
    }

    /**
     * @return list<string>
     */
    public static function forUser(User $user): array
    {
        if (! $user->active) {
            return [];
        }

        return self::forRole($user->role_key);
    }

    /**
     * @return list<string>
     */
    public static function forRole(?string $roleKey): array
    {
        return self::ROLE_PERMISSIONS[$roleKey] ?? [];
    }

    public static function userCan(User $user, string $permission): bool
    {
        return in_array($permission, self::forUser($user), true);
    }

    public static function roleHas(?string $roleKey, string $permission): bool
    {
        return in_array($permission, self::forRole($roleKey), true);
    }

    public static function isAdminRole(?string $roleKey): bool
    {
        return in_array($roleKey, self::ADMIN_ROLES, true);
    }

    public static function isSuperadmin(?string $roleKey): bool
    {
        return $roleKey === 'superadmin';
    }
}
