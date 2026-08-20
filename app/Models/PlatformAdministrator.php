<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\SoftDeletes;
use Illuminate\Foundation\Auth\User as Authenticatable;
use Laravel\Sanctum\HasApiTokens;

/**
 * حساب تشغيلي داخلي للمنصة.
 *
 * لا يحمل `tenant_id` عمداً؛ إذ إن ربطه بمستأجر يخلط صلاحيات تشغيل المنصة
 * بعزل بيانات عملائها. لا يُقبل هذا النموذج في مسارات ERP العادية.
 */
class PlatformAdministrator extends Authenticatable
{
    use HasUuids, HasApiTokens, SoftDeletes;

    public $incrementing = false;

    protected $keyType = 'string';

    protected $fillable = [
        'name',
        'email',
        'password',
        'is_active',
        'last_login_at',
    ];

    protected $hidden = ['password', 'remember_token'];

    protected function casts(): array
    {
        return [
            'password'      => 'hashed',
            'is_active'     => 'boolean',
            'last_login_at' => 'datetime',
        ];
    }
}
