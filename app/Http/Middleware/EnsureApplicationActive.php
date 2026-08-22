<?php

namespace App\Http\Middleware;

use App\Services\ApplicationOperationClassifier;
use App\Services\EntitlementShadowEvaluator;
use App\Services\TenantApplicationService;
use App\Support\ApplicationAccessReason;
use App\Support\ApplicationAccessResult;
use App\Support\ApplicationCatalog;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * يفرض حالة تفعيل القدرة (`TenantApplicationService`) على مسارات وحدتها.
 * `enabled` تمرّ بلا قيد. `suspended` (بيانات حقيقية أوقفها المستأجر) تسمح
 * بالقراءة فقط — GET/HEAD — فتبقى التقارير والمراجع والمستندات التاريخية
 * متاحة كما يصف تصميم P2. `disabled` تمنع كل الطلبات.
 *
 * الاستخدام: ->middleware(EnsureApplicationActive::class.':hr.employees')
 */
class EnsureApplicationActive
{
    public function __construct(
        private TenantApplicationService $applications,
        private ApplicationOperationClassifier $operations,
        private EntitlementShadowEvaluator $shadow,
    ) {}

    public function handle(Request $request, Closure $next, string $key): Response
    {
        // اسم Middleware أو مفتاح App Guard الخاطئ لا يملك سلوكاً متسامحاً:
        // الرفض الموحّد لا يكشف إن كان الخطأ ناتجاً من كتالوج أو تهيئة مسار.
        $operation = $this->operations->classify($request);
        if (! ApplicationCatalog::exists($key)) {
            $this->shadow->observe($request, $key, $operation, ApplicationAccessResult::denied(ApplicationAccessReason::UNKNOWN_CAPABILITY));
            abort(403, 'هذه القدرة غير متاحة لهذه المؤسسة.');
        }

        $status = $this->applications->statusFor($key);
        $legacy = match (true) {
            $status === 'enabled' => ApplicationAccessResult::allowed(),
            $status === 'suspended' && $request->isMethodSafe() => ApplicationAccessResult::readOnly(ApplicationAccessReason::APPLICATION_SUSPENDED_READ_ONLY),
            default => ApplicationAccessResult::denied(ApplicationAccessReason::APPLICATION_DISABLED),
        };
        $this->shadow->observe($request, $key, $operation, $legacy);

        if ($status === 'enabled') {
            return $next($request);
        }

        if ($status === 'suspended' && $request->isMethodSafe()) {
            return $next($request);
        }

        abort(403, $status === 'suspended'
            ? 'هذه القدرة معلّقة (قراءة فقط) — أعد تفعيلها لإجراء تغييرات جديدة.'
            : 'هذه القدرة غير مفعّلة لهذه المؤسسة.');
    }
}
