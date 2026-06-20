<?php

namespace App\Models;

use App\Support\Rbac;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\SoftDeletes;
use Illuminate\Foundation\Auth\User as Authenticatable;
use Laravel\Sanctum\HasApiTokens;

class User extends Authenticatable
{
    use HasUuids, HasApiTokens, SoftDeletes;

    public $incrementing = false;
    protected $keyType = 'string';

    protected $fillable = [
        'tenant_id', 'name', 'email', 'password', 'role', 'permissions', 'is_active',
    ];

    protected $hidden = ['password', 'remember_token'];

    protected $casts = [
        'email_verified_at' => 'datetime',
        'password'          => 'hashed',
        'permissions'       => 'array',
        'is_active'         => 'boolean',
    ];

    public function tenant(): BelongsTo
    {
        return $this->belongsTo(Tenant::class);
    }

    /** هل يملك المستخدم الصلاحية المطلوبة حسب دوره؟ */
    public function hasPermission(string $permission): bool
    {
        return Rbac::allows($this->role, $permission);
    }
}
