<?php

namespace App\Models;

use App\Support\DeliveryPlatformCatalog;
use App\Tenancy\CompanyWide;
use App\Tenancy\TenantContext;
use DomainException;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * ملف تعريف منصة توصيل للمستأجر — طبقة إعداد فوق `SalesChannel(type=external)`.
 *
 * **هوية فقط**: المنصة + القناة. ليس طريقة دفع، وليس عميل الفاتورة، وليس طرف
 * تسوية (DG-1 لاحق). لا يُشغّل أي ترحيل ولا توجيه دفع. كل إعداد دلالي في
 * `DeliveryPlatformProfileVersion` الإلحاقي؛ `is_active` هنا مرآة لآخر نسخة
 * تكتبها الخدمة في المعاملة نفسها.
 *
 * **`CompanyWide`**: كـ`SalesChannel` — القناة تخص المؤسسة لا فرعاً بعينه.
 * التجاوز الفرعي يعيش داخل النسخة (`DeliveryPlatformVersionOverride`).
 *
 * الهوية ثابتة: `platform_key` و`sales_channel_id` لا يتغيّران بعد الإنشاء،
 * و`SalesChannel` المرتبط يجب أن يكون `external` نشطاً من المستأجر نفسه بسلاج
 * `delivery-<منصة>` — لا قناة web/mobile/pos ولا سلاج محجوز.
 */
class DeliveryPlatformProfile extends BaseModel implements CompanyWide
{
    protected $fillable = ['tenant_id', 'sales_channel_id', 'platform_key', 'is_active'];

    protected $casts = ['is_active' => 'boolean'];

    protected $attributes = ['is_active' => true];

    protected static function booted(): void
    {
        static::saving(function (self $profile): void {
            $context = app(TenantContext::class);
            if (! $context->has()) {
                throw new DomainException('Tenant context is required for delivery platform configuration.');
            }
            $tenantId = (string) $context->id();

            if ($profile->tenant_id !== null && (string) $profile->tenant_id !== $tenantId) {
                throw new DomainException('Delivery platform profile tenant cannot be forged.');
            }
            $profile->tenant_id = $tenantId;

            if ($profile->exists && ($profile->isDirty('platform_key') || $profile->isDirty('sales_channel_id'))) {
                throw new DomainException('Delivery platform identity (platform and channel) is immutable.');
            }

            if (! DeliveryPlatformCatalog::exists((string) $profile->platform_key)) {
                throw new DomainException('Unknown delivery platform.');
            }

            if (! $profile->exists) {
                // يمرّ عبر TenantScope: معرّف مستأجر آخر لا يُحلّ ويُعامَل كغير موجود.
                $channel = SalesChannel::query()->whereKey($profile->sales_channel_id)->first();
                if ($channel === null) {
                    throw new DomainException('Sales channel must belong to the active tenant.');
                }
                if ($channel->type !== SalesChannel::TYPE_EXTERNAL) {
                    throw new DomainException('Delivery platform channel must be of type external.');
                }
                if (! $channel->is_active) {
                    throw new DomainException('Delivery platform channel must be active.');
                }
                if ($channel->slug !== DeliveryPlatformCatalog::channelSlug((string) $profile->platform_key)) {
                    throw new DomainException('Delivery platform channel slug must follow the delivery-<platform> convention.');
                }
            }
        });

        static::deleting(static fn () => throw new DomainException('Delivery platform profiles are never deleted; deactivate instead.'));
    }

    public function salesChannel(): BelongsTo
    {
        return $this->belongsTo(SalesChannel::class);
    }

    public function versions(): HasMany
    {
        return $this->hasMany(DeliveryPlatformProfileVersion::class)->orderBy('version_number');
    }
}
