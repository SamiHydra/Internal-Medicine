<?php

namespace Tests\Feature;

use App\Models\Department;
use App\Models\Report;
use App\Models\ReportAssignment;
use App\Models\ReportFieldDefinition;
use App\Models\ReportFieldValue;
use App\Models\ReportingPeriod;
use App\Models\User;
use App\Services\Analytics\AnalyticsFilters;
use App\Services\Analytics\AnalyticsService;
use App\Services\Analytics\DashboardAnalyticsService;
use Database\Seeders\DepartmentSeeder;
use Database\Seeders\ReportFieldDefinitionSeeder;
use Database\Seeders\ReportTemplateSeeder;
use Database\Seeders\RoleSeeder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/**
 * Guards the SHAPE of the analytics work, not its numbers - AnalyticsTest
 * already covers the numbers.
 *
 * Two properties were expensive to win and are invisible to an assertion-based
 * test, so they would regress silently:
 *
 *  1. Field values are aggregated in SQL and never hydrated. Re-adding a
 *     `fieldValues` eager load (or letting one lazy load) puts tens of
 *     thousands of Eloquent models back into a year-long dashboard, which is
 *     what previously exhausted PHP's memory limit outright.
 *  2. Nothing queries per reporting period. Every summary and chart bucket is
 *     served from one pass over the reports, so the query count is flat no
 *     matter how deep the archive is.
 *
 * Both are asserted deterministically (relation state and query counts), never
 * by timing, so this test cannot flake on a slow machine.
 */
class AnalyticsQueryShapeTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();

        foreach ([RoleSeeder::class, ReportTemplateSeeder::class, DepartmentSeeder::class, ReportFieldDefinitionSeeder::class] as $seeder) {
            $this->seed($seeder);
        }
    }

    protected function tearDown(): void
    {
        Model::preventLazyLoading(false);

        parent::tearDown();
    }

    public function test_dashboard_never_hydrates_report_field_values(): void
    {
        $this->buildHistory(6);

        // Any lazy load now raises instead of quietly costing a query per report.
        Model::preventLazyLoading();

        $analytics = app(AnalyticsService::class);
        $analytics->flushMemo();
        $reports = $analytics->reports($this->filters());

        $this->assertGreaterThan(0, $reports->count());
        $this->assertFalse(
            $reports->first()->relationLoaded('fieldValues'),
            'reports() must not eager load fieldValues; the aggregates come from SQL.',
        );

        // Building the whole payload must not touch the relation either.
        Cache::flush();
        $payload = app(DashboardAnalyticsService::class)->summary($this->filters());

        $this->assertGreaterThan(0, $payload['overview']['summary']['totalReports']);
        $this->assertSame(
            0,
            ReportFieldValue::query()->whereIn('report_id', $reports->pluck('id'))->count()
                ? $reports->filter(fn (Report $report) => $report->relationLoaded('fieldValues'))->count()
                : 0,
            'No report may end up with its fieldValues relation loaded.',
        );
    }

    public function test_query_count_does_not_grow_with_the_length_of_the_archive(): void
    {
        $shallow = $this->countDashboardQueries(3);

        $this->refreshDatabaseForDeeperHistory();

        $deep = $this->countDashboardQueries(15);

        // Five times the history must not mean more queries. A per-period or
        // per-bucket query would show up here immediately.
        $this->assertLessThanOrEqual(
            $shallow,
            $deep,
            sprintf('Dashboard issued %d queries over 15 weeks vs %d over 3 - something now queries per period.', $deep, $shallow),
        );
    }

    private function countDashboardQueries(int $weeks): int
    {
        $this->buildHistory($weeks);

        Cache::flush();
        app(AnalyticsService::class)->flushMemo();

        DB::flushQueryLog();
        DB::enableQueryLog();
        app(DashboardAnalyticsService::class)->summary($this->filters());
        $queries = count(DB::getQueryLog());
        DB::disableQueryLog();

        return $queries;
    }

    /** Wipe only the operational rows, keeping the seeded reference data. */
    private function refreshDatabaseForDeeperHistory(): void
    {
        ReportFieldValue::query()->delete();
        Report::query()->delete();
        ReportAssignment::query()->delete();
        ReportingPeriod::query()->delete();
    }

    private function filters(): AnalyticsFilters
    {
        return AnalyticsFilters::fromArray([
            'dateFrom' => '2020-01-01',
            'dateTo' => '2030-01-01',
        ]);
    }

    /**
     * One inpatient and one outpatient unit reporting every week for $weeks,
     * with real field values so the aggregates have something to sum.
     */
    private function buildHistory(int $weeks): void
    {
        $nurse = User::factory()->create();
        $departments = Department::query()
            ->whereIn('slug', ['gi_neuro_inpatient', 'outpatient_main'])
            ->get();

        $assignments = $departments->map(fn (Department $department) => ReportAssignment::query()->create([
            'nurse_id' => $nurse->id,
            'department_id' => $department->id,
            'template_id' => $department->template_id,
            'active' => true,
            'approved_at' => now(),
            'approved_by' => $nurse->id,
        ]));

        $fieldsByTemplate = ReportFieldDefinition::query()
            ->whereIn('field_kind', ['integer', 'decimal'])
            ->get()
            ->groupBy('template_id');

        for ($week = 0; $week < $weeks; $week++) {
            $weekStart = Carbon::parse('2026-01-05')->addWeeks($week);
            $period = ReportingPeriod::query()->create([
                'week_start' => $weekStart->toDateString(),
                'week_end' => $weekStart->copy()->addDays(6)->toDateString(),
                'deadline_at' => $weekStart->copy()->addDays(7)->setTime(10, 0),
                'month_label' => $weekStart->format('M Y'),
                'quarter_label' => 'Q'.$weekStart->quarter.' '.$weekStart->year,
                'year_num' => $weekStart->year,
            ]);

            foreach ($assignments as $assignment) {
                $report = Report::query()->create([
                    'assignment_id' => $assignment->id,
                    'reporting_period_id' => $period->id,
                    'department_id' => $assignment->department_id,
                    'template_id' => $assignment->template_id,
                    'status' => 'submitted',
                    'submitted_at' => $weekStart->copy()->addDays(6),
                    'created_by' => $nurse->id,
                    'updated_by' => $nurse->id,
                ]);

                foreach (($fieldsByTemplate[$assignment->template_id] ?? collect())->take(6) as $field) {
                    foreach (['monday', 'tuesday'] as $day) {
                        ReportFieldValue::query()->create([
                            'report_id' => $report->id,
                            'field_definition_id' => $field->id,
                            'day_name' => $day,
                            'value_number' => 5,
                        ]);
                    }
                }
            }
        }
    }
}
