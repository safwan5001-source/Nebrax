<?php

namespace App\Services;

use Exception;
use Illuminate\Http\JsonResponse;

/**
 * رفض ترحيل رصيد وقود افتتاحي بسبب مانع أو أكثر (مجمّع غير فارغ، تاريخ حركة، تكلفة ناقصة، حساب غير معيَّن…).
 * لا يرث RuntimeException عمداً: `ApiController::domain()` كان سيحوّله إلى 422 عام بلا موانع. يرسم نفسه 422 بجسم
 * `{message, reason: "opening_blocked", blockers:[{code,message,...}]}` ويتراجع كل شيء قبله.
 */
class FuelOpeningBalanceBlockedException extends Exception
{
    /** @param list<array{code:string,message:string}> $blockers */
    public function __construct(public readonly array $blockers)
    {
        $first = $blockers[0] ?? ['code' => 'FUEL_OPENING_BLOCKED', 'message' => 'تعذّر ترحيل الرصيد الافتتاحي للوقود.'];
        parent::__construct($first['code'] . ': ' . $first['message']);
    }

    public function render(): JsonResponse
    {
        return response()->json([
            'message' => $this->getMessage(),
            'reason' => 'opening_blocked',
            'blockers' => $this->blockers,
        ], 422);
    }
}
