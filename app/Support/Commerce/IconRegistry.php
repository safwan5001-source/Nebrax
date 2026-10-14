<?php

namespace App\Support\Commerce;

/**
 * CUST-HV V7d-1 — مفاتيح سجلّ الأيقونات المنتقى (V0 §11.4، D-22). توأم `ICON_KEYS` في `icon-registry.ts`
 * (web وstorefront): قائمة ثابتة مملوكة للكود، **ملحقة فقط** — حذف مفتاح أو إعادة تسميته كسرٌ للوثائق المخزَّنة.
 * مفتاح غير معروف يُسقط (لا أيقونة). اختبار يثبّت التطابق مع TS.
 */
final class IconRegistry
{
    public const KEYS = [
        'truck', 'shield-check', 'credit-card', 'gift', 'clock', 'phone', 'message-circle', 'mail',
        'map-pin', 'store', 'star', 'heart', 'tag', 'percent', 'package', 'refresh-ccw',
        'headphones', 'leaf', 'sparkles', 'badge-check', 'calendar', 'users', 'lock', 'globe',
        // AWJ-VD-H1 / VD-1a (D-10): أيقونات المناسبات والمُهدى إليهم والأنشطة للأبعاد الوصفية — إلحاقٌ فقط.
        'cake', 'graduation-cap', 'baby', 'flower', 'gem', 'party-popper', 'user', 'user-round',
        'briefcase', 'house', 'hand-heart', 'heart-handshake', 'moon', 'sun', 'coffee', 'crown',
        'trophy', 'smile', 'paw-print', 'shirt', 'watch', 'book-open', 'music', 'palette',
        'school', 'stethoscope', 'utensils', 'snowflake',
    ];
}
