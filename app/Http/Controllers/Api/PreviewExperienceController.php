<?php

namespace App\Http\Controllers\Api;

use App\Models\PreviewSession;
use App\Services\AppBuilder\PreviewSessionService;
use App\Support\PublicApiResponse;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * ═══════════════════════════════════════════════════════════════
 *  لقطة تجربة المعاينة المجمَّدة — Preview API V1 (MOBILE-PREVIEW-6)
 * ═══════════════════════════════════════════════════════════════
 *
 * نقطة القراءة الوحيدة التي يستهلكها الجوّال الحقيقي عبر `PreviewClient`
 * لمعاينة مسودة App Builder — **خارج `commerce/v1` تماماً** (لا يحمل توكن
 * جلسة المعاينة أي علاقة بالتوكن التجاري/`ApiClient`؛ §2.5/§11 من وثيقة
 * معمارية MP-5). المصادقة عبر `AuthenticatePreviewSession` وحدها؛ لا معرّف
 * مستأجر/تطبيق يُقرأ من الطلب هنا إطلاقاً — كلاهما من صفّ الجلسة المصادَقة
 * حصراً (E6: لا معامل BOLA قابل للتلاعب أصلاً).
 *
 * لا فرق شكلي بين "منتهية"/"مبطَلة"/"مجهولة" عند هذه النقطة أو قبلها —
 * `AuthenticatePreviewSession` يرفض الثلاثة بنفس الاستجابة العامة قبل بلوغ
 * هذا المتحكّم إطلاقاً (§5.15).
 */
class PreviewExperienceController extends PublicApiController
{
    public function show(Request $request, PreviewSessionService $service): JsonResponse
    {
        /** @var PreviewSession $session */
        $session = $request->user();

        return PublicApiResponse::success($request, $service->readExperience($session));
    }
}
