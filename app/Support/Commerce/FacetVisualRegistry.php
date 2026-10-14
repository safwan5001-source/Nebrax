<?php

namespace App\Support\Commerce;

/**
 * AWJ-VD-H1 / VD-1a — القوائم المغلقة لعقد الهوية المرئية للأبعاد الوصفية وقيمها
 * (`docs/plans/store/visual-dimensions/AWJ-VD-H1-0-EVIDENCE-AND-ARCHITECTURE.md` §3.3–§3.6).
 *
 * قوائم مملوكة للكود و**ملحقة فقط**: حذف مفتاح أو إعادة تسميته كسرٌ للهويات المخزَّنة. توأمها
 * `FACET_VISUAL_*` في `facet-visual.ts` (web وstorefront)، واختبارٌ يثبّت التطابق. هندسة الأشكال
 * نفسها (CSS/SVG) ليست هنا — البيانات تحمل **مفتاح الشكل فقط**، والرسم ثوابت في العارض.
 */
final class FacetVisualRegistry
{
    /** نوع المحتوى المرئي. */
    public const CONTENTS = ['image', 'icon', 'none'];

    /** مفاتيح الأشكال (شكل إطار الوسيط، لا شكل البطاقة). */
    public const SHAPES = [
        'circle', 'square', 'rounded', 'landscape', 'portrait', 'oval',
        'star', 'heart', 'diamond', 'hexagon', 'vase', 'arch',
    ];

    public const SIZES = ['sm', 'md', 'lg'];

    public const FITS = ['cover', 'contain'];

    /** التكبير داخل الإطار (CSS، لا مشتقات — D-09). 1 = بلا تكبير فلا يُخزَّن. */
    public const ZOOM_MIN = 1.0;

    public const ZOOM_MAX = 3.0;

    /** افتراضات النظام — آخر حلقة في سلسلة الحل (§3.6). */
    public const DEFAULT_CONTENT = 'none';

    public const DEFAULT_SHAPE = 'circle';

    public const DEFAULT_SIZE = 'md';

    public const DEFAULT_FIT = 'cover';

    public const DEFAULT_SHOW_LABEL = true;
}
