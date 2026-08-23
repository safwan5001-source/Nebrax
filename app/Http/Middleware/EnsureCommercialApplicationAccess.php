<?php

namespace App\Http\Middleware;

use App\Models\Tenant;
use App\Services\ApplicationAccessDecision;
use App\Support\ApplicationAccessLevel;
use App\Support\ApplicationOperationClass;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * إنفاذ القرار التجاري/التشغيلي المركب لمسارات جديدة مبنية بعد منصة
 * الاستحقاقات. لا ينتظر cohort rollout ولا يستبدل RBAC: يمرّ RBAC كوسيط مستقل
 * على route ثم يحسم هذا الحارس catalog + entitlement + lifecycle + application
 * status بصورة fail-closed.
 */
class EnsureCommercialApplicationAccess
{
    public function __construct(private ApplicationAccessDecision $access) {}

    public function handle(Request $request, Closure $next, string $capabilityKey, string $operation = 'read'): Response
    {
        $operationClass = ApplicationOperationClass::tryFrom($operation);
        if ($operationClass === null) {
            abort(500, 'Fuel Stations route has an invalid access operation.');
        }

        $tenant = Tenant::findOrFail($request->user()->tenant_id);
        $decision = $this->access->decide($tenant, $capabilityKey, $operationClass);
        if ($decision->level === ApplicationAccessLevel::DENIED) {
            abort(403, 'لا تتوفر صلاحية فعالة لهذه القدرة.');
        }

        return $next($request);
    }
}
