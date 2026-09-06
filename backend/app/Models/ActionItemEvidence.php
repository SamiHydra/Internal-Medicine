<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class ActionItemEvidence extends Model
{
    use HasUuids;

    public $timestamps = false;

    protected $table = 'action_item_evidence';

    protected $fillable = [
        'action_item_id', 'uploaded_by', 'original_name', 'disk', 'file_path',
        'mime_type', 'size_bytes', 'created_at',
    ];

    protected function casts(): array
    {
        return ['size_bytes' => 'integer', 'created_at' => 'datetime'];
    }

    public function uploader(): BelongsTo
    {
        return $this->belongsTo(User::class, 'uploaded_by');
    }
}
