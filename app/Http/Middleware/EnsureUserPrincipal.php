<?php

namespace App\Http\Middleware;

use App\Models\User;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * يفرض أن المستفيد من الطلب **مستخدم أَوْج حقيقي** (جلسة داخلية عبر Sanctum)، لا
 * عميل Public API — حرِج للدمج (PR-7.5).
 *
 * مفاتيح الـ Public API توكنات Sanctum بـ tokenable = `ApiClient`. حارس `auth:sanctum`
 * يصادق أيّ توكن صالح ويجعل `$request->user()` هو الـ tokenable، فتوكن ApiClient
 * يمرّ المصادقة ويصبح `user()` كائن `ApiClient` (لا دور RBAC له). دون هذا الحارس
 * كان الاعتماد على أنّ `EnsurePermission` يرفض «بلا دور» ضمنيًّا — أمانٌ عرضيّ هشّ.
 *
 * هنا نرفض صراحةً: مسارات الإدارة الداخلية `/api/developer/*` تُحلّ مستخدمًا
 * (`User`) فقط. يوضع **قبل** `SetTenant` فلا يُشتقّ سياق مستأجر من عميل API.
 */
class EnsureUserPrincipal
{
    public function handle(Request $request, Closure $next): Response
    {
        if (! $request->user() instanceof User) {
            abort(403, 'هذا المسار مخصّص لمستخدمي أَوْج المصادَقين عبر الجلسة الداخلية.');
        }

        return $next($request);
    }
}
