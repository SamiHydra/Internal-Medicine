<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;

class RotationCalendar extends Model
{
    use HasUuids;

    public const BLOCK_KINDS = ['calendar_month', 'fixed_weeks'];

    protected $fillable = [
        'training_year',
        'academic_year_label',
        'starts_on',
        'block_kind',
        'block_length_weeks',
        'blocks_count',
        'active',
    ];

    protected function casts(): array
    {
        return [
            'training_year' => 'integer',
            'starts_on' => 'date',
            'block_length_weeks' => 'integer',
            'blocks_count' => 'integer',
            'active' => 'boolean',
        ];
    }

    public function blocks(): HasMany
    {
        return $this->hasMany(RotationBlock::class, 'calendar_id')->orderBy('block_index');
    }
}
