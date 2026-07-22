<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class MorningAttendance extends Model
{
    use HasUuids;

    protected $table = 'morning_attendance';

    protected $fillable = [
        'morning_session_id',
        'user_id',
        'present',
    ];

    protected function casts(): array
    {
        return [
            'present' => 'boolean',
        ];
    }

    public function session(): BelongsTo
    {
        return $this->belongsTo(MorningSession::class, 'morning_session_id');
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }
}
