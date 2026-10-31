<?php

namespace App\Support;

/**
 * تعريف خطط الاشتراك وحدودها. null = بلا حد (Enterprise).
 * يمكن لكل مستأجر تجاوز الحدود عبر العمود plan_limits (json).
 */
class Plans
{
    /**
     * `builder_*` (DRF-07 / S02c): حدود كمية صانع التطبيقات — افتراضات **سخيّة** (لا تمسّ الاستخدام العادي ولا الحسابات التجريبية)،
     * تُضبط لكل مستأجر عبر `plan_limits` (null = بلا حد). `builder_apps` لكل مستأجر، `builder_versions_per_app` نسخ منشورة لكل تطبيق،
     * `builder_active_previews` جلسات/مراجع معاينة نشطة لكل تطبيق.
     */
    public const PLANS = [
        'free'       => ['invoices_per_month' => 50,   'users' => 2,    'builder_apps' => 10,  'builder_versions_per_app' => 200,  'builder_active_previews' => 50],
        'basic'      => ['invoices_per_month' => 500,  'users' => 5,    'builder_apps' => 30,  'builder_versions_per_app' => 500,  'builder_active_previews' => 100],
        'pro'        => ['invoices_per_month' => 5000, 'users' => 20,   'builder_apps' => 100, 'builder_versions_per_app' => 2000, 'builder_active_previews' => 200],
        'enterprise' => ['invoices_per_month' => null, 'users' => null, 'builder_apps' => null, 'builder_versions_per_app' => null, 'builder_active_previews' => null],
    ];

    public static function defaults(string $plan): array
    {
        return self::PLANS[$plan] ?? self::PLANS['free'];
    }
}
