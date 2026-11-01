<?php

namespace App\Services\AppBuilder;

/**
 * AD-04 / S09a — عقد غلاف التطبيق (`navigation.tabs[]` و`navigation.appBar`).
 *
 * مصدر واحد للثوابت والقواعد البنيوية: المحلل (`AppSchemaParser`) والفاحصة (`AppSchemaContractChecker`) والمحلّل
 * التوافقي (`CompatibilityResolver`) يقرأون منه، ويطابقه حرفياً `mobile/lib/schema/navigation_shell.dart`.
 * مفتاحان جديدان على مستوى `navigation` ⇒ ميزتا مخطط `navigation.tabs` و`navigation.appBar` ⇒ جيل Runtime 1.1.0 (AD-02):
 * الجيل 1.0.0 لا يعلنهما فيُرفض المخطط الذي يستعملهما (فشل مغلق) بدل إسقاط التبويبات بصمت.
 */
final class NavigationShell
{
    private function __construct() {}

    public const FEATURE_TABS = 'navigation.tabs';

    public const FEATURE_APP_BAR = 'navigation.appBar';

    /** @var list<string> أيقونات مسموحة (قائمة مغلقة؛ لا رفع أيقونات قبل خط الوسائط AD-07). */
    public const TAB_ICONS = ['home', 'search', 'category', 'cart', 'favorite', 'person', 'menu', 'orders', 'store', 'offers'];

    public const TAB_KEYS = ['pageId', 'title', 'icon', 'hidden'];

    public const APP_BAR_KEYS = ['title', 'showCart'];

    public const MAX_TABS = 8;

    public const MAX_VISIBLE_TABS = 5;

    public const MAX_TAB_TITLE = 24;

    public const MAX_APP_BAR_TITLE = 40;

    /**
     * ميزات الغلاف التي يستعملها هذا `navigation` (مفاتيح الميزات اللازمة من الجيل).
     *
     * @param  array<string, mixed>  $navigation
     * @return list<string>
     */
    public static function requiredFeatures(array $navigation): array
    {
        $features = [];
        if (array_key_exists('tabs', $navigation)) {
            $features[] = self::FEATURE_TABS;
        }
        if (array_key_exists('appBar', $navigation)) {
            $features[] = self::FEATURE_APP_BAR;
        }

        return $features;
    }

    /** @param  array<string, mixed>  $tab */
    public static function isHidden(array $tab): bool
    {
        return ($tab['hidden'] ?? false) === true;
    }
}
