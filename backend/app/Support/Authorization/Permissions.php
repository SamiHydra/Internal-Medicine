<?php

namespace App\Support\Authorization;

use App\Models\User;

final class Permissions
{
    public const AUTH_VIEW_SELF = 'auth.viewSelf';

    public const USERS_VIEW = 'users.view';

    public const USERS_MANAGE = 'users.manage';

    public const ADMINS_MANAGE = 'admins.manage';

    public const DEPARTMENTS_MANAGE = 'departments.manage';

    public const TEMPLATES_MANAGE = 'templates.manage';

    public const ASSIGNMENTS_MANAGE = 'assignments.manage';

    public const ACCESS_REQUESTS_CREATE = 'accessRequests.create';

    public const ACCESS_REQUESTS_REVIEW = 'accessRequests.review';

    public const REPORTS_VIEW_ASSIGNED = 'reports.viewAssigned';

    public const REPORTS_VIEW_ANY = 'reports.viewAny';

    public const REPORTS_SUBMIT = 'reports.submit';

    public const REPORTS_LOCK = 'reports.lock';

    public const ANALYTICS_VIEW = 'analytics.view';

    public const AUDIT_VIEW = 'audit.view';

    public const SETTINGS_MANAGE = 'settings.manage';

    public const NOTIFICATIONS_VIEW = 'notifications.view';

    private const ADMIN_ROLES = ['superadmin', 'admin', 'doctor_admin'];

    private const ROLE_PERMISSIONS = [
        'superadmin' => [
            self::AUTH_VIEW_SELF,
            self::USERS_VIEW,
            self::USERS_MANAGE,
            self::ADMINS_MANAGE,
            self::DEPARTMENTS_MANAGE,
            self::TEMPLATES_MANAGE,
            self::ASSIGNMENTS_MANAGE,
            self::ACCESS_REQUESTS_REVIEW,
            self::REPORTS_VIEW_ANY,
            self::REPORTS_SUBMIT,
            self::REPORTS_LOCK,
            self::ANALYTICS_VIEW,
            self::AUDIT_VIEW,
            self::SETTINGS_MANAGE,
            self::NOTIFICATIONS_VIEW,
        ],
        'admin' => [
            self::AUTH_VIEW_SELF,
            self::USERS_VIEW,
            self::USERS_MANAGE,
            self::DEPARTMENTS_MANAGE,
            self::TEMPLATES_MANAGE,
            self::ASSIGNMENTS_MANAGE,
            self::ACCESS_REQUESTS_REVIEW,
            self::REPORTS_VIEW_ANY,
            self::REPORTS_SUBMIT,
            self::REPORTS_LOCK,
            self::ANALYTICS_VIEW,
            self::AUDIT_VIEW,
            self::SETTINGS_MANAGE,
            self::NOTIFICATIONS_VIEW,
        ],
        'doctor_admin' => [
            self::AUTH_VIEW_SELF,
            self::USERS_VIEW,
            self::USERS_MANAGE,
            self::DEPARTMENTS_MANAGE,
            self::TEMPLATES_MANAGE,
            self::ASSIGNMENTS_MANAGE,
            self::ACCESS_REQUESTS_REVIEW,
            self::REPORTS_VIEW_ANY,
            self::REPORTS_SUBMIT,
            self::REPORTS_LOCK,
            self::ANALYTICS_VIEW,
            self::AUDIT_VIEW,
            self::SETTINGS_MANAGE,
            self::NOTIFICATIONS_VIEW,
        ],
        'nurse' => [
            self::AUTH_VIEW_SELF,
            self::ACCESS_REQUESTS_CREATE,
            self::REPORTS_VIEW_ASSIGNED,
            self::REPORTS_SUBMIT,
            self::NOTIFICATIONS_VIEW,
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
