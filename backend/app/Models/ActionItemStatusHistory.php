<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class ActionItemStatusHistory extends Model
{
    use HasUuids;

    public $timestamps = false;

    protected $table = 'action_item_status_history';

    protected $fillable = [
        'action_item_id', 'event', 'from_status', 'to_status', 'note',
        'changed_by', 'created_at',
    ];

    protected function casts(): array
    {
        return ['created_at' => 'datetime'];
    }

    public function actor(): BelongsTo
    {
        return $this->belongsTo(User::class, 'changed_by');
    }
}
