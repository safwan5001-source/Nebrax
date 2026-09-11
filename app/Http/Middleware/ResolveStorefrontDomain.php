<?php

namespace App\Http\Middleware;

use App\Models\SalesChannel;
use App\Models\Storefront;
use App\Models\StorefrontDomain;
use App\Support\HostnameNormalizer;
use App\Support\InvalidHostnameException;
use App\Tenancy\BranchContext;
use App\Tenancy\StorefrontContext;
use App\Tenancy\TenantContext;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * ═══════════════════════════════════════════════════════════════
 *  حسم Storefront/Tenant/SalesChannel من الـ Host الوارد — سلطة الإنتاج
 *  المعتمدة لـ COM-7-P2A
 * ═══════════════════════════════════════════════════════════════
 *  (AWJ_COM_7_P2_STOREFRONT_DOMAIN_RESOLUTION_DECISION.md §7). يحلّ محلّ
 *  `ResolveStorefrontTenant` القائم على شريحة الرابط كسلطة إنتاج فعلية؛ ذاك
 *  الوسيط يبقى مساراً تطويرياً/اختبارياً محضاً فقط (انظر تعليقه).
 *
 *  السلسلة الكاملة، وفشلٌ مغلقٌ غير كاشف (404 موحّد، لا فرق بين الحالات) عند
 *  أي خطوة:
 *
 *    Host الوارد
 *      → تطبيع/تحقّق (`HostnameNormalizer`) — مضيف غير صالح → 404
 *      → `StorefrontDomain` بهذا الـ hostname — غير موجود → 404
 *      → نشط (`is_active`) وموثَّق (`verification_status = verified`) — غير ذلك → 404
 *      → `Storefront` (`storefront_id`) نشط — غير ذلك → 404
 *      → `SalesChannel` (`storefront.sales_channel_id`) نشطة ومن نوع `web`
 *        **تابعة لنفس مستأجر النطاق** — غير ذلك → 404
 *      → `StorefrontContext` موثوق (tenant + channel + storefront)
 *
 *  لا ثقة بأي مدخل غير الـ Host نفسه: لا `tenant_id`، لا ترويسة/كوكي عامة، لا
 *  لغة، لا شريحة رابط، لا `AWJ_STORE_TENANT_SLUG`. البحث الأول عن
 *  `StorefrontDomain` يجري **قبل** ضبط أي `TenantContext` — فالنطاق العالمي
 *  الفريد هو ما يحسم المستأجر، لا العكس؛ `TenantScope::apply()` لا يفرض أي
 *  فلترة حين لا يوجد سياق مستأجر فعّال، فالبحث الأول شاملٌ عبر كل المستأجرين
 *  بتصميم `TenantScope` نفسه — بلا حاجة لتجاوزه يدوياً هنا.
 *
 *  كل استعلامٍ لاحق (`Storefront`، `SalesChannel`) يُصفَّى فعلياً بـ`TenantScope`
 *  بعد ضبط السياق من مستأجر النطاق — تحقّقٌ إضافي مستقلّ عن قيد FK وحده، بنفس
 *  نمط `FulfillmentPolicyService`: لا اعتماد على أن `storefront_id`/
 *  `sales_channel_id` المخزَّنين صحيحان بالضرورة، بل إعادة تحقّق فعلية.
 */
class ResolveStorefrontDomain
{
    public function __construct(
        private TenantContext $tenantContext,
        private BranchContext $branchContext,
        private StorefrontContext $storefrontContext,
    ) {}

    public function handle(Request $request, Closure $next): Response
    {
        $this->tenantContext->forget();
        $this->branchContext->forget();
        $this->storefrontContext->forget();

        try {
            $hostname = HostnameNormalizer::normalize($request->getHost());
        } catch (InvalidHostnameException) {
            abort(404, 'تعذّر تحديد متجر صالح.');
        }

        // لا سياق مستأجر نشط بعد — بحثٌ شامل عمداً (راجع رأس الملف).
        $domain = StorefrontDomain::query()->where('hostname', $hostname)->first();

        if ($domain === null || ! $domain->is_active || ! $domain->isVerified()) {
            abort(404, 'تعذّر تحديد متجر صالح.');
        }

        $this->tenantContext->set($domain->tenant_id);

        $storefront = Storefront::query()
            ->whereKey($domain->storefront_id)
            ->where('is_active', true)
            ->first();

        if ($storefront === null) {
            $this->tenantContext->forget();
            abort(404, 'تعذّر تحديد متجر صالح.');
        }

        $channel = SalesChannel::query()
            ->whereKey($storefront->sales_channel_id)
            ->where('type', SalesChannel::TYPE_WEB)
            ->where('is_active', true)
            ->first();

        if ($channel === null) {
            $this->tenantContext->forget();
            abort(404, 'تعذّر تحديد متجر صالح.');
        }

        $this->storefrontContext->set($domain->tenant_id, $channel->id, $storefront->id);

        try {
            return $next($request);
        } finally {
            $this->tenantContext->forget();
            $this->branchContext->forget();
            $this->storefrontContext->forget();
        }
    }
}
