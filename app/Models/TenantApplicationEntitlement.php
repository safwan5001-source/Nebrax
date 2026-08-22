<?php

namespace App\Models;

use App\Tenancy\CompanyWide;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use LogicException;

class TenantApplicationEntitlement extends BaseModel implements CompanyWide
{
    public const UPDATED_AT = null;

    protected $fillable = [
        'tenant_id', 'capability_key', 'access_mode', 'source_type',
        'source_reference_type', 'source_reference_id', 'grant_group_id',
        'starts_at', 'ends_at', 'grant_reason_code', 'reason',
        'granted_by_platform_administrator_id', 'metadata', 'idempotency_key',
    ];

    protected function casts(): array
    {
        return [
            'starts_at' => 'immutable_datetime', 'ends_at' => 'immutable_datetime',
            'revoked_at' => 'immutable_datetime', 'metadata' => 'array',
        ];
    }

    protected static function booted(): void
    {
        static::updating(function (self $grant): void {
            $allowed = ['revoked_at', 'revoked_by_platform_administrator_id'];
            if (array_diff(array_keys($grant->getDirty()), $allowed) !== []) {
                throw new LogicException('Entitlement grants are append-mostly; only revocation fields may change.');
            }
        });
        static::deleting(fn () => throw new LogicException('Entitlement grants cannot be deleted.'));
    }

    public function tenant(): BelongsTo { return $this->belongsTo(Tenant::class); }
    public function grantedBy(): BelongsTo { return $this->belongsTo(PlatformAdministrator::class, 'granted_by_platform_administrator_id'); }
    public function revokedBy(): BelongsTo { return $this->belongsTo(PlatformAdministrator::class, 'revoked_by_platform_administrator_id'); }
}
