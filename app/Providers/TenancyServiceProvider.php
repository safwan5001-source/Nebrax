<?php

namespace App\Providers;

use App\Support\RevisionBuffer;
use App\Tenancy\BranchContext;
use App\Tenancy\BranchSharing;
use App\Tenancy\CustomerContext;
use App\Tenancy\StorefrontContext;
use App\Tenancy\HostnameTenantContext;
use App\Tenancy\TenantContext;
use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\ServiceProvider;
use Illuminate\Support\Str;

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
        $this->app->singleton(HostnameTenantContext::class, fn () => new HostnameTenantContext());
        $this->app->scoped(CustomerContext::class, fn () => new CustomerContext());
        // سياق متجر Commerce العام (tenant + sales channel) — تصفح مجهول، لا مصادقة.
        $this->app->scoped(StorefrontContext::class, fn () => new StorefrontContext());
        // سياق الفرع النشط — بُعد كتابة (وسم المستندات)، لا حاجز عزل.
        $this->app->singleton(BranchContext::class, fn () => new BranchContext());
        // مفاتيح مشاركة البيانات بين الفروع — تُقرأ مرة واحدة للطلب (حاسم للأداء).
        $this->app->singleton(BranchSharing::class, fn () => new BranchSharing());

        // `scoped` لا `singleton`: حاملُ قيود سجلّ التغييرات يجب أن يموت مع
        // الطلب/المهمّة، وإلا دُمج تعديلُ مستندٍ في قيدِ مهمّةٍ سابقة داخل
        // العامل نفسه. الحاوية تُفرغ الـ scoped بين كل طلب وكل مهمّة طابور.
        $this->app->scoped(RevisionBuffer::class, fn () => new RevisionBuffer());

        // POS يملك مزوده التشغيلي حتى لا يعتمد على HR ولا يوسّع ملف routes/api.php
        // الكبير لأجل مسارات Domain صغيرة مستقلة.
        $this->app->register(PosServiceProvider::class);
        // Commerce Workspace admin routes stay isolated from the public storefront API.
        $this->app->register(CommerceWorkspaceServiceProvider::class);
    }

    public function boot(): void
    {
        // محدِّد مستقل للتسجيل — الـ throttle الافتراضي يتشارك عدّاد الـ IP نفسه
        // بين المسارات، فيستهلك التسجيلُ محاولاتِ الدخول والعكس.
        RateLimiter::for('register', fn (Request $request) => Limit::perMinute(3)->by('register|' . $request->ip()));

        RateLimiter::for('customer-register', function (Request $request): array {
            $tenant = (string) $request->route('tenantSlug');
            $email = Str::lower(trim((string) $request->input('email')));

            return [
                Limit::perMinute(10)->by("customer-register|{$tenant}|ip|{$request->ip()}"),
                Limit::perMinute(3)->by("customer-register|{$tenant}|email|{$email}"),
            ];
        });

        RateLimiter::for('customer-login', function (Request $request): array {
            $tenant = (string) $request->route('tenantSlug');
            $email = Str::lower(trim((string) $request->input('email')));

            return [
                Limit::perMinute(20)->by("customer-login|{$tenant}|ip|{$request->ip()}"),
                Limit::perMinute(5)->by("customer-login|{$tenant}|email|{$email}"),
            ];
        });
    }
}
