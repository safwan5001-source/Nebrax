<?php

namespace App\Support;

use Illuminate\Http\JsonResponse;
use RuntimeException;

/**
 * ترحيل إشعار دائن مبيعات لمستأجر مفعَّل أثناء إيقاف المنصة الطارئ — REM-18b-3d (السياسة B). يُرمى قبل أي حجز في السلسلة ويتراجع
 * الترحيل كاملاً (لا قيد ولا ICV ولا posted)؛ يبقى الإشعار مسودة ويُعاد ترحيله يدوياً بعد رفع الإيقاف. رمز ثابت `platform_emergency_stop`
 * ورسالة بلا قيم. يُعرض 422 بجسم `{message, reason}` (ApiController::domain() يعيد رميه لتعمل render()).
 */
final class ZatcaCreditNoteEmergencyStopException extends RuntimeException
{
    public const REASON = 'platform_emergency_stop';

    public const MESSAGE_AR = 'الإصدار الإلكتروني للإشعارات الدائنة متوقف مؤقتاً. سيبقى الإشعار مسودة، ويمكن إعادة ترحيله بعد رفع الإيقاف.';

    public readonly string $reason;

    public function __construct()
    {
        parent::__construct(self::MESSAGE_AR);
        $this->reason = self::REASON;
    }

    public function render(): JsonResponse
    {
        return response()->json(['message' => self::MESSAGE_AR, 'reason' => self::REASON], 422);
    }
}
