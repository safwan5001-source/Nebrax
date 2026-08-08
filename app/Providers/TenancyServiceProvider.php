<?php

namespace App\Providers;

use App\Tenancy\BranchContext;
use App\Tenancy\TenantContext;
use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\ServiceProvider;

/**
 * يسجّل TenantContext كـ singleton — حاسم لعمل العزل.
 * بدونه كل app(TenantContext::class) ينشئ نسخة جديدة ويضيع السياق.
 *
 * التسجيل: أضف هذا المزود إلى bootstrap/providers.php
 */
class TenancyServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        $this->app->singleton(TenantContext::class, fn () => new TenantContext());
        // سياق الفرع النشط — بُعد كتابة (وسم المستندات)، لا حاجز عزل.
        $this->app->singleton(BranchContext::class, fn () => new BranchContext());
    }

    public function boot(): void
    {
        // محدِّد مستقل للتسجيل — الـ throttle الافتراضي يتشارك عدّاد الـ IP نفسه
        // بين المسارات، فيستهلك التسجيلُ محاولاتِ الدخول والعكس.
        RateLimiter::for('register', fn (Request $request) => Limit::perMinute(3)->by('register|' . $request->ip()));
    }
}
