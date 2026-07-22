<?php

namespace App\Support;

/**
 * Single source of truth for the job title shown when a user row carries no
 * explicit one. users.title is nullable and the admin update endpoint persists
 * an explicit null, so every payload that renders a title needs this fallback.
 *
 * Three private copies used to live in AuthController, WorkspaceController and
 * Admin\UserController and all three disagreed: a student rep with a null title
 * was rendered as "Nurse" by /api/workspace and /api/auth/me even though the
 * same payload reported roleLabel "Student representative". Keep new roles in
 * this one map; the titles here match Admin\AdminAccessRequestReviewService's
 * CREATABLE_ROLE_TITLES so an approved account and its fallback never diverge.
 */
class RoleTitles
{
    public static function default(string $roleKey): string
    {
        return match ($roleKey) {
            'superadmin' => 'Maintenance',
            'admin' => 'Administrator',
            'resident' => 'Resident',
            'consultant' => 'Consultant',
            'student_rep' => 'Student representative',
            default => 'Nurse',
        };
    }
}
