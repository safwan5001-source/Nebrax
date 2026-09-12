<?php

namespace App\Http\Middleware;

use App\Tenancy\HostnameTenantContext;
use App\Tenancy\TenantContext;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

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
            return $next($request);
        } finally {
            // TenantContext is a singleton for the application lifetime; never
            // let one request's tenant become the default for the next request.
            $this->tenant->forget();
        }
    }
}
