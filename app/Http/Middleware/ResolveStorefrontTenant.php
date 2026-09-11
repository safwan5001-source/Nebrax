<?php

namespace App\Http\Middleware;

use App\Models\SalesChannel;
use App\Models\Tenant;
use App\Tenancy\BranchContext;
use App\Tenancy\StorefrontContext;
use App\Tenancy\TenantContext;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * ⚠️ **متوارَث COM-7-P1 — تطويري/اختباري محضٌ فقط منذ COM-7-P2A، ليس سلطة
 * إنتاج.** يحلّ مستأجر ومتجر Commerce العام من شريحة الرابط `{tenantSlug}`.
 * سلطة الإنتاج المعتمدة أصبحت `ResolveStorefrontDomain` (حسم عبر Host/
 * `StorefrontDomain`، AWJ_COM_7_P2_STOREFRONT_DOMAIN_RESOLUTION_DECISION.md
 * §7). هذا الوسيط **يرفض العمل في بيئة `production`** (تحقّق دفاعي مباشر
 * أدناه)، بالإضافة إلى أن مساراته لا تُسجَّل أصلاً هناك
 * (`routes/api_storefront.php`) — طبقتا حماية مستقلتان، لا نقطة فشل واحدة.
 * يبقى مفيداً حصراً للتطوير المحلي/الاختبار الآلي بلا DNS حقيقي (القرار
 * السابق AWJ_STOREFRONT_PLACEMENT_TENANT_RESOLUTION_DECISION.md §11 يسمح
 * صراحةً بآلية development-only كهذه، بشرط ألا تعمل في الإنتاج ولا تتحول
 * backdoor لاختيار مستأجر).
 *
 * لا يثق بأي `tenant_id`/`X-Tenant-ID` من العميل إطلاقاً؛ المصدر الوحيد هو
 * `Tenant.slug` المخزَّن، تماماً كما يفعل `ResolveCustomerTenant` لمسار
 * العميل المصادَق.
 *
 * القناة: تُحلّ إلى قناة البيع النشطة الوحيدة من نوع `web` للمستأجر — لا
 * دعم متعدد المتاجر/القنوات في هذا المسار المتوارَث (تعدّد المتاجر الحقيقي
 * عبر `Storefront`/`StorefrontDomain` في المسار الموثوق فقط). غياب قناة
 * `web` نشطة يعني «لا متجر مهيَّأ لهذا المستأجر» — 404 غير كاشف، لا سقوط
 * على أي قناة أخرى. لا `storefrontId` في السياق الناتج هنا عمداً — هذا
 * المسار سابقٌ لوجود نموذج `Storefront` أصلاً.
 *
 * فشل الحلّ دائماً 404 غير كاشف (لا فرق بين مستأجر غير موجود ومستأجر معطّل
 * ومتجر غير مهيَّأ وبيئة إنتاج) — لا يُسرَّب أي تلميح يفيد في تعداد المستأجرين.
 */
class ResolveStorefrontTenant
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

        // حارسٌ دفاعي مستقلّ عن عدم تسجيل هذه المسارات في الإنتاج أصلاً
        // (`routes/api_storefront.php`) — لا يعتمد أمن هذا المسار المتوارَث
        // على طبقة واحدة فقط.
        if (app()->environment('production')) {
            abort(404, 'تعذّر تحديد متجر صالح.');
        }

        $slug = (string) $request->route('tenantSlug');

        if (! preg_match('/\A[A-Za-z0-9_-]{1,255}\z/', $slug)) {
            abort(404, 'تعذّر تحديد متجر صالح.');
        }

        $tenant = Tenant::query()
            ->where('slug', $slug)
            ->where('is_active', true)
            ->first();

        if ($tenant === null) {
            abort(404, 'تعذّر تحديد متجر صالح.');
        }

        $this->tenantContext->set($tenant->id);

        // مُصفّاة الآن بـ TenantScope الحالي — لا تسريب بين المستأجرين.
        $channel = SalesChannel::query()
            ->where('type', SalesChannel::TYPE_WEB)
            ->where('is_active', true)
            ->orderBy('created_at')
            ->first();

        if ($channel === null) {
            $this->tenantContext->forget();
            abort(404, 'تعذّر تحديد متجر صالح.');
        }

        $this->storefrontContext->set($tenant->id, $channel->id);

        try {
            return $next($request);
        } finally {
            $this->tenantContext->forget();
            $this->branchContext->forget();
            $this->storefrontContext->forget();
        }
    }
}
