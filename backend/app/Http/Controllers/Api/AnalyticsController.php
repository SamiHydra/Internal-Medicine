<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\ReportingPeriod;
use App\Services\Analytics\AnalyticsExportService;
use App\Support\Export\XlsxWriter;
use App\Services\Analytics\AnalyticsFilters;
use App\Services\Analytics\AnalyticsService;
use App\Services\Analytics\DashboardAnalyticsService;
use App\Services\Analytics\InpatientAnalyticsService;
use App\Services\Analytics\OutpatientAnalyticsService;
use App\Services\Analytics\ProcedureAnalyticsService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Collection;
use Illuminate\Validation\Rule;
use Symfony\Component\HttpFoundation\StreamedResponse;

class AnalyticsController extends Controller
{
    public function __construct(
        private readonly AnalyticsService $analytics,
        private readonly DashboardAnalyticsService $dashboardAnalytics,
        private readonly InpatientAnalyticsService $inpatientAnalytics,
        private readonly OutpatientAnalyticsService $outpatientAnalytics,
        private readonly ProcedureAnalyticsService $procedureAnalytics,
        private readonly AnalyticsExportService $exportService,
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

    public function export(Request $request): \Symfony\Component\HttpFoundation\Response
    {
        $validated = $request->validate([
            'period' => ['sometimes', 'uuid', 'exists:reporting_periods,id'],
            'periodId' => ['sometimes', 'uuid', 'exists:reporting_periods,id'],
            'month' => ['sometimes', 'date_format:Y-m'],
            'format' => ['sometimes', 'in:csv,xlsx'],
        ]);

        $periods = $this->resolveExportPeriods($validated);

        if ($periods->isEmpty()) {
            abort(404, 'No reporting period matched the export request.');
        }

        $label = $periods->count() === 1
            ? ($periods->first()->week_start?->toDateString() ?? 'period')
            : ($validated['month'] ?? 'periods');

        if (($validated['format'] ?? 'csv') === 'xlsx') {
            $path = (new XlsxWriter())->toTempFile(
                $this->exportService->header(),
                $this->exportService->lazyRows($periods),
            );

            return response()->download(
                $path,
                'st-paul-report-'.$label.'.xlsx',
                ['Content-Type' => 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
            )->deleteFileAfterSend();
        }

        return response()->streamDownload(
            $this->exportService->streamCallback($periods),
            'st-paul-report-'.$label.'.csv',
            ['Content-Type' => 'text/csv; charset=UTF-8'],
        );
    }

    /**
     * @param  array<string, mixed>  $validated
     * @return Collection<int, ReportingPeriod>
     */
    private function resolveExportPeriods(array $validated): Collection
    {
        $periodId = $validated['period'] ?? $validated['periodId'] ?? null;
        if ($periodId !== null) {
            return ReportingPeriod::query()->whereKey($periodId)->get();
        }

        if (isset($validated['month'])) {
            [$year, $month] = explode('-', $validated['month']);

            return ReportingPeriod::query()
                ->whereYear('week_start', (int) $year)
                ->whereMonth('week_start', (int) $month)
                ->orderBy('week_start')
                ->get();
        }

        return ReportingPeriod::query()
            ->whereDate('week_start', '<=', now()->toDateString())
            ->orderByDesc('week_start')
            ->limit(1)
            ->get();
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

        return AnalyticsFilters::fromArray($validated);
    }
}
