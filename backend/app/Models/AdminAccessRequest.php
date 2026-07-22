<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * A pending self-service account request. The table name is historical: the
 * queue started out admin-only and now carries any self-service request
 * (admin, resident, consultant), distinguished by requested_role.
 */
class AdminAccessRequest extends Model
{
    use HasFactory, HasUuids;

    protected $fillable = [
        'full_name',
        'email',
        'username',
        'password',
        'requested_role',
        'status',
        'notes',
        'home_ward_id',
        'training_year',
        'rotation_group',
        'requested_at',
        'reviewed_at',
        'reviewed_by',
        'created_user_id',
    ];

    protected $hidden = [
        'password',
    ];

    protected function casts(): array
    {
        return [
            'password' => 'hashed',
            'requested_at' => 'datetime',
            'reviewed_at' => 'datetime',
            'training_year' => 'integer',
        ];
    }

    public function reviewer(): BelongsTo
    {
        return $this->belongsTo(User::class, 'reviewed_by');
    }

    public function createdUser(): BelongsTo
    {
        return $this->belongsTo(User::class, 'created_user_id');
    }

    public function homeWard(): BelongsTo
    {
        return $this->belongsTo(Department::class, 'home_ward_id');
    }
}
