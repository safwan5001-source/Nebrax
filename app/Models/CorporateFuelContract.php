<?php

namespace App\Models;

use App\Support\GeneratesDocumentNumbers;
use App\Tenancy\CompanyWide;
use App\Tenancy\ResolvesBranchReferences;
use Carbon\CarbonInterface;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * عقد وقود مؤسسي مستقل. لا يساوي Partner.credit_limit؛ العقد هو مصدر حق
 * التفويض والتسعير وحد الائتمان للمبيعات المؤسسية الجديدة.
 */
class CorporateFuelContract extends BaseModel implements CompanyWide
{
    use GeneratesDocumentNumbers;
    use ResolvesBranchReferences;

    public const STATUS_DRAFT = 'draft';
    public const STATUS_ACTIVE = 'active';
    public const STATUS_SUSPENDED = 'suspended';
    public const STATUS_EXPIRED = 'expired';
    public const STATUS_CANCELLED = 'cancelled';
    public const STATUSES = [
        self::STATUS_DRAFT,
        self::STATUS_ACTIVE,
        self::STATUS_SUSPENDED,
        self::STATUS_EXPIRED,
        self::STATUS_CANCELLED,
    ];

    public const RESTRICTION_ALL = 'all';
    public const RESTRICTION_SELECTED = 'selected';
    public const RESTRICTION_MODES = [self::RESTRICTION_ALL, self::RESTRICTION_SELECTED];

    public const BILLING_PER_SALE = 'per_sale';
    public const BILLING_CONSOLIDATED_MONTHLY = 'consolidated_monthly';

    protected $fillable = [
        'tenant_id', 'number', 'partner_id', 'status', 'effective_from', 'effective_until',
        'credit_limit_minor', 'payment_terms_days', 'station_restriction_mode', 'fuel_restriction_mode',
        'billing_mode', 'odometer_policy', 'driver_required', 'vehicle_required', 'fuel_card_required',
        'created_by', 'activated_by', 'activated_at', 'suspended_by', 'suspended_at', 'suspension_reason',
    ];

    protected $casts = [
        'effective_from' => 'datetime',
        'effective_until' => 'datetime',
        'credit_limit_minor' => 'integer',
        'payment_terms_days' => 'integer',
        'driver_required' => 'boolean',
        'vehicle_required' => 'boolean',
        'fuel_card_required' => 'boolean',
        'activated_at' => 'datetime',
        'suspended_at' => 'datetime',
    ];

    protected $attributes = [
        'status' => self::STATUS_DRAFT,
        'station_restriction_mode' => self::RESTRICTION_ALL,
        'fuel_restriction_mode' => self::RESTRICTION_ALL,
        'billing_mode' => self::BILLING_PER_SALE,
        'payment_terms_days' => 0,
    ];

    public function partner(): BelongsTo
    {
        return $this->referenceBelongsTo(Partner::class);
    }

    public function stations(): HasMany
    {
        return $this->hasMany(CorporateFuelContractStation::class);
    }

    public function fuelProducts(): HasMany
    {
        return $this->hasMany(CorporateFuelContractProduct::class);
    }

    public function prices(): HasMany
    {
        return $this->hasMany(CorporateFuelContractPrice::class);
    }

    public function creator(): BelongsTo
    {
        return $this->referenceBelongsTo(User::class, 'created_by');
    }

    public function activator(): BelongsTo
    {
        return $this->referenceBelongsTo(User::class, 'activated_by');
    }

    public function suspender(): BelongsTo
    {
        return $this->referenceBelongsTo(User::class, 'suspended_by');
    }

    public function isActiveAt(CarbonInterface $at): bool
    {
        return $this->status === self::STATUS_ACTIVE
            && $this->effective_from->lte($at)
            && ($this->effective_until === null || $this->effective_until->gt($at));
    }
}
