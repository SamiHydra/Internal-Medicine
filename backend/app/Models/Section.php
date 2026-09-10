<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Section extends Model
{
    use HasUuids;

    protected $fillable = [
        'slug',
        'name',
        'head_user_id',
        'active',
    ];

    protected function casts(): array
    {
        return [
            'active' => 'boolean',
        ];
    }

    public function head(): BelongsTo
    {
        return $this->belongsTo(User::class, 'head_user_id');
    }

    public function consultants(): HasMany
    {
        return $this->hasMany(User::class, 'section_id');
    }

    public function dutyTypes(): HasMany
    {
        return $this->hasMany(DutyType::class);
    }

    /** Transfers filed out of this section (transfer_requests.from_section_id, restrict on delete). */
    public function outboundTransferRequests(): HasMany
    {
        return $this->hasMany(TransferRequest::class, 'from_section_id');
    }

    /** Transfers filed into this section (transfer_requests.to_section_id, restrict on delete). */
    public function inboundTransferRequests(): HasMany
    {
        return $this->hasMany(TransferRequest::class, 'to_section_id');
    }
}
