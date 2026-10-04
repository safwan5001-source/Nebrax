<?php

namespace App\Support\Commerce;

/**
 * FLOWERS-H1 — مفاتيح القدرات التي قد يوصي بها ملف نشاط (`BusinessVertical`).
 *
 * قائمةٌ محدودة تملكها المنصة، لا لغة قواعد تنفيذية. المفتاح هنا يصف **ما
 * يُوصى بتهيئته** لا ما هو مفعَّل: التفعيل الفعلي قرار كل قدرة في شريحتها
 * (إعداد المتجر). `isAvailable()` هو الحقيقة الصريحة لـ«هل بُنيت القدرة في
 * الكود؟» — تنقلب إلى `true` في الشريحة التي تدمجها فقط، فلا تدّعي الواجهة
 * قدرةً غير موجودة (CLAUDE.md: DESIGN_ONLY / GATED / DEFERRED).
 *
 * الحدّ المعماري: القدرة لا تنشئ سلطةً موازية للمنتج/المخزون/الطلب/الفاتورة؛
 * هي تهيئة وعرض فوق Commerce Core.
 */
enum VerticalCapability: string
{
    /** H2 — تصنيف المناسبات (Occasion) كبُعد تسويقي يضبطه التاجر. */
    case Occasions = 'occasions';

    /** H2 — تصنيف المُهدى إليه (Recipient merchandising) — ليس مستلم التوصيل. */
    case Recipients = 'recipients';

    /** H5 — محتوى منتج مهيكل: تركيبة/عناية/مسببات حساسية/تخزين. */
    case StructuredContent = 'structured_content';

    /** H3 — رسالة الإهداء وهوية المُرسِل المعروضة ومستلم التوصيل. */
    case GiftMessage = 'gift_message';

    /** H4 — مدخلات تخصيص يعرّفها التاجر لكل منتج (نص/صورة/اختيار). */
    case Personalization = 'personalization';

    /** H6 — إضافات مدعومة بمنتجات حقيقية بسعر ومخزون من أَوْج. */
    case AddOns = 'add_ons';

    /** H7 — تاريخ التوصيل وفترته وآخر موعد للطلب. */
    case DeliveryScheduling = 'delivery_scheduling';

    /** H8 — «يصل اليوم» مشتقّاً من التوفر الفعلي لا من تصنيف ثابت. */
    case SameDayDelivery = 'same_day_delivery';

    /** H9 — أقسام متجر مخصّصة للهدايا في منشئ المتجر القائم. */
    case VerticalSections = 'vertical_sections';

    /**
     * هل القدرة مبنيّة ومدموجة في الكود؟ تُحدَّث شريحةً بشريحة. كلّ قدرات أفق الهدايا الأول
     * مدموجة (H2–H9) — «مبنيّة» لا تعني «مُفعَّلة» لمتجر بعينه: الحالة الفعلية لكل متجر
     * تُقرأ من إعداده الحقيقي في `StorefrontVerticalSetupService`.
     */
    public function isAvailable(): bool
    {
        return match ($this) {
            self::Occasions,
            self::Recipients,
            self::StructuredContent,
            self::GiftMessage,
            self::Personalization,
            self::AddOns,
            self::DeliveryScheduling,
            self::SameDayDelivery,
            self::VerticalSections => true,
        };
    }

    /** @return list<string> */
    public static function values(): array
    {
        return array_map(static fn (self $c) => $c->value, self::cases());
    }
}
