<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;

class ReportingPeriod extends Model
{
    use HasUuids;

    public $timestamps = false;

    protected $fillable = [
        'week_start', 'week_end', 'deadline_at',
        'month_label', 'quarter_label', 'year_num',
    ];

    protected function casts(): array
    {
        return [
            'week_start' => 'date',
            'week_end' => 'date',
            'deadline_at' => 'datetime',
            'year_num' => 'integer',
            'created_at' => 'datetime',
        ];
    }

    public function reports(): HasMany
    {
        return $this->hasMany(Report::class);
    }
}
