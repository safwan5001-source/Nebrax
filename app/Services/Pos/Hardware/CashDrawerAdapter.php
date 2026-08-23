<?php

namespace App\Services\Pos\Hardware;

use App\Models\PosSession;

/**
 * عقد موصل درج نقدية محلي. لا ينفذ Driver المادي داخل React أو داخل مسار المحاسبة.
 * الموصل المدعوم مستقبلاً مسؤول عن نبضة ESC/POS أو تكامل محلي مكافئ فقط.
 */
interface CashDrawerAdapter
{
    /** @return array{status:'opened'|'unsupported'|'not_configured'|'failed',error_code:?string} */
    public function open(PosSession $session, array $context): array;
}
