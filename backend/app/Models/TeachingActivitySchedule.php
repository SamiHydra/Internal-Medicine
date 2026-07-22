<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;

class TeachingActivitySchedule extends Model
{
    use HasUuids;

    public const ACTIVITY_TYPES = ['lecture', 'seminar', 'bedside', 'teaching_round'];

    protected $fillable = [
        'cohort',
        'activity_type',
        'weekday',
        'scope',
        'active',
    ];

    protected function casts(): array
    {
        return [
            'weekday' => 'integer',
            'active' => 'boolean',
        ];
    }
}
