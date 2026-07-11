<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class SubgroupPlacement extends Model
{
    use HasUuids;

    protected $fillable = [
        'batch_id',
        'subgroup',
        'ward_id',
        'week_starts_on',
        'week_ends_on',
        'created_by',
    ];

    protected function casts(): array
    {
        return [
            'week_starts_on' => 'date',
            'week_ends_on' => 'date',
        ];
    }

    public function batch(): BelongsTo
    {
        return $this->belongsTo(StudentBatch::class, 'batch_id');
    }

    public function ward(): BelongsTo
    {
        return $this->belongsTo(Ward::class);
    }
}
