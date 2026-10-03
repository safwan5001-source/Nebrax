<?php

namespace App\Support;

/**
 * كتالوج منصات التوصيل المعتمدة — مفاتيح هوية ثابتة، لا سلوك.
 *
 * DLV-FOUNDATION-1: هذا الكتالوج يحدّد **هوية** المنصة فقط. لا يحمل نسبة عمولة
 * ولا معاملة ضريبية ولا حساباً دفترياً ولا طرفاً مقابلاً للتسوية (قرار DG-1
 * لاحق). المنصة ليست طريقة دفع (`PaymentMethod`) ولا عميل الفاتورة.
 *
 * `slug` القناة المشتقّ = `delivery-<مفتاح بشرطات>` — بادئة تمنع التصادم مع
 * السلاج المحجوز `web` وأي قناة Commerce موجودة.
 */
final class DeliveryPlatformCatalog
{
    public const SLUG_PREFIX = 'delivery-';

    /** @var array<string, array{name:string,name_en:string}> */
    private const PLATFORMS = [
        'hungerstation' => ['name' => 'هنقرستيشن', 'name_en' => 'HungerStation'],
        'keeta' => ['name' => 'كيتا', 'name_en' => 'Keeta'],
        'jahez' => ['name' => 'جاهز', 'name_en' => 'Jahez'],
        'mrsool' => ['name' => 'مرسول', 'name_en' => 'Mrsool'],
        'ninja' => ['name' => 'نينجا', 'name_en' => 'Ninja'],
        'the_chefz' => ['name' => 'ذا شيفز', 'name_en' => 'The Chefz'],
    ];

    /** @return list<string> */
    public static function keys(): array
    {
        return array_keys(self::PLATFORMS);
    }

    public static function exists(string $key): bool
    {
        return isset(self::PLATFORMS[$key]);
    }

    /** @return array{name:string,name_en:string}|null */
    public static function get(string $key): ?array
    {
        return self::PLATFORMS[$key] ?? null;
    }

    /** @return array<string, array{name:string,name_en:string}> */
    public static function all(): array
    {
        return self::PLATFORMS;
    }

    /** سلاج القناة الحتمي للمنصة (`the_chefz` ⇒ `delivery-the-chefz`). */
    public static function channelSlug(string $key): string
    {
        return self::SLUG_PREFIX . str_replace('_', '-', $key);
    }
}
