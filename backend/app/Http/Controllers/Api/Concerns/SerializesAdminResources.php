<?php

namespace App\Http\Controllers\Api\Concerns;

use App\Models\AccessRequest;
use App\Models\ActionItem;
use App\Models\AdminAccessRequest;
use App\Models\AdminAuditLog;
use App\Models\AppSetting;
use App\Models\AuditLog;
use App\Models\ConsultantEvaluation;
use App\Models\Department;
use App\Models\ReportAssignment;
use App\Models\ReportFieldDefinition;
use App\Models\ReportingPeriod;
use App\Models\ReportTemplate;
use App\Models\ResidentEvaluation;
use App\Models\User;
use Illuminate\Database\Eloquent\Model;

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
            'active' => (bool) ($field->active ?? true),
            'metadata' => $field->metadata,
        ];
    }

    /**
     * @return array<string, mixed>
     */
    protected function serializeAdminAccessRequest(AdminAccessRequest $adminRequest): array
    {
        $adminRequest->loadMissing(['reviewer', 'createdUser']);

        return [
            'id' => $adminRequest->id,
            'fullName' => $adminRequest->full_name,
            'email' => $adminRequest->email,
            'requestedRole' => $adminRequest->requested_role,
            'status' => $adminRequest->status,
            'notes' => $adminRequest->notes,
            'requestedAt' => $adminRequest->requested_at?->toJSON(),
            'reviewedAt' => $adminRequest->reviewed_at?->toJSON(),
            'reviewedBy' => $adminRequest->reviewed_by,
            'reviewedByName' => $adminRequest->reviewer?->full_name,
            'createdUserId' => $adminRequest->created_user_id,
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
    protected function serializeConsultantEvaluation(ConsultantEvaluation $evaluation): array
    {
        $evaluation->loadMissing(['author', 'subject', 'ward']);

        return [
            'id' => $evaluation->id,
            'authorId' => $evaluation->author_id,
            'authorName' => $evaluation->author?->full_name,
            'subjectId' => $evaluation->subject_id,
            'subjectName' => $evaluation->subject?->full_name,
            'wardId' => $evaluation->ward_id,
            'wardName' => $evaluation->ward?->name,
            'evaluationDate' => $evaluation->evaluation_date?->toJSON(),
            'seniorPresent' => (bool) $evaluation->senior_present,
            'seniorJoinedAt' => $this->formatClockTime($evaluation->senior_joined_at),
            'presenceMinutes' => $evaluation->presence_minutes,
            'allPatientsReviewed' => (bool) $evaluation->all_patients_reviewed,
            'mgmtPlanDocumented' => (bool) $evaluation->mgmt_plan_documented,
            'vteAssessed' => (bool) $evaluation->vte_assessed,
            'dischargeDiscussed' => (bool) $evaluation->discharge_discussed,
            'medReviewDone' => (bool) $evaluation->med_review_done,
            'criticalLabsReviewed' => (bool) $evaluation->critical_labs_reviewed,
            'pctPatientsSeen' => $evaluation->pct_patients_seen,
            'roundDelayed' => (bool) $evaluation->round_delayed,
            'mdtParticipants' => $evaluation->mdt_participants ?? [],
            'systemIssues' => $evaluation->system_issues ?? [],
            'comment' => $evaluation->comment,
            'qualityScore' => $this->evaluationScore($evaluation, ConsultantEvaluation::SCORE_ITEMS),
            'createdAt' => $evaluation->created_at?->toJSON(),
            'updatedAt' => $evaluation->updated_at?->toJSON(),
        ];
    }

    /**
     * @return array<string, mixed>
     */
    protected function serializeResidentEvaluation(ResidentEvaluation $evaluation): array
    {
        $evaluation->loadMissing(['author', 'subject', 'ward']);

        return [
            'id' => $evaluation->id,
            'authorId' => $evaluation->author_id,
            'authorName' => $evaluation->author?->full_name,
            'subjectId' => $evaluation->subject_id,
            'subjectName' => $evaluation->subject?->full_name,
            'wardId' => $evaluation->ward_id,
            'wardName' => $evaluation->ward?->name,
            'evaluationDate' => $evaluation->evaluation_date?->toJSON(),
            'onTime' => (bool) $evaluation->on_time,
            'prepared' => (bool) $evaluation->prepared,
            'presentationClear' => (bool) $evaluation->presentation_clear,
            'clinicalReasoning' => (bool) $evaluation->clinical_reasoning,
            'managementPlan' => (bool) $evaluation->management_plan,
            'documentationTimely' => (bool) $evaluation->documentation_timely,
            'communication' => (bool) $evaluation->communication,
            'professional' => (bool) $evaluation->professional,
            'responsiveFeedback' => (bool) $evaluation->responsive_feedback,
            'followThrough' => (bool) $evaluation->follow_through,
            'overallRating' => $evaluation->overall_rating,
            'concerns' => $evaluation->concerns ?? [],
            'comment' => $evaluation->comment,
            'performanceScore' => $this->evaluationScore($evaluation, ResidentEvaluation::SCORE_ITEMS),
            'createdAt' => $evaluation->created_at?->toJSON(),
            'updatedAt' => $evaluation->updated_at?->toJSON(),
        ];
    }

    /**
     * The score is the % of the row's yes/no items marked true. Computed on read,
     * never persisted.
     *
     * @param  list<string>  $items
     */
    protected function evaluationScore(Model $evaluation, array $items): float
    {
        $total = count($items);

        if ($total === 0) {
            return 0.0;
        }

        $yes = 0;
        foreach ($items as $item) {
            if ((bool) $evaluation->{$item}) {
                $yes++;
            }
        }

        return round($yes / $total * 100, 1);
    }

    /**
     * Normalize a time column to HH:MM (the DB may return "08:15" or "08:15:00").
     */
    protected function formatClockTime(?string $value): ?string
    {
        if ($value === null || $value === '') {
            return null;
        }

        return substr($value, 0, 5);
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
    protected function serializeActionItem(ActionItem $item): array
    {
        $item->loadMissing(['department', 'assignee', 'creator', 'resolver']);

        return [
            'id' => $item->id,
            'reportId' => $item->report_id,
            'departmentId' => $item->department_id,
            'departmentName' => $item->department?->name,
            'source' => $item->source,
            'title' => $item->title,
            'description' => $item->description,
            'severity' => $item->severity,
            'status' => $item->status,
            'assignedTo' => $item->assigned_to,
            'assignedToName' => $item->assignee?->full_name,
            'createdBy' => $item->created_by,
            'createdByName' => $item->creator?->full_name,
            'resolvedBy' => $item->resolved_by,
            'resolvedByName' => $item->resolver?->full_name,
            'resolutionNote' => $item->resolution_note,
            'resolvedAt' => $item->resolved_at?->toJSON(),
            'createdAt' => $item->created_at?->toJSON(),
            'updatedAt' => $item->updated_at?->toJSON(),
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
