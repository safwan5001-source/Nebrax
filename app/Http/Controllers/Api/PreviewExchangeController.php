<?php

namespace App\Http\Controllers\Api;

use App\Http\Resources\PreviewSessionResource;
use App\Services\AppBuilder\PreviewExchangeService;
use App\Support\PublicApiErrorCode;
use App\Support\PublicApiResponse;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * ═══════════════════════════════════════════════════════════════
 *  `POST /preview/v1/exchange` — تبادل مرجع لمرّة واحدة (MOBILE-PREVIEW-7)
 * ═══════════════════════════════════════════════════════════════
 *
 * نقطة عامة **بلا أي مصادقة مسبقة** — الجهاز الماسح لم يحمل بعد أي بصمة —
 * تقبل حصراً `{reference}` في جسم الطلب (لا رابط استعلام، §5.10)، وتستهلكه
 * ذرّياً عبر `PreviewExchangeService::consume()` (قفل + معاملة، §8 من المهمة).
 *
 * **لا تمييز بين مجهول/منتهٍ/مستهلَك/تطبيق أو مستأجر معطَّل** — نفس استجابة
 * `AuthenticatePreviewSession` العامة تماماً (§5.15)؛ الفرق يبقى فقط في
 * `preview_session_events` الداخلي (`reason` مسبوق بـ`exchange_`).
 *
 * **لا معامل مستأجر/تطبيق يُقرأ من الطلب هنا إطلاقاً** — نطاق النتيجة يُشتقّ
 * حصراً من صفّ المرجع نفسه (E6/BOLA، مطابقاً لِـ`preview/v1/experience`).
 */
class PreviewExchangeController extends PublicApiController
{
    public function __construct(private readonly PreviewExchangeService $service) {}

    public function store(Request $request): JsonResponse
    {
        // شكل مرفوض قبل أي استعلام قاعدة بيانات — **نفس** استجابة الرفض
        // العامة أدناه بالضبط (§5.15: "malformed input is rejected on
        // format/length before any DB lookup", لا استجابة تحقّق مميِّزة).
        $reference = $request->string('reference')->toString();
        $result = ($reference === '' || strlen($reference) > 128)
            ? null
            : $this->service->consume($reference);

        if ($result === null) {
            return PublicApiResponse::error(
                $request, PublicApiErrorCode::UNAUTHENTICATED, 'هذا الرمز لم يعد صالحاً.', 401,
            );
        }

        return response()->json([
            // النصّ الصريح لجلسة المعاينة الفعلية — لمرّة واحدة، تماماً كإصدارها المباشر.
            'token' => $result['token']->plainTextToken,
            'session' => (new PreviewSessionResource($result['session']))->resolve($request),
        ], 201);
    }
}
