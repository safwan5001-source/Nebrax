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
 * يحلّ مستأجر ومتجر Commerce العام من شريحة الرابط `{tenantSlug}`، قبل أي
 * استعلام كتالوج — بلا مصادقة عميل (تصفح مجهول). لا يثق بأي `tenant_id`/
 * `X-Tenant-ID` من العميل إطلاقاً؛ المصدر الوحيد هو `Tenant.slug` المخزَّن،
 * تماماً كما يفعل `ResolveCustomerTenant` لمسار العميل المصادَق.
 *
 * القناة: تُحلّ إلى قناة البيع النشطة الوحيدة من نوع `web` للمستأجر — لا
 * دعم متعدد المتاجر/القنوات في COM-7-P1 (مؤجَّل، انظر
 * AWJ_STOREFRONT_PLACEMENT_TENANT_RESOLUTION_DECISION.md §4). غياب قناة
 * `web` نشطة يعني «لا متجر مهيَّأ لهذا المستأجر» — 404 غير كاشف، لا سقوط
 * على أي قناة أخرى.
 *
 * فشل الحلّ دائماً 404 غير كاشف (لا فرق بين مستأجر غير موجود ومستأجر معطّل
 * ومتجر غير مهيَّأ) — لا يُسرَّب أي تلميح يفيد في تعداد المستأجرين.
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
