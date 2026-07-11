<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class TeachingSession extends Model
{
    use HasUuids;

    public const STATUSES = ['pending', 'held', 'not_held', 'cancelled'];

    protected $fillable = [
        'batch_id',
        'subgroup',
        'activity_type',
        'scheduled_date',
        'ward_id',
        'status',
        'reason',
        'recorded_by',
        'recorded_at',
    ];

    protected function casts(): array
    {
        return [
            'scheduled_date' => 'date',
            'recorded_at' => 'datetime',
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

    public function recordedBy(): BelongsTo
    {
        return $this->belongsTo(User::class, 'recorded_by');
    }

    public function attendance(): HasMany
    {
        return $this->hasMany(StudentAttendance::class);
    }
}
