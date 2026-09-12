<?php

namespace App\Http\Middleware;

use App\Tenancy\HostnameTenantContext;
use App\Tenancy\TenantHostnameResolver;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * يحدّد مستأجر ERP من مضيف الطلب **قبل** مصادقة الموظفين عندما يكون الطلب
 * في وضع النطاق الفرعي `{slug}.{base_domain}`.
 *
 * لا يضبط `TenantContext` — ذلك يبقى من اختصاص `SetTenant` بعد المصادقة.
 * يخزّن الناتج في `HostnameTenantContext` ليتحقق الدخول و`SetTenant` أن
 * المستخدم ينتمي لنفس المستأجر، ويفشل مغلقاً عند التعارض دون تبديل صامت.
 *
 * مصدر المضيف: `$request->getHost()` أولاً، ثم `Origin` (الواجهة على Vercel
 * تستدعي Laravel على مضيف API منفصل؛ المتصفح يضع Origin ولا يمكن لـ JS
 * تزويره). لا ترويسة عميل حرّة مثل `X-Tenant-Slug`.
 */
class IdentifyTenantHostname
{
    public function __construct(
        private HostnameTenantContext $hostnameTenant,
        private TenantHostnameResolver $resolver,
    ) {}

    public function handle(Request $request, Closure $next): Response
    {
        $this->hostnameTenant->forget();

        $resolved = $this->resolver->resolveFromRequest($request);

        if ($resolved === null) {
            return $next($request);
        }

        $this->hostnameTenant->set($resolved['id'], $resolved['slug']);

        try {
            return $next($request);
        } finally {
            $this->hostnameTenant->forget();
        }
    }
}
