<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class RotationBlock extends Model
{
    use HasUuids;

    protected $fillable = [
        'calendar_id',
        'block_index',
        'starts_on',
        'ends_on',
    ];

    protected function casts(): array
    {
        return [
            'block_index' => 'integer',
            'starts_on' => 'date',
            'ends_on' => 'date',
        ];
    }

    public function calendar(): BelongsTo
    {
        return $this->belongsTo(RotationCalendar::class, 'calendar_id');
    }
}
