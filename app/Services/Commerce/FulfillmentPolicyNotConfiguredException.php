<?php

namespace App\Services\Commerce;

use RuntimeException;

/**
 * القناة موجودة وسليمة تجاه المستأجر، لكن لا مصدر تنفيذ صالحاً يمكن حسمه
 * لها الآن — بلا سياسة أصلاً، أو القناة معطّلة، أو مخزن السياسة معطّل.
 * لا fallback صامت لأيٍّ من هذه الحالات؛ الاستدعاء يفشل صراحةً بدلاً من
 * تخمين مخزنٍ افتراضي أو أول مخزن.
 */
class FulfillmentPolicyNotConfiguredException extends RuntimeException
{
}
