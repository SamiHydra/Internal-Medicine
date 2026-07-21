<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Role extends Model
{
    protected $primaryKey = 'role_key';

    public $incrementing = false;

    protected $keyType = 'string';

    protected $fillable = ['role_key', 'label', 'workspace', 'description'];

    public function users(): HasMany
    {
        return $this->hasMany(User::class, 'role_key', 'role_key');
    }
}
