<?php

namespace App\Http\Controllers\Api\Admin;

use App\Http\Controllers\Api\Concerns\SerializesAdminResources;
use App\Http\Controllers\Controller;
use App\Models\Department;
use App\Models\ReportFieldDefinition;
use App\Models\ReportTemplate;
use App\Services\Admin\AdminAuditService;
use App\Support\Authorization\Permissions;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

class ReferenceDataController extends Controller
{
    use SerializesAdminResources;

    public function __construct(
        private readonly AdminAuditService $auditService,
    ) {}

    public function templates(Request $request): JsonResponse
    {
        Gate::authorize('viewAny', ReportTemplate::class);

        $validated = $request->validate([
            'family' => ['sometimes', Rule::in(['inpatient', 'outpatient', 'procedure'])],
            'active' => ['sometimes', 'boolean'],
        ]);
        $query = ReportTemplate::query()
            ->with(['fieldDefinitions' => fn ($fieldQuery) => $fieldQuery->orderBy('display_order')])
            ->orderBy('name');

        if (isset($validated['family'])) {
            $query->where('family', $validated['family']);
        }

        if (array_key_exists('active', $validated)) {
            $query->where('active', (bool) $validated['active']);
        }

        return response()->json([
            'data' => $query->get()->map(fn (ReportTemplate $template) => $this->serializeTemplate($template)),
        ]);
    }

    public function storeTemplate(Request $request): JsonResponse
    {
        Gate::authorize('create', ReportTemplate::class);

        $validated = $this->validateTemplate($request);

        return DB::transaction(function () use ($request, $validated): JsonResponse {
            $template = ReportTemplate::query()->create($this->templatePayload($validated));
            $this->syncFields($template, $validated['fields'] ?? []);
            $template->load(['fieldDefinitions' => fn ($query) => $query->orderBy('display_order')]);
            $this->auditService->record($request->user(), 'create', 'report_template', $template->id, null, $this->templateAuditValues($template), $request);

            return response()->json($this->serializeTemplate($template), 201);
        });
    }

    public function showTemplate(string $template): JsonResponse
    {
        $resolvedTemplate = $this->resolveTemplate($template);
        Gate::authorize('view', $resolvedTemplate);

        return response()->json($this->serializeTemplate($resolvedTemplate));
    }

    public function updateTemplate(Request $request, string $template): JsonResponse
    {
        $resolvedTemplate = $this->resolveTemplate($template);
        Gate::authorize('update', $resolvedTemplate);

        $validated = $this->validateTemplate($request, $resolvedTemplate);
        $this->guardStructuralChanges($request, $resolvedTemplate, $validated);

        return DB::transaction(function () use ($request, $resolvedTemplate, $validated): JsonResponse {
            $oldValues = $this->templateAuditValues($resolvedTemplate->load('fieldDefinitions'));
            $payload = $this->templatePayload($validated, partial: true);

            // Preserve sibling metadata keys the editor never sends. The template form
            // only submits metadata.presentation, so a plain content save must merge
            // over the stored metadata — otherwise it wipes metadata.validation_rules
            // (drives clinical quality scoring) and metadata.ui_family. Top-level
            // array_merge replaces `presentation` wholesale (the form owns it) while
            // keeping untouched siblings, mirroring the field-level merge in syncFields.
            if (array_key_exists('metadata', $payload)) {
                $payload['metadata'] = array_merge(
                    $resolvedTemplate->metadata ?? [],
                    is_array($payload['metadata']) ? $payload['metadata'] : [],
                );
            }

            $resolvedTemplate->forceFill($payload)->save();

            if (array_key_exists('fields', $validated)) {
                $this->syncFields($resolvedTemplate, $validated['fields']);
            }

            $resolvedTemplate->refresh()->load(['fieldDefinitions' => fn ($query) => $query->orderBy('display_order')]);
            $this->auditService->record($request->user(), 'update', 'report_template', $resolvedTemplate->id, $oldValues, $this->templateAuditValues($resolvedTemplate), $request);

            return response()->json($this->serializeTemplate($resolvedTemplate));
        });
    }

    public function setTemplateActive(Request $request, string $template): JsonResponse
    {
        $resolvedTemplate = $this->resolveTemplate($template);
        Gate::authorize('update', $resolvedTemplate);

        $validated = $request->validate(['active' => ['required', 'boolean']]);
        $oldValues = $this->templateAuditValues($resolvedTemplate);

        $resolvedTemplate->forceFill(['active' => (bool) $validated['active']])->save();
        $resolvedTemplate->refresh();

        $this->auditService->record($request->user(), 'set_active', 'report_template', $resolvedTemplate->id, $oldValues, $this->templateAuditValues($resolvedTemplate), $request);

        return response()->json($this->serializeTemplate($resolvedTemplate));
    }

    public function setFieldActive(Request $request, string $template, string $field): JsonResponse
    {
        $resolvedTemplate = $this->resolveTemplate($template);
        Gate::authorize('update', $resolvedTemplate);

        $validated = $request->validate(['active' => ['required', 'boolean']]);
        $definition = $resolvedTemplate->fieldDefinitions()->where('field_key', $field)->firstOrFail();

        $oldValues = $definition->only(['field_key', 'active']);
        $definition->forceFill(['active' => (bool) $validated['active']])->save();

        $resolvedTemplate->refresh()->load(['fieldDefinitions' => fn ($query) => $query->orderBy('display_order')]);
        $this->auditService->record($request->user(), 'set_field_active', 'report_template', $resolvedTemplate->id, $oldValues, $definition->only(['field_key', 'active']), $request);

        return response()->json($this->serializeTemplate($resolvedTemplate));
    }

    public function destroyTemplate(Request $request, string $template): JsonResponse
    {
        $resolvedTemplate = $this->resolveTemplate($template);
        Gate::authorize('delete', $resolvedTemplate);
        $this->assertTemplateIsSafeToDelete($resolvedTemplate);

        $oldValues = $this->templateAuditValues($resolvedTemplate->load('fieldDefinitions'));
        $resolvedTemplate->delete();
        $this->auditService->record($request->user(), 'delete', 'report_template', $resolvedTemplate->id, $oldValues, null, $request);

        return response()->json(null, 204);
    }

    public function departments(Request $request): JsonResponse
    {
        Gate::authorize('viewAny', Department::class);

        $validated = $request->validate([
            'family' => ['sometimes', Rule::in(['inpatient', 'outpatient', 'procedure'])],
            'active' => ['sometimes', 'boolean'],
        ]);
        $query = Department::query()->with('template')->orderBy('name');

        if (isset($validated['family'])) {
            $query->where('family', $validated['family']);
        }

        if (array_key_exists('active', $validated)) {
            $query->where('active', (bool) $validated['active']);
        }

        return response()->json([
            'data' => $query->get()->map(fn (Department $department) => $this->serializeDepartment($department)),
        ]);
    }

    public function wards(Request $request): JsonResponse
    {
        $request->merge(['family' => 'inpatient']);

        return $this->departments($request);
    }

    public function storeDepartment(Request $request): JsonResponse
    {
        Gate::authorize('create', Department::class);

        $validated = $this->validateDepartment($request);
        $template = $this->resolveTemplate($validated['template_id'] ?? $validated['templateId']);
        $this->assertTemplateFamily($template, $validated['family']);

        $department = Department::query()->create([
            ...$this->departmentPayload($validated),
            'template_id' => $template->id,
        ]);
        $department->load('template');

        $this->auditService->record($request->user(), 'create', 'department', $department->id, null, $this->departmentAuditValues($department), $request);

        return response()->json($this->serializeDepartment($department), 201);
    }

    public function showDepartment(string $department): JsonResponse
    {
        $resolvedDepartment = $this->resolveDepartment($department);
        Gate::authorize('view', $resolvedDepartment);

        return response()->json($this->serializeDepartment($resolvedDepartment));
    }

    public function updateDepartment(Request $request, string $department): JsonResponse
    {
        $resolvedDepartment = $this->resolveDepartment($department);
        Gate::authorize('update', $resolvedDepartment);

        $validated = $this->validateDepartment($request, $resolvedDepartment);
        $oldValues = $this->departmentAuditValues($resolvedDepartment);
        $updates = $this->departmentPayload($validated, partial: true);

        if (array_key_exists('template_id', $validated) || array_key_exists('templateId', $validated)) {
            $template = $this->resolveTemplate($validated['template_id'] ?? $validated['templateId']);
            $this->assertTemplateFamily($template, $validated['family'] ?? $resolvedDepartment->family);
            $updates['template_id'] = $template->id;
        }

        $resolvedDepartment->forceFill($updates)->save();
        $resolvedDepartment->refresh()->load('template');

        $this->auditService->record($request->user(), 'update', 'department', $resolvedDepartment->id, $oldValues, $this->departmentAuditValues($resolvedDepartment), $request);

        return response()->json($this->serializeDepartment($resolvedDepartment));
    }

    public function setDepartmentActive(Request $request, string $department): JsonResponse
    {
        $resolvedDepartment = $this->resolveDepartment($department);
        Gate::authorize('update', $resolvedDepartment);

        $validated = $request->validate(['active' => ['required', 'boolean']]);
        $oldValues = $this->departmentAuditValues($resolvedDepartment);

        $resolvedDepartment->forceFill(['active' => (bool) $validated['active']])->save();
        $resolvedDepartment->refresh()->load('template');

        $this->auditService->record($request->user(), 'set_active', 'department', $resolvedDepartment->id, $oldValues, $this->departmentAuditValues($resolvedDepartment), $request);

        return response()->json($this->serializeDepartment($resolvedDepartment));
    }

    public function destroyDepartment(Request $request, string $department): JsonResponse
    {
        $resolvedDepartment = $this->resolveDepartment($department);
        Gate::authorize('delete', $resolvedDepartment);
        $this->assertDepartmentIsSafeToDelete($resolvedDepartment);

        $oldValues = $this->departmentAuditValues($resolvedDepartment);
        $resolvedDepartment->delete();
        $this->auditService->record($request->user(), 'delete', 'department', $resolvedDepartment->id, $oldValues, null, $request);

        return response()->json(null, 204);
    }

    private function validateTemplate(Request $request, ?ReportTemplate $template = null): array
    {
        $templateId = $template?->id;

        return $request->validate([
            'slug' => [$template ? 'sometimes' : 'required', 'string', 'max:64', 'regex:/^[a-z0-9._-]+$/', Rule::unique('report_templates', 'slug')->ignore($templateId)],
            'family' => [$template ? 'sometimes' : 'required', Rule::in(['inpatient', 'outpatient', 'procedure'])],
            'name' => [$template ? 'sometimes' : 'required', 'string', 'max:255'],
            'description' => [$template ? 'sometimes' : 'required', 'string'],
            'active_days' => [$template ? 'sometimes' : 'required_without:activeDays', 'array', 'min:1'],
            'activeDays' => [$template ? 'sometimes' : 'required_without:active_days', 'array', 'min:1'],
            'active_days.*' => [Rule::in(['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'])],
            'activeDays.*' => [Rule::in(['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'])],
            'metadata' => ['sometimes', 'array'],
            'active' => ['sometimes', 'boolean'],
            'fields' => ['sometimes', 'array'],
            'fields.*.section_key' => ['required_with:fields', 'string', 'max:64'],
            'fields.*.sectionKey' => ['sometimes', 'string', 'max:64'],
            'fields.*.field_key' => ['required_without:fields.*.fieldKey', 'string', 'max:64'],
            'fields.*.fieldKey' => ['required_without:fields.*.field_key', 'string', 'max:64'],
            'fields.*.label' => ['required_with:fields', 'string', 'max:255'],
            'fields.*.field_kind' => ['required_without:fields.*.fieldKind', Rule::in(['integer', 'decimal', 'time', 'text', 'choice'])],
            'fields.*.fieldKind' => ['required_without:fields.*.field_kind', Rule::in(['integer', 'decimal', 'time', 'text', 'choice'])],
            'fields.*.aggregate_type' => ['required_without:fields.*.aggregateType', Rule::in(['sum', 'average', 'latest', 'none'])],
            'fields.*.aggregateType' => ['required_without:fields.*.aggregate_type', Rule::in(['sum', 'average', 'latest', 'none'])],
            'fields.*.display_order' => ['sometimes', 'integer', 'min:0'],
            'fields.*.displayOrder' => ['sometimes', 'integer', 'min:0'],
            'fields.*.metadata' => ['sometimes', 'array'],
        ]);
    }

    private function validateDepartment(Request $request, ?Department $department = null): array
    {
        return $request->validate([
            'slug' => [$department ? 'sometimes' : 'required', 'string', 'max:64', 'regex:/^[a-z0-9._-]+$/', Rule::unique('departments', 'slug')->ignore($department?->id)],
            'family' => [$department ? 'sometimes' : 'required', Rule::in(['inpatient', 'outpatient', 'procedure'])],
            'template_id' => [$department ? 'sometimes' : 'required_without:templateId', 'string', 'max:80'],
            'templateId' => [$department ? 'sometimes' : 'required_without:template_id', 'string', 'max:80'],
            'name' => [$department ? 'sometimes' : 'required', 'string', 'max:255'],
            'description' => [$department ? 'sometimes' : 'required', 'string'],
            'accent_color' => ['sometimes', 'nullable', 'string', 'max:16'],
            'accentColor' => ['sometimes', 'nullable', 'string', 'max:16'],
            'bed_count' => ['sometimes', 'nullable', 'integer', 'min:0'],
            'bedCount' => ['sometimes', 'nullable', 'integer', 'min:0'],
            'active' => ['sometimes', 'boolean'],
        ]);
    }

    private function templatePayload(array $validated, bool $partial = false): array
    {
        return $this->payload($validated, [
            'slug' => 'slug',
            'family' => 'family',
            'name' => 'name',
            'description' => 'description',
            'active_days' => 'activeDays',
            'metadata' => 'metadata',
            'active' => 'active',
        ], $partial);
    }

    private function departmentPayload(array $validated, bool $partial = false): array
    {
        return $this->payload($validated, [
            'slug' => 'slug',
            'family' => 'family',
            'name' => 'name',
            'description' => 'description',
            'accent_color' => 'accentColor',
            'bed_count' => 'bedCount',
            'active' => 'active',
        ], $partial);
    }

    private function payload(array $validated, array $keys, bool $partial): array
    {
        $payload = [];

        foreach ($keys as $snakeKey => $camelKey) {
            if (array_key_exists($snakeKey, $validated)) {
                $payload[$snakeKey] = $validated[$snakeKey];
            } elseif (array_key_exists($camelKey, $validated)) {
                $payload[$snakeKey] = $validated[$camelKey];
            } elseif (! $partial && $snakeKey === 'metadata') {
                $payload[$snakeKey] = [];
            }
        }

        return $payload;
    }

    private function syncFields(ReportTemplate $template, array $fields): void
    {
        foreach ($fields as $index => $field) {
            $fieldKey = $field['field_key'] ?? $field['fieldKey'];
            $existing = ReportFieldDefinition::query()
                ->where('template_id', $template->id)
                ->where('field_key', $fieldKey)
                ->first();

            // Merge incoming metadata over what's persisted so a content edit that
            // omits some flags (unit/options/highlight) never wipes them.
            $metadata = array_merge($existing?->metadata ?? [], $field['metadata'] ?? []);

            ReportFieldDefinition::query()->updateOrCreate(
                [
                    'template_id' => $template->id,
                    'field_key' => $fieldKey,
                ],
                [
                    'section_key' => $field['section_key'] ?? $field['sectionKey'],
                    'label' => $field['label'],
                    'field_kind' => $field['field_kind'] ?? $field['fieldKind'],
                    'aggregate_type' => $field['aggregate_type'] ?? $field['aggregateType'],
                    'display_order' => $field['display_order'] ?? $field['displayOrder'] ?? (($index + 1) * 10),
                    'metadata' => $metadata,
                ],
            );
        }
    }

    /**
     * Enforce the content/structure permission split. Admins (templates.edit-content)
     * may edit safe attributes; only Maintenance (templates.edit-structure) may make
     * structural changes — rename the slug/family, add a new field, or change a field
     * type. Field keys with saved values stay immutable regardless (protects history).
     */
    private function guardStructuralChanges(Request $request, ReportTemplate $template, array $validated): void
    {
        if (Permissions::userCan($request->user(), Permissions::TEMPLATES_EDIT_STRUCTURE)) {
            return;
        }

        $newSlug = $validated['slug'] ?? null;
        if ($newSlug !== null && $newSlug !== $template->slug) {
            throw ValidationException::withMessages(['slug' => 'Only Maintenance can change a template key.']);
        }

        $newFamily = $validated['family'] ?? null;
        if ($newFamily !== null && $newFamily !== $template->family) {
            throw ValidationException::withMessages(['family' => 'Only Maintenance can change a template service line.']);
        }

        if (! array_key_exists('fields', $validated)) {
            return;
        }

        $existing = $template->fieldDefinitions()->get()->keyBy('field_key');
        foreach ($validated['fields'] as $field) {
            $key = $field['field_key'] ?? $field['fieldKey'] ?? null;
            $current = $key ? $existing->get($key) : null;

            if (! $current) {
                throw ValidationException::withMessages(['fields' => 'Only Maintenance can add new fields to a template.']);
            }

            $kind = $field['field_kind'] ?? $field['fieldKind'] ?? null;
            if ($kind !== null && $kind !== $current->field_kind) {
                throw ValidationException::withMessages(['fields' => 'Only Maintenance can change a field type.']);
            }
        }
    }

    private function resolveTemplate(string $identifier): ReportTemplate
    {
        return ReportTemplate::query()
            ->where(fn (Builder $query) => $query->where('id', $identifier)->orWhere('slug', $identifier))
            ->firstOrFail();
    }

    private function resolveDepartment(string $identifier): Department
    {
        return Department::query()
            ->where(fn (Builder $query) => $query->where('id', $identifier)->orWhere('slug', $identifier))
            ->firstOrFail();
    }

    private function assertTemplateFamily(ReportTemplate $template, string $family): void
    {
        if ($template->family !== $family) {
            throw ValidationException::withMessages([
                'template_id' => 'The selected template family must match the department family.',
            ]);
        }
    }

    private function assertTemplateIsSafeToDelete(ReportTemplate $template): void
    {
        if ($template->departments()->exists() || $template->assignments()->exists() || $template->reports()->exists()) {
            throw ValidationException::withMessages([
                'template' => 'Templates can only be deleted before departments, assignments, or reports reference them.',
            ]);
        }
    }

    private function assertDepartmentIsSafeToDelete(Department $department): void
    {
        if ($department->assignments()->exists() || $department->reports()->exists() || $department->accessRequestItems()->exists()) {
            throw ValidationException::withMessages([
                'department' => 'Departments can only be deleted before requests, assignments, or reports reference them.',
            ]);
        }
    }

    private function templateAuditValues(ReportTemplate $template): array
    {
        return [
            ...$template->only(['id', 'slug', 'family', 'name', 'description', 'active_days', 'metadata', 'active']),
            'fields' => $template->relationLoaded('fieldDefinitions')
                ? $template->fieldDefinitions->map(fn (ReportFieldDefinition $field) => $field->only(['section_key', 'field_key', 'label', 'field_kind', 'aggregate_type', 'display_order', 'active', 'metadata']))->values()->all()
                : null,
        ];
    }

    private function departmentAuditValues(Department $department): array
    {
        return $department->only(['id', 'slug', 'family', 'template_id', 'name', 'description', 'accent_color', 'bed_count', 'active']);
    }
}
