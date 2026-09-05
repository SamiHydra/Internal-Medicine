<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Jobs\BuildAnalyticsExport;
use App\Models\AnalyticsExport;
use App\Services\Analytics\AnalyticsExportService;
use App\Services\Analytics\AnalyticsFilters;
use App\Services\Analytics\AnalyticsService;
use App\Services\Analytics\DashboardAnalyticsService;
use App\Services\Analytics\InpatientAnalyticsService;
use App\Services\Analytics\OutpatientAnalyticsService;
use App\Services\Analytics\ProcedureAnalyticsService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;
use Symfony\Component\HttpFoundation\Response;

class AnalyticsController extends Controller
{
    public function __construct(
        private readonly AnalyticsService $analytics,
        private readonly DashboardAnalyticsService $dashboardAnalytics,
        private readonly InpatientAnalyticsService $inpatientAnalytics,
        private readonly OutpatientAnalyticsService $outpatientAnalytics,
        private readonly ProcedureAnalyticsService $procedureAnalytics,
    ) {}

    public function overview(Request $request): JsonResponse
    {
        return response()->json($this->analytics->overview($this->filters($request)));
    }

    public function dashboard(Request $request): JsonResponse
    {
        return response()->json($this->dashboardAnalytics->summary($this->filters($request)));
    }

    public function inpatient(Request $request): JsonResponse
    {
        return response()->json($this->inpatientAnalytics->summary($this->filters($request)));
    }

    public function outpatient(Request $request): JsonResponse
    {
        return response()->json($this->outpatientAnalytics->summary($this->filters($request)));
    }

    public function procedures(Request $request): JsonResponse
    {
        return response()->json($this->procedureAnalytics->summary($this->filters($request)));
    }

    public function weekly(Request $request): JsonResponse
    {
        $filters = $this->filters($request);

        return response()->json([
            'scope' => $this->analytics->scope($filters),
            'data' => $this->analytics->weekly($filters),
        ]);
    }

    public function monthly(Request $request): JsonResponse
    {
        $filters = $this->filters($request);

        return response()->json([
            'scope' => $this->analytics->scope($filters),
            'data' => $this->analytics->monthly($filters),
        ]);
    }

    public function quarterly(Request $request): JsonResponse
    {
        $filters = $this->filters($request);

        return response()->json([
            'scope' => $this->analytics->scope($filters),
            'data' => $this->analytics->quarterly($filters),
        ]);
    }

    public function yearly(Request $request): JsonResponse
    {
        $filters = $this->filters($request);

        return response()->json([
            'scope' => $this->analytics->scope($filters),
            'data' => $this->analytics->yearly($filters),
        ]);
    }

    public function departments(Request $request): JsonResponse
    {
        $filters = $this->filters($request);

        return response()->json([
            'scope' => $this->analytics->scope($filters),
            'data' => $this->analytics->departmentSummaries($filters),
        ]);
    }

    public function wards(Request $request): JsonResponse
    {
        $filters = $this->filters($request);

        return response()->json([
            'scope' => $this->analytics->scope($filters, 'inpatient'),
            'data' => $this->analytics->departmentSummaries($filters, 'inpatient'),
        ]);
    }

    /**
     * How many reports a given ward/date selection covers, so the export screen
     * can show the size before anyone commits to building it.
     */
    public function exportScope(Request $request): JsonResponse
    {
        $filters = $this->exportFilters($request);

        return response()->json([
            'data' => [
                'reports' => app(AnalyticsExportService::class)->withFilters($filters)->reportCount(),
                'limit' => AnalyticsExportService::maxReports(),
            ],
        ]);
    }

    /**
     * Shared by the preview and the queue call so the count someone sees is the
     * count the ceiling is applied to.
     *
     * @return array{departmentIds?: list<string>, dateFrom?: string, dateTo?: string}
     */
    private function exportFilters(Request $request): array
    {
        $validated = $request->validate([
            'departments' => ['sometimes', 'array'],
            'departments.*' => ['string', 'exists:departments,slug'],
            'dateFrom' => ['sometimes', 'nullable', 'date_format:Y-m-d'],
            'dateTo' => ['sometimes', 'nullable', 'date_format:Y-m-d', 'after_or_equal:dateFrom'],
        ]);

        // Clients address wards by slug; the stored filter keeps ids so a later
        // rename cannot change what an already-built export covered.
        $departmentIds = $validated['departments'] ?? []
            ? DB::table('departments')->whereIn('slug', $validated['departments'])->pluck('id')->all()
            : [];

        return array_filter([
            'departmentIds' => $departmentIds,
            'dateFrom' => $validated['dateFrom'] ?? null,
            'dateTo' => $validated['dateTo'] ?? null,
        ], static fn ($value): bool => $value !== null && $value !== []);
    }

    public function queueExport(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'format' => ['sometimes', 'in:csv,xlsx'],
        ]);

        $filters = $this->exportFilters($request);

        // Checked before anything is queued: refusing a request costs nothing,
        // whereas abandoning a half-built workbook has already cost the memory.
        $reportCount = app(AnalyticsExportService::class)->withFilters($filters)->reportCount();

        if ($reportCount > AnalyticsExportService::maxReports()) {
            throw ValidationException::withMessages([
                'dateFrom' => sprintf(
                    'That range covers %s reports, over the %s limit. Narrow the wards or dates.',
                    number_format($reportCount),
                    number_format(AnalyticsExportService::maxReports()),
                ),
            ]);
        }

        $export = AnalyticsExport::query()->create([
            'user_id' => $request->user()->id,
            'status' => AnalyticsExport::STATUS_PENDING,
            'format' => $validated['format'] ?? 'xlsx',
            'filters' => $filters ?: null,
        ]);

        BuildAnalyticsExport::dispatch($export->id)->afterCommit();

        return response()->json(['data' => $this->exportPayload($export)], 202);
    }

    public function exports(Request $request): JsonResponse
    {
        $exports = AnalyticsExport::query()
            ->where('user_id', $request->user()->id)
            ->latest()
            ->limit(20)
            ->get()
            ->map($this->exportPayload(...));

        return response()->json(['data' => $exports]);
    }

    public function download(Request $request, AnalyticsExport $analyticsExport): Response
    {
        abort_unless($analyticsExport->user_id === $request->user()->id, 403);
        abort_unless($analyticsExport->status === AnalyticsExport::STATUS_READY, 409, 'The export is not ready.');
        abort_if($analyticsExport->expires_at?->isPast(), 410, 'The export has expired.');
        abort_unless($analyticsExport->file_path && Storage::disk('local')->exists($analyticsExport->file_path), 404);

        $isExcel = $analyticsExport->format === 'xlsx';

        return Storage::disk('local')->download(
            $analyticsExport->file_path,
            $analyticsExport->file_name ?? (
                $isExcel
                    ? 'clinical-submissions-full-history.xlsx'
                    : 'clinical-submissions-full-history.csv'
            ),
            [
                'Content-Type' => $isExcel
                    ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
                    : 'text/csv; charset=UTF-8',
            ],
        );
    }

    private function filters(Request $request): AnalyticsFilters
    {
        $validated = $request->validate([
            'period_id' => ['sometimes', 'uuid'],
            'periodId' => ['sometimes', 'uuid'],
            'week_start' => ['sometimes', 'date_format:Y-m-d'],
            'week' => ['sometimes', 'date_format:Y-m-d'],
            'month' => ['sometimes', 'date_format:Y-m'],
            'year' => ['sometimes', 'integer', 'between:2000,2100'],
            'date_from' => ['sometimes', 'date_format:Y-m-d'],
            'dateFrom' => ['sometimes', 'date_format:Y-m-d'],
            'date_to' => ['sometimes', 'date_format:Y-m-d'],
            'dateTo' => ['sometimes', 'date_format:Y-m-d'],
            'department_id' => ['sometimes', 'string', 'max:80'],
            'department' => ['sometimes', 'string', 'max:80'],
            'ward_id' => ['sometimes', 'string', 'max:80'],
            'ward' => ['sometimes', 'string', 'max:80'],
            'family' => ['sometimes', Rule::in(['inpatient', 'outpatient', 'procedure'])],
            'report_type' => ['sometimes', 'string', 'max:80'],
            'reportType' => ['sometimes', 'string', 'max:80'],
            'procedure_category' => ['sometimes', 'string', 'max:80'],
            'procedureCategory' => ['sometimes', 'string', 'max:80'],
        ]);

        return AnalyticsFilters::fromArray($validated)->boundedInteractive();
    }

    /**
     * @return array<string, mixed>
     */
    private function exportPayload(AnalyticsExport $export): array
    {
        return [
            'id' => $export->id,
            'status' => $export->status,
            'format' => $export->format,
            'fileName' => $export->file_name,
            'rowCount' => $export->row_count,
            'byteSize' => $export->byte_size,
            'error' => $export->error,
            'createdAt' => $export->created_at?->toIso8601String(),
            'completedAt' => $export->completed_at?->toIso8601String(),
            'expiresAt' => $export->expires_at?->toIso8601String(),
            'downloadUrl' => $export->status === AnalyticsExport::STATUS_READY
                ? "/api/analytics/exports/{$export->id}/download"
                : null,
        ];
    }
}
