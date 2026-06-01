<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Foundation\Auth\User as Authenticatable;
use Laravel\Sanctum\HasApiTokens;

class User extends Authenticatable
{
    use HasApiTokens, HasFactory, HasUuids;

    protected $fillable = [
        'email',
        'username',
        'password',
        'full_name',
        'title',
        'role_key',
        'phone',
        'active',
        'home_ward_id',
        'last_login_at',
        'password_change_required',
    ];

    protected $hidden = [
        'password',
        'remember_token',
    ];

    protected function casts(): array
    {
        return [
            'email_verified_at' => 'datetime',
            'last_login_at' => 'datetime',
            'password' => 'hashed',
            'active' => 'boolean',
            'password_change_required' => 'boolean',
        ];
    }

    public function setUsernameAttribute(?string $value): void
    {
        $this->attributes['username'] = $value === null ? null : strtolower(trim($value));
    }

    public function role(): BelongsTo
    {
        return $this->belongsTo(Role::class, 'role_key', 'role_key');
    }

    public function assignments(): HasMany
    {
        return $this->hasMany(ReportAssignment::class, 'nurse_id');
    }

    public function accessRequests(): HasMany
    {
        return $this->hasMany(AccessRequest::class);
    }

    public function notifications(): HasMany
    {
        return $this->hasMany(Notification::class, 'recipient_id');
    }

    public function homeWard(): BelongsTo
    {
        return $this->belongsTo(Department::class, 'home_ward_id');
    }

    public function isAdminLike(): bool
    {
        return in_array($this->role_key, ['superadmin', 'admin'], true);
    }

    public function isSuperadmin(): bool
    {
        return $this->role_key === 'superadmin';
    }
}
