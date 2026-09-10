<?php

namespace App\Http\Controllers\Api\Admin;

use App\Http\Controllers\Controller;
use App\Models\DutyType;
use App\Models\Section;
use App\Models\User;
use App\Models\Ward;
use App\Services\Admin\AdminAuditService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

/**
 * Admin CRUD for the academic structure: teaching wards, specialty sections,
 * and the duty-type catalog. All three are reference data the department can
 * extend without a code change.
 */
class AcademicStructureController extends Controller
{
    public function __construct(
        private readonly AdminAuditService $auditService,
    ) {}

    // ---- Wards ----

    public function wards(): JsonResponse
    {
        Gate::authorize('viewAny', Ward::class);

        return response()->json([
            'data' => Ward::query()->orderBy('name')->get()->map(fn (Ward $ward) => $this->serializeWard($ward)),
        ]);
    }

    public function storeWard(Request $request): JsonResponse
    {
        Gate::authorize('create', Ward::class);

        $validated = $request->validate([
            'name' => ['required', 'string', 'max:120'],
            'slug' => ['sometimes', 'nullable', 'string', 'max:64', Rule::unique('wards', 'slug')],
            'active' => ['sometimes', 'boolean'],
        ]);

        $ward = Ward::query()->create([
            'name' => $validated['name'],
            'slug' => $this->resolveSlug($validated['slug'] ?? null, $validated['name'], 'wards'),
            'active' => $validated['active'] ?? true,
        ]);

        $this->auditService->record($request->user(), 'create', 'ward', $ward->id, null, $this->serializeWard($ward), $request);

        return response()->json($this->serializeWard($ward), 201);
    }

    public function updateWard(Request $request, Ward $ward): JsonResponse
    {
        Gate::authorize('update', $ward);

        $validated = $request->validate([
            'name' => ['sometimes', 'string', 'max:120'],
            'slug' => ['sometimes', 'string', 'max:64', Rule::unique('wards', 'slug')->ignore($ward->id)],
            'active' => ['sometimes', 'boolean'],
        ]);

        $oldValues = $this->serializeWard($ward);
        $ward->forceFill($validated)->save();
        $ward->refresh();

        $this->auditService->record($request->user(), 'update', 'ward', $ward->id, $oldValues, $this->serializeWard($ward), $request);

        return response()->json($this->serializeWard($ward));
    }

    public function destroyWard(Request $request, Ward $ward): JsonResponse
    {
        Gate::authorize('delete', $ward);

        // Every table that points at a ward, not only the two the catalog
        // owns: a placement's foreign key is restrict-on-delete (the database
        // would answer with a 500), and the evaluation and teaching-session
        // ward columns are null-on-delete snapshots that a delete would wipe
        // silently. Both belong behind the same "deactivate instead" refusal.
        if ($ward->dutyTypes()->exists()
            || $ward->departments()->exists()
            || $ward->subgroupPlacements()->exists()
            || $ward->teachingSessions()->exists()
            || $ward->evaluations()->exists()) {
            throw ValidationException::withMessages([
                'ward' => ['This ward is referenced by duty types, departments, student placements, teaching sessions or evaluations. Deactivate it instead.'],
            ]);
        }

        $oldValues = $this->serializeWard($ward);
        $ward->delete();
        $this->auditService->record($request->user(), 'delete', 'ward', $ward->id, $oldValues, null, $request);

        return response()->json(null, 204);
    }

    // ---- Sections ----

    public function sections(): JsonResponse
    {
        Gate::authorize('viewAny', Section::class);

        return response()->json([
            'data' => Section::query()
                ->with('head')
                ->withCount('consultants')
                ->orderBy('name')
                ->get()
                ->map(fn (Section $section) => $this->serializeSection($section)),
        ]);
    }

    public function storeSection(Request $request): JsonResponse
    {
        Gate::authorize('create', Section::class);

        $validated = $request->validate([
            'name' => ['required', 'string', 'max:120'],
            'slug' => ['sometimes', 'nullable', 'string', 'max:64', Rule::unique('sections', 'slug')],
            'headUserId' => ['sometimes', 'nullable', 'string', Rule::exists('users', 'id')],
            'active' => ['sometimes', 'boolean'],
        ]);

        $this->assertHeadIsConsultant($validated['headUserId'] ?? null);

        $section = Section::query()->create([
            'name' => $validated['name'],
            'slug' => $this->resolveSlug($validated['slug'] ?? null, $validated['name'], 'sections'),
            'head_user_id' => $validated['headUserId'] ?? null,
            'active' => $validated['active'] ?? true,
        ]);
        $section->load('head')->loadCount('consultants');

        $this->auditService->record($request->user(), 'create', 'section', $section->id, null, $this->serializeSection($section), $request);

        return response()->json($this->serializeSection($section), 201);
    }

    public function updateSection(Request $request, Section $section): JsonResponse
    {
        Gate::authorize('update', $section);

        $validated = $request->validate([
            'name' => ['sometimes', 'string', 'max:120'],
            'slug' => ['sometimes', 'string', 'max:64', Rule::unique('sections', 'slug')->ignore($section->id)],
            'headUserId' => ['sometimes', 'nullable', 'string', Rule::exists('users', 'id')],
            'active' => ['sometimes', 'boolean'],
        ]);

        if (array_key_exists('headUserId', $validated)) {
            $this->assertHeadIsConsultant($validated['headUserId']);
        }

        $oldValues = $this->serializeSection($section->load('head')->loadCount('consultants'));

        $section->forceFill([
            ...collect($validated)->except('headUserId')->all(),
            ...(array_key_exists('headUserId', $validated) ? ['head_user_id' => $validated['headUserId']] : []),
        ])->save();
        $section->refresh()->load('head')->loadCount('consultants');

        $this->auditService->record($request->user(), 'update', 'section', $section->id, $oldValues, $this->serializeSection($section), $request);

        return response()->json($this->serializeSection($section));
    }

    /**
     * Direct admin section change, no transfer request. The transfer workflow
     * (request -> head approval -> boundary application) remains the
     * consultant-initiated path; this is the administrative override.
     */
    public function setSectionConsultant(Request $request, Section $section): JsonResponse
    {
        Gate::authorize('update', $section);

        $validated = $request->validate([
            'userId' => ['required', 'string', Rule::exists('users', 'id')],
        ]);

        $consultant = User::query()->findOrFail($validated['userId']);

        if ($consultant->role_key !== 'consultant' || ! $consultant->active) {
            throw ValidationException::withMessages([
                'userId' => ['Only an active consultant can be assigned to a section.'],
            ]);
        }

        $oldSectionId = $consultant->section_id;
        $consultant->forceFill(['section_id' => $section->id])->save();

        $this->auditService->record($request->user(), 'set_consultant_section', 'section', $section->id, [
            'userId' => $consultant->id,
            'sectionId' => $oldSectionId,
        ], [
            'userId' => $consultant->id,
            'sectionId' => $section->id,
        ], $request);

        return response()->json([
            'userId' => $consultant->id,
            'sectionId' => $section->id,
        ]);
    }

    public function destroySection(Request $request, Section $section): JsonResponse
    {
        Gate::authorize('delete', $section);

        // transfer_requests.from/to_section_id are restrict-on-delete, so a
        // section with any transfer history would otherwise answer a delete
        // with the database's own refusal (a 500) instead of this 422.
        if ($section->dutyTypes()->exists()
            || $section->consultants()->exists()
            || $section->inboundTransferRequests()->exists()
            || $section->outboundTransferRequests()->exists()) {
            throw ValidationException::withMessages([
                'section' => ['This section is referenced by duty types, consultants or transfer requests. Deactivate it instead.'],
            ]);
        }

        $oldValues = $this->serializeSection($section->load('head')->loadCount('consultants'));
        $section->delete();
        $this->auditService->record($request->user(), 'delete', 'section', $section->id, $oldValues, null, $request);

        return response()->json(null, 204);
    }

    // ---- Duty types ----

    public function dutyTypes(): JsonResponse
    {
        Gate::authorize('viewAny', DutyType::class);

        return response()->json([
            'data' => DutyType::query()
                ->with(['section', 'ward'])
                ->orderBy('name')
                ->get()
                ->map(fn (DutyType $dutyType) => $this->serializeDutyType($dutyType)),
        ]);
    }

    public function storeDutyType(Request $request): JsonResponse
    {
        Gate::authorize('create', DutyType::class);

        $validated = $this->validateDutyType($request);

        $dutyType = DutyType::query()->create([
            'name' => $validated['name'],
            'slug' => $this->resolveSlug($validated['slug'] ?? null, $validated['name'], 'duty_types'),
            'section_id' => $validated['sectionId'] ?? null,
            'ward_id' => $validated['wardId'] ?? null,
            'category' => $validated['category'],
            'granularity' => $validated['granularity'],
            'pairs_for_evaluation' => $validated['pairsForEvaluation'] ?? false,
            'pairing_group' => $validated['pairingGroup'] ?? null,
            'counts_for_morning_roster' => $validated['countsForMorningRoster'] ?? true,
            'active' => $validated['active'] ?? true,
        ]);
        $dutyType->load(['section', 'ward']);

        $this->auditService->record($request->user(), 'create', 'duty_type', $dutyType->id, null, $this->serializeDutyType($dutyType), $request);

        return response()->json($this->serializeDutyType($dutyType), 201);
    }

    public function updateDutyType(Request $request, DutyType $dutyType): JsonResponse
    {
        Gate::authorize('update', $dutyType);

        $validated = $this->validateDutyType($request, $dutyType);
        $oldValues = $this->serializeDutyType($dutyType->load(['section', 'ward']));

        $updates = collect($validated)
            ->except(['sectionId', 'wardId', 'pairsForEvaluation', 'pairingGroup', 'countsForMorningRoster'])
            ->all();

        foreach ([
            'sectionId' => 'section_id',
            'wardId' => 'ward_id',
            'pairsForEvaluation' => 'pairs_for_evaluation',
            'pairingGroup' => 'pairing_group',
            'countsForMorningRoster' => 'counts_for_morning_roster',
        ] as $camel => $snake) {
            if (array_key_exists($camel, $validated)) {
                $updates[$snake] = $validated[$camel];
            }
        }

        $dutyType->forceFill($updates)->save();
        $dutyType->refresh()->load(['section', 'ward']);

        $this->auditService->record($request->user(), 'update', 'duty_type', $dutyType->id, $oldValues, $this->serializeDutyType($dutyType), $request);

        return response()->json($this->serializeDutyType($dutyType));
    }

    public function destroyDutyType(Request $request, DutyType $dutyType): JsonResponse
    {
        Gate::authorize('delete', $dutyType);

        if ($dutyType->assignments()->exists()) {
            throw ValidationException::withMessages([
                'dutyType' => ['This duty type has assignments on the roster. Deactivate it instead.'],
            ]);
        }

        $oldValues = $this->serializeDutyType($dutyType->load(['section', 'ward']));
        $dutyType->delete();
        $this->auditService->record($request->user(), 'delete', 'duty_type', $dutyType->id, $oldValues, null, $request);

        return response()->json(null, 204);
    }

    // ---- Helpers ----

    private function validateDutyType(Request $request, ?DutyType $existing = null): array
    {
        $required = $existing === null ? 'required' : 'sometimes';

        return $request->validate([
            'name' => [$required, 'string', 'max:120'],
            'slug' => ['sometimes', 'nullable', 'string', 'max:64', Rule::unique('duty_types', 'slug')->ignore($existing?->id)],
            'sectionId' => ['sometimes', 'nullable', 'string', Rule::exists('sections', 'id')],
            'wardId' => ['sometimes', 'nullable', 'string', Rule::exists('wards', 'id')],
            'category' => [$required, 'string', Rule::in(DutyType::CATEGORIES)],
            'granularity' => [$required, 'string', Rule::in(DutyType::GRANULARITIES)],
            'pairsForEvaluation' => ['sometimes', 'boolean'],
            'pairingGroup' => ['sometimes', 'nullable', 'string', 'max:32'],
            'countsForMorningRoster' => ['sometimes', 'boolean'],
            'active' => ['sometimes', 'boolean'],
        ]);
    }

    private function assertHeadIsConsultant(?string $userId): void
    {
        if ($userId === null) {
            return;
        }

        $isConsultant = User::query()
            ->where('id', $userId)
            ->where('role_key', 'consultant')
            ->where('active', true)
            ->exists();

        if (! $isConsultant) {
            throw ValidationException::withMessages([
                'headUserId' => ['A section head must be an active consultant.'],
            ]);
        }
    }

    private function resolveSlug(?string $slug, string $name, string $table): string
    {
        $candidate = $slug !== null && $slug !== ''
            ? Str::slug($slug, '_')
            : Str::slug($name, '_');

        $base = $candidate;
        $suffix = 2;

        while (DB::table($table)->where('slug', $candidate)->exists()) {
            $candidate = "{$base}_{$suffix}";
            $suffix++;
        }

        return $candidate;
    }

    private function serializeWard(Ward $ward): array
    {
        return [
            'id' => $ward->id,
            'slug' => $ward->slug,
            'name' => $ward->name,
            'active' => (bool) $ward->active,
        ];
    }

    private function serializeSection(Section $section): array
    {
        return [
            'id' => $section->id,
            'slug' => $section->slug,
            'name' => $section->name,
            'headUserId' => $section->head_user_id,
            'headName' => $section->head?->full_name,
            'consultantCount' => (int) ($section->consultants_count ?? 0),
            'active' => (bool) $section->active,
        ];
    }

    private function serializeDutyType(DutyType $dutyType): array
    {
        return [
            'id' => $dutyType->id,
            'slug' => $dutyType->slug,
            'name' => $dutyType->name,
            'sectionId' => $dutyType->section_id,
            'sectionName' => $dutyType->section?->name,
            'wardId' => $dutyType->ward_id,
            'wardName' => $dutyType->ward?->name,
            'category' => $dutyType->category,
            'granularity' => $dutyType->granularity,
            'pairsForEvaluation' => (bool) $dutyType->pairs_for_evaluation,
            'pairingGroup' => $dutyType->pairing_group,
            'countsForMorningRoster' => (bool) $dutyType->counts_for_morning_roster,
            'active' => (bool) $dutyType->active,
        ];
    }
}
