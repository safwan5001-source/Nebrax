<?php

namespace App\Models;

use App\Tenancy\CompanyWide;
use App\Tenancy\TenantContext;
use App\Tenancy\TenantScope;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use RuntimeException;

/**
 * FLOWERS-H3 / ADR-15 — سياسة الإهداء لقناة بيع واحدة. غياب الصفّ = معطَّل.
 * `CompanyWide` كـ`FulfillmentPolicy`: تهيئة قناة لا فرع. `saving` يتحقق بنيوياً
 * أن القناة تخص المستأجر نفسه ويفرض حدود الطول.
 */
class CommerceGiftSetting extends BaseModel implements CompanyWide
{
    public const DEFAULT_MAX_LENGTH = 250;

    public const MAX_LENGTH_CEILING = 500;

    protected $fillable = ['tenant_id', 'sales_channel_id', 'is_enabled', 'message_max_length', 'allow_hide_sender', 'recipient_phone_required'];

    protected $casts = [
        'is_enabled' => 'boolean',
        'message_max_length' => 'integer',
        'allow_hide_sender' => 'boolean',
        'recipient_phone_required' => 'boolean',
    ];

    protected $attributes = [
        'is_enabled' => false,
        'message_max_length' => self::DEFAULT_MAX_LENGTH,
        'allow_hide_sender' => true,
        'recipient_phone_required' => true,
    ];

    protected static function booted(): void
    {
        static::saving(function (self $setting) {
            if ($setting->message_max_length < 1 || $setting->message_max_length > self::MAX_LENGTH_CEILING) {
                throw new RuntimeException('الحد الأقصى لطول الرسالة خارج النطاق المسموح.');
            }

            $tenantId = $setting->tenant_id ?? app(TenantContext::class)->id();
            if ($tenantId === null) {
                return;
            }

            $channel = SalesChannel::withoutGlobalScope(TenantScope::class)->select(['id', 'tenant_id'])->find($setting->sales_channel_id);
            if ($channel === null || $channel->tenant_id !== $tenantId) {
                throw new RuntimeException('قناة البيع غير موجودة لهذا المستأجر.');
            }
        });
    }

    public function salesChannel(): BelongsTo
    {
        return $this->belongsTo(SalesChannel::class);
    }
}
