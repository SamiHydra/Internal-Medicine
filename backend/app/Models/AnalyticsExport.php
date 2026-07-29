<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class AnalyticsExport extends Model
{
    use HasUuids;

    public const STATUS_PENDING = 'pending';

    public const STATUS_PROCESSING = 'processing';

    public const STATUS_READY = 'ready';

    public const STATUS_FAILED = 'failed';

    protected $fillable = [
        'user_id',
        'status',
        'format',
        'file_path',
        'file_name',
        'row_count',
        'byte_size',
        'error',
        'completed_at',
        'expires_at',
    ];

    protected function casts(): array
    {
        return [
            'row_count' => 'integer',
            'byte_size' => 'integer',
            'completed_at' => 'datetime',
            'expires_at' => 'datetime',
        ];
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }
}
