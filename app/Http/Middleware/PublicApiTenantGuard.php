<?php

namespace App\Http\Middleware;

use App\Support\PublicApiErrorCode;
use App\Support\PublicApiResponse;
use App\Tenancy\TenantContext;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * حارس fail-closed للمسارات العامة المرتبطة بمستأجر.
 *
 * كشف Phase 0 أن `TenantScope` الداخلي **fail-open** (لا يصفّي إن غاب السياق —
 * `app/Tenancy/TenantScope.php`). لذلك أيّ مسار Public يمسّ بيانات مستأجر يجب
 * أن يمرّ عبر هذا الحارس: إن لم يوجد `TenantContext` صحيح، يُرفض الطلب (403)
 * **قبل** بلوغ أي استعلام — فلا يعتمد الأمان على السلوك المتساهل للـ Scope.
 *
 * حدود المسؤولية:
 *  - لا يُنشئ سياق المستأجر بنفسه؛ ذلك من اختصاص مصادقة مفتاح الـ API (PR-2)
 *    التي ستضبط `TenantContext` من مستأجر المفتاح ثم يأتي هذا الحارس بعدها.
 *  - في PR-1 لا يُطبَّق على أيّ مسار بيانات (لا توجد بعد)؛ إنه أساس إلزامي
 *    يجب أن يسبق أول مورد مستأجر في PR-3، مع اختبار fail-closed صريح.
 */
class PublicApiTenantGuard
{
    public function __construct(private TenantContext $tenant) {}

    public function handle(Request $request, Closure $next): Response
    {
        if (! $this->tenant->has()) {
            return PublicApiResponse::error(
                $request,
                PublicApiErrorCode::TENANT_CONTEXT_REQUIRED,
                'سياق المستأجر مطلوب للوصول إلى هذا المورد.',
                403,
            );
        }

        return $next($request);
    }
}
