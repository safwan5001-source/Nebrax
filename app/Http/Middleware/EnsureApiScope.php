<?php

namespace App\Http\Middleware;

use App\Support\PublicApiErrorCode;
use App\Support\PublicApiResponse;
use App\Support\PublicApiScope;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * يفرض امتلاك مفتاح الـ API لـ scope المطلوب — **مطابقة تامّة** لا wildcard ولا
 * substring. يعمل بعد `AuthenticateApiClient` في السلسلة.
 *
 *  - scope المطلوب في المسار يجب أن يكون معروفًا (وإلا فهو خطأ تهيئة → رفض مغلق).
 *  - غياب العميل/التوكن (لم تُجرَ المصادقة) → لا صلاحيات → رفض مغلق.
 *  - `*` أو أي قيمة غير مُدرَجة صراحةً في صلاحيات المفتاح لا تمنح الوصول (تقييد
 *    الـ wildcard: لا نستعمل توسيع Sanctum لـ `*`، بل عضويةً تامّة في القائمة).
 *
 * الاستخدام: ->middleware(EnsureApiScope::class.':partners:read')
 */
class EnsureApiScope
{
    public function handle(Request $request, Closure $next, string $scope): Response
    {
        if (! PublicApiScope::isKnown($scope)) {
            return $this->deny($request);
        }

        $token = $request->user()?->currentAccessToken();
        $granted = $token !== null ? (array) $token->abilities : [];

        if (! in_array($scope, $granted, true)) {
            return $this->deny($request);
        }

        return $next($request);
    }

    private function deny(Request $request): Response
    {
        return PublicApiResponse::error(
            $request, PublicApiErrorCode::INSUFFICIENT_SCOPE, 'المفتاح لا يملك الصلاحية (scope) المطلوبة.', 403,
        );
    }
}
