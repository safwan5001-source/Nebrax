<?php

namespace App\Models;

use App\Tenancy\CompanyWide;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use LogicException;

class TenantCommercialAssignment extends Model implements CompanyWide
{
    use HasUuids;

    public const SOURCE_PLAN = 'plan';
    public const SOURCE_ADDON = 'addon';

    public const STATUS_ACTIVE = 'active';
    public const STATUS_CANCELLED = 'cancelled';
    public const STATUS_REVOKED = 'revoked';

    protected $fillable = [
        'tenant_id', 'source_type', 'commercial_plan_version_id', 'commercial_product_version_id',
        'status', 'starts_at', 'ends_at', 'cancelled_at', 'revoked_at',
        'assigned_by_platform_administrator_id', 'cancelled_by_platform_administrator_id',
        'revoked_by_platform_administrator_id', 'reason', 'metadata', 'idempotency_key',
    ];

    protected function casts(): array
    {
        return [
            'starts_at' => 'immutable_datetime',
            'ends_at' => 'immutable_datetime',
            'cancelled_at' => 'immutable_datetime',
            'revoked_at' => 'immutable_datetime',
            'metadata' => 'array',
        ];
    }

    protected static function booted(): void
    {
        static::updating(function (self $assignment): void {
            $allowed = [
                'status', 'ends_at', 'cancelled_at', 'revoked_at',
                'cancelled_by_platform_administrator_id', 'revoked_by_platform_administrator_id',
            ];
            if (array_diff(array_keys($assignment->getDirty()), $allowed) !== []) {
                throw new LogicException('Commercial assignments are append-mostly; only lifecycle fields may change.');
            }
        });
        static::deleting(fn () => throw new LogicException('Commercial assignments cannot be deleted.'));
    }

    public function tenant(): BelongsTo { return $this->belongsTo(Tenant::class); }
    public function planVersion(): BelongsTo { return $this->belongsTo(CommercialPlanVersion::class, 'commercial_plan_version_id'); }
    public function productVersion(): BelongsTo { return $this->belongsTo(CommercialProductVersion::class, 'commercial_product_version_id'); }
    public function assignedBy(): BelongsTo { return $this->belongsTo(PlatformAdministrator::class, 'assigned_by_platform_administrator_id'); }
    public function events(): HasMany { return $this->hasMany(TenantCommercialAssignmentEvent::class); }
}
