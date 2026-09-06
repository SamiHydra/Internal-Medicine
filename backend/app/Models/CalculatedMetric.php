<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * UNUSED as of 2026-07: nothing in the application writes a calculated_metrics
 * row, and nothing reads one. The table, this model and its policy are all
 * scaffolding for a per-report metric rollup that was never wired up.
 *
 * Occupancy (BOR/BTR/ALOS) is computed live in AnalyticsService::occupancy()
 * from the field-value aggregates instead. Two consequences worth knowing
 * before building on this:
 *
 *  - Any report loaded `with('calculatedMetric')` always yields null. That is
 *    not a bug in the caller.
 *  - Reviving it means a backfill AND a write on every path that changes a
 *    field value, or the table becomes a second, silently-stale source of
 *    truth for numbers the dashboard already reports correctly.
 *
 * Left in place rather than dropped because removing a deployed table is not
 * reversible without a restore; the decision belongs to whoever owns the
 * schema.
 */
class CalculatedMetric extends Model
{
    use HasUuids;

    protected $fillable = [
        'report_id', 'bor_percent', 'btr', 'alos', 'metric_payload',
    ];

    protected function casts(): array
    {
        return [
            'bor_percent' => 'decimal:3',
            'btr' => 'decimal:3',
            'alos' => 'decimal:3',
            'metric_payload' => 'array',
        ];
    }

    public function report(): BelongsTo
    {
        return $this->belongsTo(Report::class);
    }
}
