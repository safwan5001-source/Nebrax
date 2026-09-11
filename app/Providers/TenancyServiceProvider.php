<?php

namespace App\Providers;

use App\Http\Controllers\Api\PaymentController;
use App\Http\Middleware\EnsureActiveSubscription;
use App\Http\Middleware\EnsurePermission;
use App\Http\Middleware\EnsureUserPrincipal;
use App\Http\Middleware\ForceJsonResponse;
use App\Http\Middleware\SetBranch;
use App\Http\Middleware\SetTenant;
use App\Support\RevisionBuffer;
use App\Tenancy\BranchContext;
use App\Tenancy\BranchSharing;
use App\Tenancy\CustomerContext;
use App\Tenancy\TenantContext;
use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\Facades\Route;
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
        $this->app->scoped(CustomerContext::class, fn () => new CustomerContext());
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

        // PAY-V2-1B: نفس مجموعة حماية سندات القبض/الصرف. المسار يجاور
        // `POST payments/{id}/post` من حيث العقد والصلاحية.
        Route::middleware([
            ForceJsonResponse::class,
            'auth:sanctum',
            EnsureUserPrincipal::class,
            SetTenant::class,
            SetBranch::class,
            EnsureActiveSubscription::class,
            EnsurePermission::class.':payments.manage',
        ])->post('api/payments/{id}/reverse', [PaymentController::class, 'reverse'])
            ->whereUuid('id');
    }
}
