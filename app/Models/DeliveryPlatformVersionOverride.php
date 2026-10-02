<?php

namespace App\Models;

use App\Tenancy\BelongsToBranch;
use App\Tenancy\TenantContext;
use DomainException;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use LogicException;

/**
 * تجاوز فرع **داخل** نسخة تكوين — ثابت، تابع لنسخة بعينها، لا يُعدَّل ولا يُحذف.
 *
 * `BelongsToBranch`: صف موسوم بفرع بتصفية صريحة (لا Global Scope). الفرع دائماً
 * يُمرَّر صراحةً من الخدمة؛ لا يُشتق من الفرع النشط. `NULL` في عمود = يرث من النسخة.
 */
class DeliveryPlatformVersionOverride extends BaseModel
{
    use BelongsToBranch;

    public $timestamps = false;

    protected $fillable = [
        'tenant_id', 'delivery_platform_profile_version_id', 'branch_id',
        'collection_mode', 'external_reference_policy', 'created_at',
    ];

    protected $casts = ['created_at' => 'datetime'];

    protected static function booted(): void
    {
        static::creating(function (self $override): void {
            $context = app(TenantContext::class);
            if (! $context->has()) {
                throw new DomainException('Tenant context is required for delivery platform configuration.');
            }
            if ($override->tenant_id !== null && (string) $override->tenant_id !== (string) $context->id()) {
                throw new DomainException('Delivery platform override tenant cannot be forged.');
            }
            $override->tenant_id = (string) $context->id();

            if (empty($override->branch_id)) {
                throw new DomainException('A branch override must name its branch explicitly.');
            }
            // TenantScope: فرع مستأجر آخر لا يُحلّ.
            if (! Branch::query()->whereKey($override->branch_id)->exists()) {
                throw new DomainException('Override branch must belong to the active tenant.');
            }
            if (! DeliveryPlatformProfileVersion::query()->whereKey($override->delivery_platform_profile_version_id)->exists()) {
                throw new DomainException('Override version must belong to the active tenant.');
            }
            if ($override->collection_mode !== null
                && ! in_array($override->collection_mode, DeliveryPlatformProfileVersion::COLLECTION_MODES, true)) {
                throw new DomainException('Invalid collection mode.');
            }
            if ($override->external_reference_policy !== null
                && ! in_array($override->external_reference_policy, DeliveryPlatformProfileVersion::REFERENCE_POLICIES, true)) {
                throw new DomainException('Invalid external reference policy.');
            }
        });

        static::updating(static fn () => throw new LogicException('تجاوز فرع داخل نسخة لا يُعدَّل؛ أنشئ نسخة جديدة.'));
        static::deleting(static fn () => throw new LogicException('تجاوز فرع داخل نسخة لا يُحذف.'));
    }

    public function version(): BelongsTo
    {
        return $this->belongsTo(DeliveryPlatformProfileVersion::class, 'delivery_platform_profile_version_id');
    }
}
