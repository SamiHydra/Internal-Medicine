<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('clinical_alert_rules', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->foreignUuid('template_id')->nullable()->constrained('report_templates')->nullOnDelete();
            $table->foreignUuid('field_definition_id')->nullable()->constrained('report_field_definitions')->nullOnDelete();
            $table->string('field_key', 64);
            $table->string('name');
            $table->string('operator', 16)->default('gt');
            $table->decimal('threshold', 14, 4)->default(0);
            $table->string('severity', 16)->default('high');
            $table->unsignedSmallInteger('deadline_hours')->default(24);
            $table->string('responsible_role', 32)->nullable();
            $table->json('notification_roles');
            $table->boolean('active')->default(true);
            $table->unsignedInteger('version')->default(1);
            $table->timestamp('effective_from')->nullable();
            $table->timestamp('effective_until')->nullable();
            $table->foreignUuid('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->foreignUuid('updated_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();

            $table->unique(['template_id', 'field_key']);
            $table->index(['active', 'template_id']);
            $table->index(['effective_from', 'effective_until']);
        });

        Schema::table('action_items', function (Blueprint $table): void {
            $table->foreignUuid('clinical_alert_rule_id')->nullable()->after('department_id')->constrained('clinical_alert_rules')->nullOnDelete();
            $table->unsignedInteger('rule_version')->nullable()->after('clinical_alert_rule_id');
            $table->string('field_key', 64)->nullable()->after('source_key');
            $table->decimal('observed_value', 14, 4)->nullable()->after('field_key');
            $table->decimal('trigger_threshold', 14, 4)->nullable()->after('observed_value');
            $table->string('trigger_operator', 16)->nullable()->after('trigger_threshold');
            $table->string('condition_state', 32)->default('triggered')->after('status');
            $table->string('responsible_role', 32)->nullable()->after('assigned_to');
            $table->timestamp('due_at')->nullable()->after('responsible_role');
            $table->timestamp('overdue_notified_at')->nullable()->after('due_at');
            $table->foreignUuid('verified_by')->nullable()->after('resolved_by')->constrained('users')->nullOnDelete();
            $table->timestamp('verified_at')->nullable()->after('resolved_at');

            $table->index(['status', 'due_at']);
            $table->index(['department_id', 'status']);
            $table->index(['clinical_alert_rule_id', 'report_id', 'status'], 'action_items_rule_report_status_idx');
        });
        $this->restoreWorkspaceRevisionTriggers('action_items');

        Schema::create('action_item_status_history', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->foreignUuid('action_item_id')->constrained('action_items')->cascadeOnDelete();
            $table->string('event', 32);
            $table->string('from_status', 24)->nullable();
            $table->string('to_status', 24)->nullable();
            $table->text('note')->nullable();
            $table->foreignUuid('changed_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamp('created_at')->useCurrent();

            $table->index(['action_item_id', 'created_at']);
        });

        Schema::create('action_item_comments', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->foreignUuid('action_item_id')->constrained('action_items')->cascadeOnDelete();
            $table->foreignUuid('author_id')->nullable()->constrained('users')->nullOnDelete();
            $table->text('body');
            $table->timestamps();

            $table->index(['action_item_id', 'created_at']);
        });

        Schema::create('action_item_evidence', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->foreignUuid('action_item_id')->constrained('action_items')->cascadeOnDelete();
            $table->foreignUuid('uploaded_by')->nullable()->constrained('users')->nullOnDelete();
            $table->string('original_name');
            $table->string('disk', 32)->default('local');
            $table->string('file_path', 512);
            $table->string('mime_type', 128);
            $table->unsignedBigInteger('size_bytes');
            $table->timestamp('created_at')->useCurrent();

            $table->index(['action_item_id', 'created_at']);
        });

        $this->seedExistingCriticalFields();
    }

    public function down(): void
    {
        Schema::dropIfExists('action_item_evidence');
        Schema::dropIfExists('action_item_comments');
        Schema::dropIfExists('action_item_status_history');

        Schema::table('action_items', function (Blueprint $table): void {
            $table->dropIndex(['status', 'due_at']);
            $table->dropIndex(['department_id', 'status']);
            $table->dropIndex('action_items_rule_report_status_idx');
            $table->dropConstrainedForeignId('clinical_alert_rule_id');
            $table->dropConstrainedForeignId('verified_by');
            $table->dropColumn([
                'rule_version', 'field_key', 'observed_value', 'trigger_threshold', 'trigger_operator', 'condition_state',
                'responsible_role', 'due_at', 'overdue_notified_at', 'verified_at',
            ]);
        });
        $this->restoreWorkspaceRevisionTriggers('action_items');

        Schema::dropIfExists('clinical_alert_rules');
    }

    private function seedExistingCriticalFields(): void
    {
        if (! Schema::hasTable('app_settings') || ! Schema::hasTable('report_field_definitions')) {
            return;
        }

        $configured = DB::table('app_settings')->where('setting_key', 'critical_non_zero_fields')->value('value_json');
        $fieldKeys = is_string($configured) ? json_decode($configured, true) : $configured;

        if (! is_array($fieldKeys) || $fieldKeys === []) {
            return;
        }

        $now = now();
        $definitions = DB::table('report_field_definitions')
            ->whereIn('field_key', array_values($fieldKeys))
            ->get(['id', 'template_id', 'field_key', 'label']);

        foreach ($definitions as $definition) {
            DB::table('clinical_alert_rules')->insertOrIgnore([
                'id' => (string) Str::uuid(),
                'template_id' => $definition->template_id,
                'field_definition_id' => $definition->id,
                'field_key' => $definition->field_key,
                'name' => $definition->label,
                'operator' => 'gt',
                'threshold' => 0,
                'severity' => 'high',
                'deadline_hours' => 24,
                'responsible_role' => 'admin',
                'notification_roles' => json_encode(['superadmin', 'admin'], JSON_THROW_ON_ERROR),
                'active' => true,
                'version' => 1,
                'effective_from' => $now,
                'created_at' => $now,
                'updated_at' => $now,
            ]);
        }
    }

    /**
     * SQLite rebuilds a table while adding foreign keys and drops its triggers.
     * Restore the revision-ledger hooks after the rebuild; this is harmless on
     * MariaDB and keeps workspace refresh behavior identical after deployment.
     */
    private function restoreWorkspaceRevisionTriggers(string $table): void
    {
        if (! Schema::hasTable('workspace_revisions')) {
            return;
        }

        foreach (['insert', 'update', 'delete'] as $event) {
            $triggerName = "workspace_revision_{$table}_{$event}";
            $trigger = $this->quoteIdentifier($triggerName);
            $quotedTable = $this->quoteIdentifier($table);
            DB::unprepared("DROP TRIGGER IF EXISTS {$trigger}");

            if (DB::connection()->getDriverName() === 'sqlite') {
                DB::unprepared(
                    "CREATE TRIGGER {$trigger} AFTER ".strtoupper($event)." ON {$quotedTable} BEGIN ".
                    'UPDATE "workspace_revisions" SET "version" = "version" + 1, "updated_at" = CURRENT_TIMESTAMP WHERE "id" = 1; END',
                );

                continue;
            }

            DB::unprepared(
                "CREATE TRIGGER {$trigger} AFTER ".strtoupper($event)." ON {$quotedTable} FOR EACH ROW ".
                'UPDATE `workspace_revisions` SET `version` = `version` + 1, `updated_at` = CURRENT_TIMESTAMP WHERE `id` = 1',
            );
        }
    }

    private function quoteIdentifier(string $identifier): string
    {
        return DB::connection()->getDriverName() === 'sqlite'
            ? '"'.str_replace('"', '""', $identifier).'"'
            : '`'.str_replace('`', '``', $identifier).'`';
    }
};
