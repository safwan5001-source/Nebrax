<?php

namespace App\Services\Pos;

use RuntimeException;

/**
 * تعارض idempotency متوقّع: `client_event_id` أُعيد استخدامه بحمولة مختلفة عن
 * أول استخدام له. طبقة الـ HTTP تحوّله لاستجابة 409 — تعارض لا خطأ تحقق (422).
 */
class PosIdempotencyConflictException extends RuntimeException
{
}
