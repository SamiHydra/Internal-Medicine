<?php

namespace App\Http\Controllers\Api\Concerns;

use App\Models\AccessRequest;
use App\Models\AdminAuditLog;
use App\Models\AppSetting;
use App\Models\AuditLog;
use App\Models\Department;
use App\Models\ReportAssignment;
use App\Models\ReportFieldDefinition;
use App\Models\ReportingPeriod;
use App\Models\ReportTemplate;
use App\Models\User;

trait SerializesAdminResources
{
    /**
     * @return array<string, mixed>
     */
    protected function serializeUser(User $user, bool $withAssignments = true): array
    {
        if ($withAssignments) {
            $user->loadMissing(['assignments.department', 'assignments.template']);
        }

        return [
            'id' => $user->id,
            'fullName' => $user->full_name,
            'email' => $user->email,
            'username' => $user->username,
            'role' => $user->role_key,
            'title' => $user->title,
            'active' => (bool) $user->active,
            'phone' => $user->phone,
            'passwordChangeRequired' => (bool) $user->password_change_required,
            'lastLoginAt' => $user->last_login_at?->toJSON(),
            'createdAt' => $user->created_at?->toJSON(),
            'updatedAt' => $user->updated_at?->toJSON(),
            'assignments' => $withAssignments
                ? $user->assignments->map(fn (ReportAssignment $assignment) => $this->serializeAssignment($assignment))->values()
                : [],
        ];
    }

    /**
     * @return array<string, mixed>
     */
    protected function serializeAssignment(ReportAssignment $assignment): array
    {
        $assignment->loadMissing(['nurse', 'department', 'template', 'approver']);

        return [
            'id' => $assignment->id,
            'nurseId' => $assignment->nurse_id,
            'nurseName' => $assignment->nurse?->full_name,
            'departmentId' => $assignment->department_id,
            'departmentSlug' => $assignment->department?->slug,
            'departmentName' => $assignment->department?->name,
            'templateId' => $assignment->template_id,
            'templateSlug' => $assignment->template?->slug,
            'templateName' => $assignment->template?->name,
            'approvedAt' => $assignment->approved_at?->toJSON(),
            'approvedBy' => $assignment->approved_by,
            'approvedByName' => $assignment->approver?->full_name,
            'active' => (bool) $assignment->active,
            'createdAt' => $assignment->created_at?->toJSON(),
            'updatedAt' => $assignment->updated_at?->toJSON(),
        ];
    }

    /**
     * @return array<string, mixed>
     */
    protected function serializeDepartment(Department $department): array
    {
        $department->loadMissing('template');

        return [
            'id' => $department->id,
            'slug' => $department->slug,
            'family' => $department->family,
            'templateId' => $department->template_id,
            'templateSlug' => $department->template?->slug,
            'name' => $department->name,
            'description' => $department->description,
            'accentColor' => $department->accent_color,
            'bedCount' => $department->bed_count,
            'active' => (bool) $department->active,
            'createdAt' => $department->created_at?->toJSON(),
            'updatedAt' => $department->updated_at?->toJSON(),
        ];
    }

    /**
     * @return array<string, mixed>
     */
    protected function serializeTemplate(ReportTemplate $template, bool $withFields = true): array
    {
        if ($withFields) {
            $template->loadMissing(['fieldDefinitions' => fn ($query) => $query->orderBy('display_order')]);
        }

        return [
            'id' => $template->id,
            'slug' => $template->slug,
            'family' => $template->family,
            'name' => $template->name,
            'description' => $template->description,
            'activeDays' => $template->active_days,
            'metadata' => $template->metadata,
            'active' => (bool) $template->active,
            'createdAt' => $template->created_at?->toJSON(),
            'updatedAt' => $template->updated_at?->toJSON(),
            'fields' => $withFields
                ? $template->fieldDefinitions->map(fn (ReportFieldDefinition $field) => $this->serializeFieldDefinition($field))->values()
                : [],
        ];
    }

    /**
     * @return array<string, mixed>
     */
    protected function serializeFieldDefinition(ReportFieldDefinition $field): array
    {
        return [
            'id' => $field->id,
            'templateId' => $field->template_id,
            'sectionKey' => $field->section_key,
            'fieldKey' => $field->field_key,
            'label' => $field->label,
            'fieldKind' => $field->field_kind,
            'aggregateType' => $field->aggregate_type,
            'displayOrder' => $field->display_order,
            'metadata' => $field->metadata,
        ];
    }

    /**
     * @return array<string, mixed>
     */
    protected function serializeAccessRequest(AccessRequest $accessRequest): array
    {
        $accessRequest->loadMissing(['user', 'reviewer', 'items.department', 'items.template']);

        return [
            'id' => $accessRequest->id,
            'userId' => $accessRequest->user_id,
            'userName' => $accessRequest->user?->full_name ?? $accessRequest->email,
            'email' => $accessRequest->email,
            'status' => $accessRequest->status,
            'notes' => $accessRequest->notes,
            'requestedAt' => $accessRequest->requested_at?->toJSON(),
            'reviewedAt' => $accessRequest->reviewed_at?->toJSON(),
            'reviewedBy' => $accessRequest->reviewed_by,
            'reviewedByName' => $accessRequest->reviewer?->full_name,
            'requestedAssignments' => $accessRequest->items->map(fn ($item) => [
                'departmentId' => $item->department_id,
                'departmentSlug' => $item->department?->slug,
                'departmentName' => $item->department?->name,
                'templateId' => $item->template_id,
                'templateSlug' => $item->template?->slug,
                'templateName' => $item->template?->name,
            ])->values(),
        ];
    }

    /**
     * @return array<string, mixed>
     */
    protected function serializeAuditLog(AuditLog $auditLog): array
    {
        $auditLog->loadMissing(['fieldDefinition', 'changedBy', 'department', 'template']);

        return [
            'id' => $auditLog->id,
            'reportId' => $auditLog->report_id,
            'fieldDefinitionId' => $auditLog->field_definition_id,
            'fieldKey' => $auditLog->field_key,
            'fieldLabel' => $auditLog->fieldDefinition?->label ?? $auditLog->field_key,
            'dayName' => $auditLog->day_name,
            'oldValue' => $auditLog->old_value,
            'newValue' => $auditLog->new_value,
            'changedBy' => $auditLog->changed_by,
            'changedByName' => $auditLog->changed_by_name ?? $auditLog->changedBy?->full_name,
            'changedAt' => $auditLog->changed_at?->toJSON(),
            'departmentId' => $auditLog->department_id,
            'departmentSlug' => $auditLog->department?->slug,
            'templateId' => $auditLog->template_id,
            'templateSlug' => $auditLog->template?->slug,
        ];
    }

    /**
     * @return array<string, mixed>
     */
    protected function serializeAdminAuditLog(AdminAuditLog $auditLog): array
    {
        return [
            'id' => $auditLog->id,
            'userId' => $auditLog->user_id,
            'userName' => $auditLog->user_name,
            'action' => $auditLog->action,
            'entityType' => $auditLog->entity_type,
            'entityId' => $auditLog->entity_id,
            'oldValues' => $auditLog->old_values,
            'newValues' => $auditLog->new_values,
            'ipAddress' => $auditLog->ip_address,
            'userAgent' => $auditLog->user_agent,
            'createdAt' => $auditLog->created_at?->toJSON(),
        ];
    }

    /**
     * @return array<string, mixed>
     */
    protected function serializeAppSetting(AppSetting $setting): array
    {
        return [
            'settingKey' => $setting->setting_key,
            'value' => $setting->value_json,
            'updatedBy' => $setting->updated_by,
            'updatedAt' => $setting->updated_at?->toJSON(),
        ];
    }

    /**
     * @return array<string, mixed>
     */
    protected function serializeReportingPeriod(ReportingPeriod $period): array
    {
        return [
            'id' => $period->id,
            'weekStart' => $period->week_start?->toDateString(),
            'weekEnd' => $period->week_end?->toDateString(),
            'deadlineAt' => $period->deadline_at?->toJSON(),
            'monthLabel' => $period->month_label,
            'quarterLabel' => $period->quarter_label,
            'year' => $period->year_num,
        ];
    }
}
