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

    public const SELLING_UNKNOWN = 'unknown';

    public const SELLING_MERCHANT = 'merchant_seller';

    public const SELLING_PLATFORM = 'platform_seller';

    public const SELLING_ROLES = [self::SELLING_UNKNOWN, self::SELLING_MERCHANT, self::SELLING_PLATFORM];

    public const INVOICE_UNKNOWN = 'unknown';

    public const INVOICE_MERCHANT_ISSUES = 'merchant_issues';

    public const INVOICE_PLATFORM_ON_BEHALF = 'platform_on_behalf';

    public const INVOICE_PLATFORM_AS_SUPPLIER = 'platform_as_supplier';

    public const INVOICE_RESPONSIBILITIES = [
        self::INVOICE_UNKNOWN,
        self::INVOICE_MERCHANT_ISSUES,
        self::INVOICE_PLATFORM_ON_BEHALF,
        self::INVOICE_PLATFORM_AS_SUPPLIER,
    ];

    public const COLLECTION_ROLE_UNKNOWN = 'unknown';

    public const COLLECTION_ROLE_PLATFORM_FOR_MERCHANT = 'platform_collects_for_merchant';

    public const COLLECTION_ROLE_MERCHANT = 'merchant_collects';

    public const COLLECTION_ROLE_PLATFORM_AS_SELLER = 'platform_collects_as_seller';

    public const COLLECTION_ROLES = [
        self::COLLECTION_ROLE_UNKNOWN,
        self::COLLECTION_ROLE_PLATFORM_FOR_MERCHANT,
        self::COLLECTION_ROLE_MERCHANT,
        self::COLLECTION_ROLE_PLATFORM_AS_SELLER,
    ];

    public const VAT_UNKNOWN = 'unknown';

    public const VAT_REGISTERED = 'registered';

    public const VAT_NOT_REGISTERED = 'not_registered';

    public const VAT_STATUSES = [self::VAT_UNKNOWN, self::VAT_REGISTERED, self::VAT_NOT_REGISTERED];

    public const FINANCIAL_FIELDS = [
        'selling_role',
        'invoice_responsibility',
        'collection_role',
        'merchant_vat_status_at_supply',
    ];

    public $timestamps = false;

    /** دقة ميكروثانية: يحفظ ترتيب نسختين متتاليتين داخل الثانية الواحدة. */
    protected $dateFormat = 'Y-m-d H:i:s.u';

    protected $fillable = [
        'tenant_id', 'delivery_platform_profile_id', 'version_number',
        'collection_mode', 'external_reference_policy',
        'display_name', 'display_name_en', 'logo_asset_key', 'is_active',
        'selling_role', 'invoice_responsibility', 'collection_role', 'merchant_vat_status_at_supply',
        'financial_evidence_ref', 'financial_verified_at',
        'change_reason', 'created_by', 'effective_from', 'created_at',
    ];

    protected $casts = [
        'version_number' => 'integer',
        'is_active' => 'boolean',
        'effective_from' => 'datetime',
        'created_at' => 'datetime',
        'financial_verified_at' => 'datetime',
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
            $version->selling_role ??= self::SELLING_UNKNOWN;
            $version->invoice_responsibility ??= self::INVOICE_UNKNOWN;
            $version->collection_role ??= self::COLLECTION_ROLE_UNKNOWN;
            $version->merchant_vat_status_at_supply ??= self::VAT_UNKNOWN;
            if (! in_array($version->selling_role, self::SELLING_ROLES, true)
                || ! in_array($version->invoice_responsibility, self::INVOICE_RESPONSIBILITIES, true)
                || ! in_array($version->collection_role, self::COLLECTION_ROLES, true)
                || ! in_array($version->merchant_vat_status_at_supply, self::VAT_STATUSES, true)) {
                throw new DomainException('Invalid delivery financial role.');
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
