<?php

namespace App\Http\Middleware;

use App\Models\Tenant;
use App\Support\PlanGate;
use App\Tenancy\TenantContext;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * يمنع استخدام الموارد إذا كان اشتراك المؤسسة منتهياً أو غير مفعّل.
 */
class EnsureActiveSubscription
{
    public function handle(Request $request, Closure $next): Response
    {
        $tenant = Tenant::find(app(TenantContext::class)->id());

        if (! $tenant || ! PlanGate::subscriptionActive($tenant)) {
            abort(403, 'اشتراك المؤسسة غير نشط أو منتهٍ.');
        }

        return $next($request);
    }
}
