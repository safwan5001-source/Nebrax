<?php

namespace App\Providers;

use App\Http\Middleware\SlowRequestAttribution;
use App\Models\CustomerIdentity;
use App\Services\Commerce\Edge\RailwayStorefrontEdgeClient;
use App\Services\Commerce\Edge\StorefrontEdgeClient;
use App\Support\Dns\DnsTxtResolver;
use App\Support\Dns\NativeDnsTxtResolver;
use App\Support\RevisionBuffer;
use App\Support\SlowRequestMetrics;
use App\Tenancy\BranchContext;
use App\Tenancy\BranchSharing;
use App\Tenancy\CustomerContext;
use App\Tenancy\StorefrontContext;
use App\Tenancy\HostnameTenantContext;
use App\Tenancy\TenantContext;
use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Database\Events\QueryExecuted;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
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

        // \`scoped\` لا \`singleton\`: حاملُ قيود سجلّ التغييرات يجب أن يموت مع
        // الطلب/المهمّة، وإلا دُمج تعديلُ مستندٍ في قيدِ مهمّةٍ سابقة داخل
        // العامل نفسه. الحاوية تُفرغ الـ scoped بين كل طلب وكل مهمّة طابور.
        $this->app->scoped(RevisionBuffer::class, fn () => new RevisionBuffer());

        // STORE-ADMIN-ADOPT-1B-3A — تنفيذ DNS TXT الإنتاجي الوحيد (لا مزوّد
        // خارجي، \`dns_get_record()\` المدمجة في PHP). الاختبارات تستبدله بربط
        // وهمي حتمي عبر الحاوية (\`app()->instance(DnsTxtResolver::class, ...)\`)
        // قبل حلّ أي خدمة تعتمد عليه — بلا تغيير هنا.
        $this->app->bind(DnsTxtResolver::class, NativeDnsTxtResolver::class);
        $this->app->bind(StorefrontEdgeClient::class, RailwayStorefrontEdgeClient::class);

        // POS يملك مزوده التشغيلي حتى لا يعتمد على HR ولا يوسّع ملف routes/api.php
        // الكبير لأجل مسارات Domain صغيرة مستقلة.
        $this->app->register(PosServiceProvider::class);
        // Commerce Workspace admin routes stay isolated from the public storefront API.
        $this->app->register(CommerceWorkspaceServiceProvider::class);
    }

    public function boot(): void
    {
        // Listener واحد لكل دورة حياة Laravel؛ لا يحمل state. يقرأ Request
        // الحالي فقط، فلا تتراكم المقاييس بين طلبات mod_php أو runtimes طويلة العمر.
        DB::listen(function (QueryExecuted $query): void {
            if (! $this->app->bound('request')) {
                return;
            }

            $metrics = $this->app->make('request')->attributes->get(SlowRequestAttribution::METRICS_ATTRIBUTE);

            if ($metrics instanceof SlowRequestMetrics) {
                $metrics->recordQuery((float) $query->time);
            }
        });

        // يُلحق بمجموعة API الفعلية من Laravel، قبل middleware المسار، ليقيس
        // زمن Laravel فقط ولا يمسّ قرار tenant/auth أو ترتيبها.
        $this->app['router']->prependMiddlewareToGroup('api', SlowRequestAttribution::class);

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

        RateLimiter::for('auth-recovery', fn (Request $request): array => [
            Limit::perMinute(5)->by('auth-recovery|ip|' . $request->ip()),
            Limit::perMinute(3)->by('auth-recovery|email|' . Str::lower(trim((string) $request->input('email')))),
        ]);

        RateLimiter::for('auth-reset', fn (Request $request): Limit =>
            Limit::perMinute(10)->by('auth-reset|ip|' . $request->ip()));

        // TENANT-PROVISIONING-E2E-1 — استبدال رمز انتقال ما بعد التسجيل.
        // بالـ IP فقط: لا بريد في هذا الطلب (الرمز وحده هو المعرّف)، ومدة
        // صلاحية الرمز نفسها دقيقتان فقط (\`AuthRecoveryService::HANDOFF_TTL_MINUTES\`).
        RateLimiter::for('auth-handoff', fn (Request $request): Limit =>
            Limit::perMinute(10)->by('auth-handoff|ip|' . $request->ip()));

        // COM-MOBILE-AUTH-1 — /commerce/v1 has no `tenantSlug` route
        // parameter (tenant comes from the ApiClient bearer), so these
        // mirror customer-register/customer-login's own IP+identifier dual
        // limit but key the tenant dimension off TenantContext instead.
        // Defense in depth alongside EnforcePublicApiRateLimit:sensitive,
        // which is keyed per store ApiClient — shared across *every*
        // customer of that store — not per end customer: without this, one
        // busy tenant (or one caller holding the shared store token) could
        // exhaust the whole store's auth quota and lock out every other
        // customer trying to log in at the same time (Codex finding, PR #920).
        RateLimiter::for('commerce-customer-register', function (Request $request): array {
            $tenant = app(TenantContext::class)->has() ? app(TenantContext::class)->id() : 'unresolved';
            $email = Str::lower(trim((string) $request->input('email')));

            return [
                Limit::perMinute(10)->by("commerce-customer-register|{$tenant}|ip|{$request->ip()}"),
                Limit::perMinute(3)->by("commerce-customer-register|{$tenant}|email|{$email}"),
            ];
        });

        RateLimiter::for('commerce-customer-login', function (Request $request): array {
            $tenant = app(TenantContext::class)->has() ? app(TenantContext::class)->id() : 'unresolved';
            $email = Str::lower(trim((string) $request->input('email')));

            return [
                Limit::perMinute(20)->by("commerce-customer-login|{$tenant}|ip|{$request->ip()}"),
                Limit::perMinute(5)->by("commerce-customer-login|{$tenant}|email|{$email}"),
            ];
        });

        // Separate names for request vs. verify: a legitimate customer's
        // own request+retry flow for one phone must not share a single
        // budget across both actions, or its own retries would lock it out.
        RateLimiter::for('commerce-customer-otp-request', function (Request $request): array {
            $tenant = app(TenantContext::class)->has() ? app(TenantContext::class)->id() : 'unresolved';
            $phone = trim((string) $request->input('phone'));

            return [
                Limit::perMinute(10)->by("commerce-customer-otp-request|{$tenant}|ip|{$request->ip()}"),
                Limit::perMinute(5)->by("commerce-customer-otp-request|{$tenant}|phone|{$phone}"),
            ];
        });

        RateLimiter::for('commerce-customer-otp-verify', function (Request $request): array {
            $tenant = app(TenantContext::class)->has() ? app(TenantContext::class)->id() : 'unresolved';
            $phone = trim((string) $request->input('phone'));

            return [
                Limit::perMinute(20)->by("commerce-customer-otp-verify|{$tenant}|ip|{$request->ip()}"),
                Limit::perMinute(10)->by("commerce-customer-otp-verify|{$tenant}|phone|{$phone}"),
            ];
        });

        // Authenticated me/logout: EnforcePublicApiRateLimit:write there is
        // still keyed per store ApiClient (shared across every customer of
        // that store) — this adds a per-customer-identity dimension so one
        // customer's traffic cannot exhaust another's budget. Falls back to
        // IP only if AuthenticateCommerceCustomer hasn't resolved an
        // identity yet (defensive; it always has by the time this runs).
        RateLimiter::for('commerce-customer-session', function (Request $request): Limit {
            $identity = $request->user();
            $key = $identity instanceof CustomerIdentity ? $identity->getKey() : $request->ip();

            return Limit::perMinute(30)->by('commerce-customer-session|' . $key);
        });
    }
}
