<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class MorningSession extends Model
{
    use HasUuids;

    public const STATUSES = ['pending', 'recorded', 'cancelled'];

    protected $fillable = [
        'session_date',
        'scheduled_start_at',
        'actual_start_at',
        'started_on_time',
        'status',
        'reason',
        'recorded_by',
        'recorded_at',
    ];

    protected function casts(): array
    {
        return [
            'session_date' => 'date',
            'started_on_time' => 'boolean',
            'recorded_at' => 'datetime',
        ];
    }

    public function attendance(): HasMany
    {
        return $this->hasMany(MorningAttendance::class);
    }

    public function recordedBy(): BelongsTo
    {
        return $this->belongsTo(User::class, 'recorded_by');
    }

    /**
     * Minutes late against the SNAPSHOTTED scheduled start, computed on read
     * and never trusted from the client. Null while unrecorded.
     */
    public function delayMinutes(): ?int
    {
        if ($this->status !== 'recorded') {
            return null;
        }

        if ($this->started_on_time || $this->actual_start_at === null) {
            return 0;
        }

        [$scheduledHour, $scheduledMinute] = array_map('intval', explode(':', substr((string) $this->scheduled_start_at, 0, 5)));
        [$actualHour, $actualMinute] = array_map('intval', explode(':', substr((string) $this->actual_start_at, 0, 5)));

        return max(0, ($actualHour * 60 + $actualMinute) - ($scheduledHour * 60 + $scheduledMinute));
    }
}
