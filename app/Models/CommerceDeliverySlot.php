<?php

namespace App\Models;

use App\Tenancy\CompanyWide;
use App\Tenancy\TenantContext;
use App\Tenancy\TenantScope;
use RuntimeException;

/**
 * FLOWERS-H7a / ADR-19 — نافذة تسليم/استلام مسمّاة لقناة بيع (تسمية حرّة بلا مصطلحات تسويقية مثبّتة).
 * `weekday_mask`: بتّ لكل يوم (الأحد = البت 0). `capacity` null = غير محدودة (يُنفَّذ من H7b).
 * `shipping_zone_id` للتوصيل فقط (null = أي وجهة). `saving` يتحقق بنيوياً من الصيغ والنطاقات والانتماء.
 */
class CommerceDeliverySlot extends BaseModel implements CompanyWide
{
    public const METHOD_DELIVERY = 'delivery';

    public const METHOD_PICKUP = 'pickup';

    public const METHODS = [self::METHOD_DELIVERY, self::METHOD_PICKUP];

    public const MAX_PER_CHANNEL = 48;

    public const ALL_WEEKDAYS = 127;

    public const MAX_CAPACITY = 10000;

    protected $fillable = [
        'tenant_id', 'sales_channel_id', 'method', 'label', 'label_en', 'start_time', 'end_time',
        'weekday_mask', 'capacity', 'shipping_zone_id', 'sort_order', 'is_active',
    ];

    protected $casts = [
        'weekday_mask' => 'integer',
        'capacity' => 'integer',
        'sort_order' => 'integer',
        'is_active' => 'boolean',
    ];

    protected $attributes = [
        'weekday_mask' => self::ALL_WEEKDAYS,
        'sort_order' => 0,
        'is_active' => true,
    ];

    protected static function booted(): void
    {
        static::saving(function (self $slot) {
            if (! in_array($slot->method, self::METHODS, true)) {
                throw new RuntimeException('طريقة التسليم غير صالحة.');
            }
            if (trim((string) $slot->label) === '' || mb_strlen((string) $slot->label) > 80 || mb_strlen((string) $slot->label_en) > 80) {
                throw new RuntimeException('تسمية النافذة غير صالحة.');
            }
            foreach (['start_time', 'end_time'] as $field) {
                if (! preg_match(CommerceDeliveryScheduleSetting::TIME_PATTERN, (string) $slot->{$field})) {
                    throw new RuntimeException('وقت النافذة غير صالح.');
                }
            }
            if ($slot->end_time <= $slot->start_time) {
                throw new RuntimeException('وقت نهاية النافذة يجب أن يلي بدايتها في اليوم نفسه.');
            }
            if ($slot->weekday_mask < 1 || $slot->weekday_mask > self::ALL_WEEKDAYS) {
                throw new RuntimeException('أيام النافذة غير صالحة.');
            }
            if ($slot->capacity !== null && ($slot->capacity < 1 || $slot->capacity > self::MAX_CAPACITY)) {
                throw new RuntimeException('سعة النافذة خارج النطاق المسموح.');
            }
            if ($slot->shipping_zone_id !== null && $slot->method !== self::METHOD_DELIVERY) {
                throw new RuntimeException('تقييد المنطقة خاص بالتوصيل.');
            }

            $tenantId = $slot->tenant_id ?? app(TenantContext::class)->id();
            if ($tenantId === null) {
                return;
            }

            $channel = SalesChannel::withoutGlobalScope(TenantScope::class)->select(['id', 'tenant_id'])->find($slot->sales_channel_id);
            if ($channel === null || $channel->tenant_id !== $tenantId) {
                throw new RuntimeException('قناة البيع غير موجودة لهذا المستأجر.');
            }
            if ($slot->shipping_zone_id !== null) {
                $zone = CommerceShippingZone::withoutGlobalScope(TenantScope::class)->select(['id', 'tenant_id'])->find($slot->shipping_zone_id);
                if ($zone === null || $zone->tenant_id !== $tenantId) {
                    throw new RuntimeException('منطقة الشحن غير موجودة لهذا المستأجر.');
                }
            }
        });
    }

    /** @return list<int> أيام الأسبوع (0 = الأحد) */
    public function weekdays(): array
    {
        return array_values(array_filter(range(0, 6), fn (int $d) => ($this->weekday_mask & (1 << $d)) !== 0));
    }

    public function runsOn(int $weekday): bool
    {
        return ($this->weekday_mask & (1 << $weekday)) !== 0;
    }
}
