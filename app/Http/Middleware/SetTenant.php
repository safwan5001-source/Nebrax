<?php

namespace App\Http\Middleware;

use App\Tenancy\HostnameTenantContext;
use App\Tenancy\TenantContext;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\HttpFoundation\StreamedResponse;

/**
 * يضبط المستأجر الحالي من المستخدم المصادَق عليه.
 * كل الاستعلامات بعده ستُعزل تلقائياً.
 *
 * إن حُسم مستأجر من النطاق الفرعي (`HostnameTenantContext`) فيجب أن يطابق
 * `user.tenant_id` — وإلا فشل مغلق بلا إقامة سياق وبلا التبديل إلى مستأجر
 * المستخدم.
 */
class SetTenant
{
    public function __construct(
        protected TenantContext $tenant,
        protected HostnameTenantContext $hostnameTenant,
    ) {}

    public function handle(Request $request, Closure $next): Response
    {
        $user = $request->user();

        if (! $user || ! $user->tenant_id) {
            return response()->json(['message' => 'لا يوجد مستأجر مرتبط بالحساب.'], 403);
        }

        if ($this->hostnameTenant->has() && $this->hostnameTenant->id() !== $user->tenant_id) {
            return response()->json(['message' => 'لا يوجد مستأجر مرتبط بالحساب.'], 403);
        }

        if (! $user->tenant->is_active) {
            return response()->json(['message' => 'الاشتراك غير مفعّل.'], 403);
        }

        $this->tenant->set($user->tenant_id);

        try {
            $response = $next($request);

            // Symfony executes streamed callbacks after the middleware stack
            // returns. Re-establish this request's tenant only for that callback
            // and clear it again so exports cannot run unscoped or cross-tenant.
            if ($response instanceof StreamedResponse) {
                $callback = $response->getCallback();
                $tenantId = $user->tenant_id;
                $response->setCallback(function () use ($callback, $tenantId): void {
                    $this->tenant->set($tenantId);

                    try {
                        $callback();
                    } finally {
                        $this->tenant->forget();
                    }
                });
            }

            return $response;
        } finally {
            // TenantContext is a singleton for the application lifetime; never
            // let one request's tenant become the default for the next request.
            $this->tenant->forget();
        }
    }
}
