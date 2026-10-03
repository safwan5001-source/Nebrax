<?php

namespace App\Models;

use App\Tenancy\CompanyWide;
use App\Tenancy\TenantContext;
use App\Tenancy\TenantScope;
use DateTimeZone;
use RuntimeException;

/**
 * FLOWERS-H7a / ADR-19 — سياسة جدولة التسليم لقناة بيع واحدة. غياب الصفّ أو `is_enabled=false` = لا
 * جدولة (سلوك Checkout الحالي). `CompanyWide` كـ`CommerceGiftSetting`/`FulfillmentPolicy`: تهيئة قناة
 * لا فرع. `saving` يفرض النطاقات والمنطقة الزمنية وانتماء القناة للمستأجر بنيوياً.
 */
class CommerceDeliveryScheduleSetting extends BaseModel implements CompanyWide
{
    public const MAX_LEAD_TIME_MINUTES = 43200;

    public const MAX_DAYS_AHEAD = 90;

    public const DEFAULT_DAYS_AHEAD = 30;

    public const TIME_PATTERN = '/^([01]\d|2[0-3]):[0-5]\d$/';

    protected $fillable = [
        'tenant_id', 'sales_channel_id', 'is_enabled', 'is_required', 'timezone',
        'lead_time_minutes', 'cutoff_time', 'max_days_ahead',
    ];

    protected $casts = [
        'is_enabled' => 'boolean',
        'is_required' => 'boolean',
        'lead_time_minutes' => 'integer',
        'max_days_ahead' => 'integer',
    ];

    protected $attributes = [
        'is_enabled' => false,
        'is_required' => true,
        'lead_time_minutes' => 0,
        'max_days_ahead' => self::DEFAULT_DAYS_AHEAD,
    ];

    protected static function booted(): void
    {
        static::saving(function (self $setting) {
            if ($setting->lead_time_minutes < 0 || $setting->lead_time_minutes > self::MAX_LEAD_TIME_MINUTES) {
                throw new RuntimeException('مدة التجهيز المسبقة خارج النطاق المسموح.');
            }
            if ($setting->max_days_ahead < 1 || $setting->max_days_ahead > self::MAX_DAYS_AHEAD) {
                throw new RuntimeException('أقصى مدة للحجز المسبق خارج النطاق المسموح.');
            }
            if ($setting->cutoff_time !== null && ! preg_match(self::TIME_PATTERN, (string) $setting->cutoff_time)) {
                throw new RuntimeException('وقت الإغلاق اليومي غير صالح.');
            }
            if ($setting->timezone !== null && ! in_array($setting->timezone, DateTimeZone::listIdentifiers(), true)) {
                throw new RuntimeException('المنطقة الزمنية غير صالحة.');
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
}
