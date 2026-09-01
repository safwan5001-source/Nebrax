<?php

namespace App\Http\Middleware;

use App\Support\PublicApiResponse;
use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Str;
use Symfony\Component\HttpFoundation\Response;

/**
 * أساس معرّف الطلب (Correlation / Request ID) لكل طلب Public API (v1).
 * مطبَّق على مجموعة /api/v1 وحدها، فلا يمسّ الـ Internal API إطلاقًا.
 *
 *  - يقبل ترويسة `X-Request-Id` من العميل **بعد التحقق من نمطها الآمن** (طول
 *    محدود ومحارف URL-safe)، وإلا يولّد UUID. لا يوثَق بقيمة غير محدودة.
 *  - يثبّته على الطلب (لأجل meta.request_id) ويعيده في ترويسة الاستجابة، نجاحًا
 *    أو خطأً — الأخطاء يشكّلها PublicApiExceptionRenderer الذي يقرأ المعرّف نفسه.
 *
 * لا يبني هذا الوسيط audit logging كاملًا (مرحلة لاحقة)؛ يكتفي بأساس المعرّف
 * ليكون متاحًا للـ observability مستقبلًا.
 */
class PublicApiRequestContext
{
    /** نمط آمن لمعرّف طلب واردٍ من العميل: طول محدود ومحارف URL-safe فقط. */
    private const CLIENT_REQUEST_ID_PATTERN = '/^[A-Za-z0-9._-]{8,128}$/';

    public function handle(Request $request, Closure $next): Response
    {
        $requestId = $this->resolveRequestId($request);
        $request->attributes->set(PublicApiResponse::REQUEST_ID_ATTRIBUTE, $requestId);

        $response = $next($request);
        $response->headers->set('X-Request-Id', $requestId);

        return $response;
    }

    /** معرّف الطلب: قيمة العميل الموثوقة إن صحّ نمطها، وإلا UUID جديد. */
    private function resolveRequestId(Request $request): string
    {
        $incoming = (string) $request->headers->get('X-Request-Id', '');

        if ($incoming !== '' && preg_match(self::CLIENT_REQUEST_ID_PATTERN, $incoming) === 1) {
            return $incoming;
        }

        return (string) Str::uuid();
    }
}
