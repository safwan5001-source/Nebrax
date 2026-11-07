<?php

namespace App\Support;

use Illuminate\Http\JsonResponse;
use RuntimeException;

/**
 * CUR-1 — محاولة تغيير عملة المؤسسة بعد وجود قيود محاسبية مرحّلة. 422 برمز ثابت `company_currency_locked`
 * وجسم `{message, reason, errors:{currency:[…]}}`؛ لا قيم مالية ولا أرقام قيود في الرسالة. يُرمى داخل معاملة
 * `PUT /company` فيتراجع كل شيء (لا حفظ جزئي لبقية حقول الشركة).
 */
final class CompanyCurrencyLockedException extends RuntimeException
{
    public const REASON = 'company_currency_locked';

    public const MESSAGE_AR = 'لا يمكن تغيير عملة المؤسسة بعد ترحيل قيود محاسبية. القيم المخزّنة تُفسَّر بعملتها الحالية.';

    public readonly string $reason;

    public function __construct()
    {
        parent::__construct(self::MESSAGE_AR);
        $this->reason = self::REASON;
    }

    public function render(): JsonResponse
    {
        return response()->json([
            'message' => self::MESSAGE_AR,
            'reason'  => self::REASON,
            'errors'  => ['currency' => [self::MESSAGE_AR]],
        ], 422);
    }
}
