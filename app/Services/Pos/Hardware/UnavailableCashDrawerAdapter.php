<?php

namespace App\Services\Pos\Hardware;

use App\Models\PosSession;

/** Driver آمن افتراضياً إلى أن يثبت موصل محلي مدعوم ومفوض في بيئة النشر. */
final class UnavailableCashDrawerAdapter implements CashDrawerAdapter
{
    public function open(PosSession $session, array $context): array
    {
        return [
            'status' => 'unsupported',
            'error_code' => 'cash_drawer_driver_unavailable',
        ];
    }
}
