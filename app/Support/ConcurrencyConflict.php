<?php

namespace App\Support;

use Illuminate\Database\DeadlockException;
use Illuminate\Database\QueryException;
use Illuminate\Http\JsonResponse;
use PDOException;
use Throwable;

/**
 * REM-04 / SEC-02 — عقد استجابة تعارض التزامن العابر على `POST /invoices/{id}/post` وحده.
 *
 * ضحية الجمود (SQLSTATE `40P01` deadlock_detected) أو فشل التسلسل (`40001`) ليست عطلاً:
 * المعاملة أُلغيت كاملةً (لا قيد ولا ICV ولا حركة مخزون) وإعادة الطلب نفسه آمنة. لذلك تُعاد
 * 503 + `Retry-After: 1` + رمز ثابت مقروء آلياً — لا 500، ولا 409 (الذي يحمل في هذا الـAPI
 * دلالات تعارض الحالة/idempotency). **لا يُستعمل من `ApiController::domain()` عمداً**: بقية
 * المسارات (POS، الوقود، المدفوعات، المشتريات…) خارج النطاق وتبقى على سلوكها السابق (500).
 *
 * لا يُعرض نص الاستثناء ولا SQL ولا رمز SQLSTATE في الجسم.
 */
final class ConcurrencyConflict
{
    public const ERROR_CODE = 'concurrency_conflict';

    public const RETRY_AFTER_SECONDS = 1;

    public const MESSAGE_AR = 'تعذّر إتمام العملية بسبب تعارض مؤقت مع عملية متزامنة. لم يُحفظ أي تغيير، أعد المحاولة بعد لحظة.';

    public const MESSAGE_EN = 'The operation could not be completed because of a temporary conflict with a concurrent operation. Nothing was saved; please try again in a moment.';

    /**
     * هل سببُ الاستثناء ضحيةُ جمود/تسلسل في قاعدة البيانات؟ حالتان فقط:
     * `40P01` و`40001` (أو `DeadlockException` الذي يلفّ بها Laravel الضحية داخل معاملة
     * متداخلة). أي خطأ قاعدة بيانات آخر — قيد فريد، اتصال، صياغة… — يبقى 500 كما كان.
     */
    public static function matches(Throwable $e): bool
    {
        for ($cause = $e; $cause !== null; $cause = $cause->getPrevious()) {
            if ($cause instanceof DeadlockException) {
                return true;
            }

            $state = $cause instanceof QueryException || $cause instanceof PDOException
                ? ($cause->errorInfo[0] ?? null)
                : null;
            if (in_array((string) ($state ?? $cause->getCode()), ['40P01', '40001'], true)) {
                return true;
            }
        }

        return false;
    }

    public static function response(): JsonResponse
    {
        return response()->json([
            'message'    => self::MESSAGE_AR,
            'message_en' => self::MESSAGE_EN,
            'error_code' => self::ERROR_CODE,
        ], 503, ['Retry-After' => (string) self::RETRY_AFTER_SECONDS]);
    }
}
