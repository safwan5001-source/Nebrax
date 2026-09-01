<?php

namespace App\Support;

use Illuminate\Auth\AuthenticationException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\ValidationException;
use Symfony\Component\HttpKernel\Exception\HttpExceptionInterface;
use Throwable;

/**
 * يحوّل أي استثناء يقع على مسار Public API (v1) إلى مغلّف الخطأ الموحّد.
 *
 * يُسجَّل كـ renderable callback في PublicApiServiceProvider **محصورًا في
 * `api/v1/*`**، فلا يمسّ معالجة أخطاء الـ Internal API إطلاقًا. لا يسرّب أيّ
 * stack trace أو تفاصيل داخلية؛ الأخطاء غير المتوقعة (5xx) تُسجَّل خادميًا
 * عبر المعالج الافتراضي (report) وتُعاد رسالة عامّة فقط.
 *
 * يُطبَّق أيضًا على الطلبات التي لم يمرّ عليها الوسيط (مثل 404 لمسار غير مطابق
 * تحت /api/v1) — فيبقى العقد موحّدًا حتى لتلك الحالات.
 */
class PublicApiExceptionRenderer
{
    public static function render(Throwable $e, Request $request): JsonResponse
    {
        $response = match (true) {
            $e instanceof ValidationException => PublicApiResponse::error(
                $request, PublicApiErrorCode::VALIDATION_FAILED, 'المدخلات غير صالحة.', 422, $e->errors(),
            ),
            $e instanceof AuthenticationException => PublicApiResponse::error(
                $request, PublicApiErrorCode::UNAUTHENTICATED, 'يتطلب هذا الطلب مصادقة صحيحة.', 401,
            ),
            $e instanceof HttpExceptionInterface => PublicApiResponse::error(
                $request,
                self::codeForStatus($e->getStatusCode()),
                self::messageForStatus($e->getStatusCode(), $e->getMessage()),
                $e->getStatusCode(),
            ),
            default => PublicApiResponse::error(
                $request, PublicApiErrorCode::INTERNAL_ERROR, 'حدث خطأ غير متوقع.', 500,
            ),
        };

        $response->headers->set('X-Request-Id', PublicApiResponse::requestId($request));

        return $response;
    }

    private static function codeForStatus(int $status): PublicApiErrorCode
    {
        return match ($status) {
            401 => PublicApiErrorCode::UNAUTHENTICATED,
            403 => PublicApiErrorCode::FORBIDDEN,
            404 => PublicApiErrorCode::NOT_FOUND,
            405 => PublicApiErrorCode::METHOD_NOT_ALLOWED,
            422 => PublicApiErrorCode::VALIDATION_FAILED,
            429 => PublicApiErrorCode::RATE_LIMITED,
            default => $status >= 500
                ? PublicApiErrorCode::INTERNAL_ERROR
                : PublicApiErrorCode::BAD_REQUEST,
        };
    }

    /** رسالة آمنة: رسالة الاستثناء لأخطاء العميل (<500) إن وُجدت، وإلا عامّة. */
    private static function messageForStatus(int $status, string $message): string
    {
        if ($status < 500 && trim($message) !== '') {
            return $message;
        }

        return $status >= 500 ? 'حدث خطأ غير متوقع.' : 'تعذّر إتمام الطلب.';
    }
}
