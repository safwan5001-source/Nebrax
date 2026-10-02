<?php

namespace App\Models;

use App\Tenancy\CompanyWide;
use App\Tenancy\TenantContext;
use DomainException;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use LogicException;

/**
 * نسخة تكوين ملف منصة التوصيل — **إلحاقية ثابتة**: لا تحديث ولا حذف أبداً.
 *
 * معرّف النسخة هو المرجع الذي ستثبّته المستندات اللاحقة؛ تعديل أي إعداد
 * (أو تجاوز فرع) ينتج نسخة جديدة ولا يلمس هذه. `collection_mode` بيانات فقط.
 *
 * `CompanyWide`: بنية إعداد للمؤسسة؛ تجاوزات الفروع صفوف تابعة لهذه النسخة.
 */
class DeliveryPlatformProfileVersion extends BaseModel implements CompanyWide
{
    public const COLLECTION_PLATFORM = 'platform_collected';

    public const COLLECTION_MERCHANT = 'merchant_collected';

    public const COLLECTION_MODES = [self::COLLECTION_PLATFORM, self::COLLECTION_MERCHANT];

    public const REFERENCE_REQUIRED = 'required';

    public const REFERENCE_OPTIONAL = 'optional';

    public const REFERENCE_NONE = 'none';

    public const REFERENCE_POLICIES = [self::REFERENCE_REQUIRED, self::REFERENCE_OPTIONAL, self::REFERENCE_NONE];

    public $timestamps = false;

    protected $fillable = [
        'tenant_id', 'delivery_platform_profile_id', 'version_number',
        'collection_mode', 'external_reference_policy',
        'display_name', 'display_name_en', 'logo_asset_key', 'is_active',
        'change_reason', 'created_by', 'effective_from', 'created_at',
    ];

    protected $casts = [
        'version_number' => 'integer',
        'is_active' => 'boolean',
        'effective_from' => 'datetime',
        'created_at' => 'datetime',
    ];

    protected static function booted(): void
    {
        static::creating(function (self $version): void {
            $context = app(TenantContext::class);
            if (! $context->has()) {
                throw new DomainException('Tenant context is required for delivery platform configuration.');
            }
            if ($version->tenant_id !== null && (string) $version->tenant_id !== (string) $context->id()) {
                throw new DomainException('Delivery platform version tenant cannot be forged.');
            }
            $version->tenant_id = (string) $context->id();

            if (! in_array($version->collection_mode, self::COLLECTION_MODES, true)) {
                throw new DomainException('Invalid collection mode.');
            }
            if (! in_array($version->external_reference_policy, self::REFERENCE_POLICIES, true)) {
                throw new DomainException('Invalid external reference policy.');
            }
            if (! DeliveryPlatformProfile::query()->whereKey($version->delivery_platform_profile_id)->exists()) {
                throw new DomainException('Delivery platform profile must belong to the active tenant.');
            }
        });

        static::updating(static fn () => throw new LogicException('نسخة تكوين منصة التوصيل لا تُعدَّل؛ أنشئ نسخة جديدة.'));
        static::deleting(static fn () => throw new LogicException('نسخة تكوين منصة التوصيل لا تُحذف.'));
    }

    public function profile(): BelongsTo
    {
        return $this->belongsTo(DeliveryPlatformProfile::class, 'delivery_platform_profile_id');
    }

    public function overrides(): HasMany
    {
        return $this->hasMany(DeliveryPlatformVersionOverride::class, 'delivery_platform_profile_version_id');
    }
}
