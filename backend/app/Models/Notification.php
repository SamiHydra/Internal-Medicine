<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class Notification extends Model
{
    use HasUuids;

    public $timestamps = false;

    // `id` is fillable so restore() can re-create a cleared notification under
    // its ORIGINAL uuid (via updateOrCreate keyed on id). Without it HasUuids
    // mints a fresh uuid on the create path, making undo-clear non-idempotent
    // and defeating restore()'s own IDOR guard. The only client-supplied id
    // path is restore(), which validates the uuid and refuses to write onto
    // another recipient's row; every other write sets server-controlled values.
    protected $fillable = [
        'id', 'recipient_id', 'type', 'title', 'message', 'related_route',
        'related_entity', 'related_id', 'read_at', 'created_at',
    ];

    protected function casts(): array
    {
        return [
            'read_at' => 'datetime',
            'created_at' => 'datetime',
        ];
    }

    public function recipient(): BelongsTo
    {
        return $this->belongsTo(User::class, 'recipient_id');
    }
}
