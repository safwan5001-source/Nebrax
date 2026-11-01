<?php

namespace App\Services\AppBuilder;

use Exception;

/**
 * تعارض في تحريك المؤشر الحي (AD-06 / S05c) ⇒ 409 بجسم `{message, reason}`.
 * لا يرث `RuntimeException` عمداً (وإلا حوّله `ApiController::domain()` إلى 422)، كنمط `DraftRevisionConflictException`.
 *
 * الأسباب: `pointer_changed` (تحرّك المؤشر بين القراءة والقفل)، `no_rollback_target` (لا نسخة سابقة صالحة).
 */
final class LivePointerConflictException extends Exception
{
    public function __construct(public readonly string $reason, string $message)
    {
        parent::__construct($message);
    }
}
