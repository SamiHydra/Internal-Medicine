<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

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
