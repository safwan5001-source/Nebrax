<?php

namespace App\Support;

/**
 * تعريف خطط الاشتراك وحدودها. null = بلا حد (Enterprise).
 * يمكن لكل مستأجر تجاوز الحدود عبر العمود plan_limits (json).
 */
class Plans
{
    public const PLANS = [
        'free'       => ['invoices_per_month' => 50,   'users' => 2],
        'basic'      => ['invoices_per_month' => 500,  'users' => 5],
        'pro'        => ['invoices_per_month' => 5000, 'users' => 20],
        'enterprise' => ['invoices_per_month' => null, 'users' => null],
    ];

    public static function defaults(string $plan): array
    {
        return self::PLANS[$plan] ?? self::PLANS['free'];
    }
}
