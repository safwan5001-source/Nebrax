<?php

namespace App\Http\Middleware;

use App\Models\Invoice;
use App\Models\Tenant;
use App\Support\PlanGate;
use App\Tenancy\TenantContext;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * يفرض حدود خطة الاشتراك على إنشاء الموارد.
 * الاستخدام: ->middleware(EnforcePlanLimit::class.':invoices')
 */
class EnforcePlanLimit
{
    public function handle(Request $request, Closure $next, string $resource): Response
    {
        $tenant = Tenant::find(app(TenantContext::class)->id());

        if ($tenant && $resource === 'invoices') {
            $limit = PlanGate::limit($tenant, 'invoices_per_month');
            if ($limit !== null) {
                $count = Invoice::whereBetween('created_at', [
                    now()->startOfMonth(), now()->endOfMonth(),
                ])->count();

                if ($count >= $limit) {
                    abort(422, "تجاوزت حدّ خطتك ({$limit} فاتورة شهرياً). رقِّ خطتك للمزيد.");
                }
            }
        }

        return $next($request);
    }
}
