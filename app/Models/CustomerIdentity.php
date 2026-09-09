<?php

namespace App\Models;

use App\Tenancy\BelongsToTenant;
use App\Tenancy\CompanyWide;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Relations\HasOne;
use Illuminate\Database\Eloquent\SoftDeletes;
use Illuminate\Foundation\Auth\User as Authenticatable;
use Illuminate\Support\Str;
use Laravel\Sanctum\HasApiTokens;

class CustomerIdentity extends Authenticatable implements CompanyWide
{
    use BelongsToTenant, HasApiTokens, HasUuids, SoftDeletes;

    public $incrementing = false;

    protected $keyType = 'string';

    protected $fillable = [
        'tenant_id',
        'display_name',
        'email',
        'phone',
        'password',
        'email_verified_at',
        'is_active',
        'last_login_at',
    ];

    protected $hidden = [
        'password',
        'remember_token',
        'email_normalized',
        'phone_e164',
    ];

    protected $attributes = [
        'is_active' => true,
    ];

    protected function casts(): array
    {
        return [
            'password' => 'hashed',
            'email_verified_at' => 'datetime',
            'is_active' => 'boolean',
            'last_login_at' => 'datetime',
        ];
    }

    protected static function booted(): void
    {
        static::saving(function (self $identity): void {
            $identity->email = trim($identity->email);
            $identity->email_normalized = self::normalizeEmail($identity->email);
            $identity->phone = self::cleanPhone($identity->phone);
            $identity->phone_e164 = self::normalizePhone($identity->phone);
        });
    }

    public static function normalizeEmail(string $email): string
    {
        return Str::lower(trim($email));
    }

    public static function normalizePhone(?string $phone): ?string
    {
        if ($phone === null || trim($phone) === '') {
            return null;
        }

        return preg_replace('/[\s\-().]/', '', trim($phone));
    }

    private static function cleanPhone(?string $phone): ?string
    {
        $phone = $phone === null ? null : trim($phone);

        return $phone === '' ? null : $phone;
    }

    public function tenant(): BelongsTo
    {
        return $this->belongsTo(Tenant::class);
    }

    public function partnerLinks(): HasMany
    {
        return $this->hasMany(CustomerPartnerLink::class);
    }

    public function activePartnerLink(): HasOne
    {
        return $this->hasOne(CustomerPartnerLink::class)->where('status', 'active');
    }
}
