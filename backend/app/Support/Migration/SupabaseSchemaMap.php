<?php

namespace App\Support\Migration;

use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;

/**
 * Declarative map of the legacy Supabase `public` schema onto the Laravel
 * schema, used by the Phase 12 migration commands (supabase:export / import).
 *
 * Tables are listed in foreign-key dependency order so the importer can insert
 * parents before children. Primary keys are UUID/text in both systems, so they
 * are preserved 1:1 and every foreign key stays valid.
 *
 * Per-table keys:
 *   source      - Supabase table name (defaults to target).
 *   key         - upsert conflict key (PK).
 *   reference   - true for seeded reference data (skippable via --skip-reference).
 *   columns     - ordered list of TARGET columns to write.
 *   coerce      - target column => type (datetime|date|time|bool|json). Others pass through.
 *   generate    - target column => fn(array $sourceRow): mixed, for target-only columns.
 *   insertOnly  - columns written on insert but never overwritten on re-run upsert.
 */
class SupabaseSchemaMap
{
    /**
     * @return array<string, array<string, mixed>>
     */
    public static function tables(): array
    {
        return [
            'roles' => [
                'key' => 'role_key',
                'reference' => true,
                'columns' => ['role_key', 'label', 'description', 'created_at', 'updated_at'],
                'coerce' => ['created_at' => 'datetime', 'updated_at' => 'datetime'],
                'generate' => [
                    'created_at' => fn (array $r) => $r['created_at'] ?? now()->toIso8601String(),
                    'updated_at' => fn (array $r) => $r['updated_at'] ?? now()->toIso8601String(),
                ],
            ],

            'users' => [
                'source' => 'profiles',
                'key' => 'id',
                'columns' => [
                    'id', 'email', 'username', 'password', 'full_name', 'title', 'role_key',
                    'phone', 'active', 'email_verified_at', 'remember_token', 'last_login_at',
                    'password_change_required', 'created_at', 'updated_at',
                ],
                'coerce' => [
                    'active' => 'bool',
                    'password_change_required' => 'bool',
                    'email_verified_at' => 'datetime',
                    'last_login_at' => 'datetime',
                    'created_at' => 'datetime',
                    'updated_at' => 'datetime',
                ],
                'generate' => [
                    // Supabase auth passwords cannot migrate; force a reset on first login.
                    'password' => fn (array $r) => Hash::make(Str::random(40)),
                    'password_change_required' => fn (array $r) => true,
                    // Existing Supabase users had confirmed emails; proxy with created_at.
                    'email_verified_at' => fn (array $r) => $r['created_at'] ?? null,
                    'last_login_at' => fn (array $r) => null,
                    'remember_token' => fn (array $r) => null,
                ],
                // Never clobber a user's reset state if the import is re-run.
                'insertOnly' => [
                    'password', 'password_change_required', 'email_verified_at',
                    'last_login_at', 'remember_token',
                ],
            ],

            'report_templates' => [
                'key' => 'id',
                'reference' => true,
                'columns' => ['id', 'slug', 'family', 'name', 'description', 'active_days', 'metadata', 'active', 'created_at', 'updated_at'],
                'coerce' => [
                    'active_days' => 'json',
                    'metadata' => 'json',
                    'active' => 'bool',
                    'created_at' => 'datetime',
                    'updated_at' => 'datetime',
                ],
                // `active` is a Laravel-only column (not present in the old schema).
                'generate' => ['active' => fn (array $r) => true],
            ],

            'departments' => [
                'key' => 'id',
                'reference' => true,
                'columns' => ['id', 'slug', 'family', 'template_id', 'name', 'description', 'accent_color', 'bed_count', 'active', 'created_at', 'updated_at'],
                'coerce' => [
                    'active' => 'bool',
                    'created_at' => 'datetime',
                    'updated_at' => 'datetime',
                ],
            ],

            'report_field_definitions' => [
                'key' => 'id',
                'reference' => true,
                'columns' => ['id', 'template_id', 'section_key', 'field_key', 'label', 'field_kind', 'aggregate_type', 'display_order', 'metadata', 'created_at', 'updated_at'],
                'coerce' => [
                    'metadata' => 'json',
                    'created_at' => 'datetime',
                    'updated_at' => 'datetime',
                ],
            ],

            'reporting_periods' => [
                'key' => 'id',
                'reference' => true,
                'columns' => ['id', 'week_start', 'week_end', 'deadline_at', 'month_label', 'quarter_label', 'year_num', 'created_at'],
                'coerce' => [
                    'week_start' => 'date',
                    'week_end' => 'date',
                    'deadline_at' => 'datetime',
                    'created_at' => 'datetime',
                ],
            ],

            'report_assignments' => [
                'key' => 'id',
                'columns' => ['id', 'nurse_id', 'department_id', 'template_id', 'active', 'approved_at', 'approved_by', 'created_at', 'updated_at'],
                'coerce' => [
                    'active' => 'bool',
                    'approved_at' => 'datetime',
                    'created_at' => 'datetime',
                    'updated_at' => 'datetime',
                ],
            ],

            'access_requests' => [
                'key' => 'id',
                'columns' => ['id', 'user_id', 'email', 'status', 'notes', 'requested_at', 'reviewed_at', 'reviewed_by', 'created_at', 'updated_at'],
                'coerce' => [
                    'requested_at' => 'datetime',
                    'reviewed_at' => 'datetime',
                    'created_at' => 'datetime',
                    'updated_at' => 'datetime',
                ],
            ],

            'access_request_items' => [
                'key' => 'id',
                'columns' => ['id', 'access_request_id', 'department_id', 'template_id', 'created_at'],
                'coerce' => ['created_at' => 'datetime'],
            ],

            'reports' => [
                'key' => 'id',
                'columns' => ['id', 'assignment_id', 'department_id', 'template_id', 'reporting_period_id', 'status', 'submitted_at', 'locked_at', 'created_by', 'updated_by', 'created_at', 'updated_at'],
                'coerce' => [
                    'submitted_at' => 'datetime',
                    'locked_at' => 'datetime',
                    'created_at' => 'datetime',
                    'updated_at' => 'datetime',
                ],
            ],

            'report_field_values' => [
                'key' => 'id',
                'columns' => ['id', 'report_id', 'field_definition_id', 'day_name', 'value_number', 'value_text', 'value_time', 'value_json', 'created_at', 'updated_at'],
                'coerce' => [
                    'value_time' => 'time',
                    'value_json' => 'json',
                    'created_at' => 'datetime',
                    'updated_at' => 'datetime',
                ],
            ],

            'calculated_metrics' => [
                'key' => 'id',
                'columns' => ['id', 'report_id', 'bor_percent', 'btr', 'alos', 'metric_payload', 'created_at', 'updated_at'],
                'coerce' => [
                    'metric_payload' => 'json',
                    'created_at' => 'datetime',
                    'updated_at' => 'datetime',
                ],
            ],

            'report_status_history' => [
                'key' => 'id',
                'columns' => ['id', 'report_id', 'status', 'changed_by', 'changed_by_name', 'note', 'changed_at'],
                'coerce' => ['changed_at' => 'datetime'],
            ],

            'audit_logs' => [
                'key' => 'id',
                'columns' => ['id', 'report_id', 'field_definition_id', 'field_key', 'day_name', 'old_value', 'new_value', 'changed_by', 'changed_by_name', 'changed_at', 'department_id', 'template_id'],
                'coerce' => ['changed_at' => 'datetime'],
            ],

            'notifications' => [
                'key' => 'id',
                'columns' => ['id', 'recipient_id', 'type', 'title', 'message', 'related_route', 'related_entity', 'related_id', 'read_at', 'created_at'],
                'coerce' => ['read_at' => 'datetime', 'created_at' => 'datetime'],
            ],

            'app_settings' => [
                'key' => 'setting_key',
                'reference' => true,
                'columns' => ['setting_key', 'value_json', 'updated_by', 'updated_at'],
                'coerce' => ['value_json' => 'json', 'updated_at' => 'datetime'],
            ],
        ];
    }

    public static function sourceTable(string $target, array $spec): string
    {
        return $spec['source'] ?? $target;
    }

    /**
     * Columns to update on upsert conflict: everything except the key,
     * created_at, and any insert-only columns.
     *
     * @return list<string>
     */
    public static function updateColumns(array $spec): array
    {
        $exclude = array_merge(
            [$spec['key'], 'created_at'],
            $spec['insertOnly'] ?? [],
        );

        return array_values(array_diff($spec['columns'], $exclude));
    }
}
