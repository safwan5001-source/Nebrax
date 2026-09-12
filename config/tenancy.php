<?php

/**
 * ═══════════════════════════════════════════════════════════════
 *  نطاقات مستأجر ERP الفرعية — V1 (AWJ-controlled subdomains only)
 * ═══════════════════════════════════════════════════════════════
 *  الإنتاج المستهدف: `{slug}.awj.app` حيث `slug` هو `tenants.slug`.
 *
 *  لا تخلط هذا مع `StorefrontDomain` (متجر Commerce). مسار المتجر يحسم من
 *  صف نطاق مخزَّن؛ مسار ERP يحسم من شريحة واحدة تحت نطاق أساسي قابل للضبط.
 *
 *  `AWJ_TENANT_BASE_DOMAIN` نطاق واحد. `AWJ_TENANT_BASE_DOMAINS` قائمة
 *  مفصولة بفواصل لبيئات التطوير/المعاينة (مثل `awj.app,localhost,awj.test`).
 *  إن وُجدت القائمة فهي المصدر؛ وإلا يُستخدم النطاق الواحد فالافتراض `awj.app`.
 */
$baseDomains = array_values(array_unique(array_filter(array_map(
    static fn (string $domain): string => mb_strtolower(trim($domain)),
    explode(',', (string) (
        env('AWJ_TENANT_BASE_DOMAINS') !== null && env('AWJ_TENANT_BASE_DOMAINS') !== ''
            ? env('AWJ_TENANT_BASE_DOMAINS')
            : env('AWJ_TENANT_BASE_DOMAIN', 'awj.app')
    )),
))));

$extraReserved = array_values(array_filter(array_map(
    static fn (string $slug): string => mb_strtolower(trim($slug)),
    explode(',', (string) env('AWJ_TENANT_RESERVED_SLUGS', '')),
)));

return [
    'base_domains' => $baseDomains !== [] ? $baseDomains : ['awj.app'],

    /*
     * أسماء بنية تحتية/نظام لا يجوز تسجيلها كـ slug ولا تُفسَّر كمستأجر.
     * الطلبات على هذه المضيفات تبقى على مسار الدخول الحالي (غير المستأجر).
     *
     * القائمة الأساسية من متطلّب V1 + دليل المستودع:
     * platform (وحدة تشغيل داخلية)، store/storefront (Commerce على نفس الأب).
     */
    'reserved_slugs' => array_values(array_unique(array_merge([
        'www',
        'api',
        'app',
        'admin',
        'platform',
        'support',
        'store',
        'storefront',
    ], $extraReserved))),
];
