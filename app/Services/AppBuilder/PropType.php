<?php

namespace App\Services\AppBuilder;

/**
 * أنواع قيم الخصائص (`props`) المتحقَّقة فعلياً — مُستخرجة من قراءة كل
 * `_stringProp`/`_intProp`/`_stringListProp` في
 * `mobile/lib/registry/component_widgets.dart`، لا من قائمة توضيحية في
 * `COMPONENT_REGISTRY_V1.md` §7 (ذاك أوسع بكثير ممّا بُني/اختُبر فعلاً:
 * ألوان دلالية، إعدادات مسافة، مراجع صفحات... لا شيء منها مقروء في أي
 * `build*` اليوم). القائمة هنا تُذكر فقط الأنواع التي شهدتها الودجات
 * الخمس عشرة الحقيقية — توسيعها لاحقاً قرارٌ يقتضي دليلاً جديداً، لا تخمين.
 */
final class PropType
{
    private function __construct() {}

    /** نص عادٍ — `_stringProp`. */
    public const STRING = 'string';

    /** رابط وسائط يُقبل https فقط، وإلا صورة بديلة آمنة — `buildImage`. */
    public const ASSET_URL = 'assetUrl';

    /** عدد صحيح عام — `_intProp`. */
    public const INTEGER = 'integer';

    /** عدد صحيح يمثّل مبلغاً بالهللات (وحدة نقدية صغرى) — `formatMinorAmount`. */
    public const AMOUNT_MINOR = 'amountMinor';

    /** قائمة نصوص — `_stringListProp` (`VariantSelector.options` فقط اليوم). */
    public const STRING_LIST = 'stringList';
}
