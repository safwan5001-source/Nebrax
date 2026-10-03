<?php

namespace App\Support\Commerce;

/**
 * FLOWERS-H1 — ملف نشاط المتجر (Business Vertical): نقطة بدء تهيئة وقدرات
 * موصى بها، لا قفلاً دائماً ولا محرك تجارة ثانياً.
 *
 * قائمة محدودة تملكها المنصة. مفتاحٌ مجهول لا يُقبل كتابةً، ويسقط قراءةً على
 * `general` (فلا يُكسر متجرٌ بقيمة قديمة/غريبة). أنشطة المستقبل (بقالة،
 * خضار وفواكه، أزياء، إلكترونيات) **لا تُضاف تخمينياً** — تُضاف حين تُبنى.
 *
 * الملف يوصي ولا يملك: Product / Inventory / Cart / Order / Invoice / Ledger
 * تبقى سلطات Commerce وERP كما هي، ولا يغيّر تغيير الملف أي بيانات للتاجر.
 */
enum BusinessVertical: string
{
    case General = 'general';
    case FlowersGifts = 'flowers_gifts';

    public static function default(): self
    {
        return self::General;
    }

    /** قراءةٌ متسامحة: غير المعروف → `general`. */
    public static function fromStored(?string $value): self
    {
        return ($value === null ? null : self::tryFrom($value)) ?? self::default();
    }

    /** @return list<string> */
    public static function values(): array
    {
        return array_map(static fn (self $v) => $v->value, self::cases());
    }

    /**
     * القدرات الموصى بها لهذا الملف، بترتيب ثابت.
     *
     * @return list<VerticalCapability>
     */
    public function recommendedCapabilities(): array
    {
        return match ($this) {
            self::General => [],
            self::FlowersGifts => [
                VerticalCapability::Occasions,
                VerticalCapability::Recipients,
                VerticalCapability::GiftMessage,
                VerticalCapability::Personalization,
                VerticalCapability::AddOns,
                VerticalCapability::DeliveryScheduling,
                VerticalCapability::SameDayDelivery,
                VerticalCapability::StructuredContent,
                VerticalCapability::VerticalSections,
            ],
        };
    }

    /**
     * تمثيل آمن للعرض: المفتاح + القدرات الموصى بها مع حالة بنائها.
     *
     * @return array{key: string, recommended_capabilities: list<array{key: string, available: bool}>}
     */
    public function profile(): array
    {
        return [
            'key' => $this->value,
            'recommended_capabilities' => array_map(
                static fn (VerticalCapability $c) => ['key' => $c->value, 'available' => $c->isAvailable()],
                $this->recommendedCapabilities(),
            ),
        ];
    }
}
