<?php

namespace App\Http\Middleware;

use App\Services\TenantApplicationService;
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
    public function __construct(private TenantApplicationService $applications) {}

    public function handle(Request $request, Closure $next, string $key): Response
    {
        // اسم Middleware أو مفتاح App Guard الخاطئ لا يملك سلوكاً متسامحاً:
        // الرفض الموحّد لا يكشف إن كان الخطأ ناتجاً من كتالوج أو تهيئة مسار.
        if (! ApplicationCatalog::exists($key)) {
            abort(403, 'هذه القدرة غير متاحة لهذه المؤسسة.');
        }

        $status = $this->applications->statusFor($key);

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
