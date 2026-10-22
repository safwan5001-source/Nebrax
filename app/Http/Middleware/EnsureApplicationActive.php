<?php

namespace App\Http\Middleware;

use App\Services\ApplicationOperationClassifier;
use App\Services\EntitlementCohortEnforcer;
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
        private EntitlementCohortEnforcer $cohortEnforcement,
    ) {}

    public function handle(Request $request, Closure $next, string $key): Response
    {
        $this->authorize($request, $key);

        return $next($request);
    }

    /**
     * يطبّق حارس القدرة على الطلب الحالي ويرمي 403 إن لم يُسمح — **المنطق الوحيد** لهذا الحارس.
     * يُستدعى من `handle()` للمسارات الثابتة، ومن خدمات تعرف مفتاح القدرة وقت التنفيذ لا وقت تعريف
     * المسار (مثل تشغيلات الاستيراد الدائم حيث يحدّد **مجال** التشغيلة القدرة). لا نسخة ثانية من
     * القواعد: الإنفاذ التجاري/المراقبة الظلية/رسائل الرفض كلها هنا.
     */
    public function authorize(Request $request, string $key): void
    {
        // اسم Middleware أو مفتاح App Guard الخاطئ لا يملك سلوكاً متسامحاً:
        // الرفض الموحّد لا يكشف إن كان الخطأ ناتجاً من كتالوج أو تهيئة مسار.
        $operation = $this->operations->classify($request);
        $this->cohortEnforcement->enforce($request, $key, $operation);

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
            return;
        }

        if ($status === 'suspended' && $request->isMethodSafe()) {
            return;
        }

        abort(403, $status === 'suspended'
            ? 'هذه القدرة معلّقة (قراءة فقط) — أعد تفعيلها لإجراء تغييرات جديدة.'
            : 'هذه القدرة غير مفعّلة لهذه المؤسسة.');
    }
}
