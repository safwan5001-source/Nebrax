<?php

namespace App\Support;

/**
 * رموز أخطاء ثابتة (machine-readable) لعقد الـ Public API (v1).
 *
 * القيمة النصّية جزء من العقد العام: **لا تُغيَّر بعد نشرها** لأن المستهلكين
 * الخارجيين يبرمجون عليها. الرسالة البشرية منفصلة وقابلة للتغيير؛ الرمز وحده
 * مستقر. هذا العقد مستقل تمامًا عن أخطاء الـ Internal API (لا يُعاد تشكيلها).
 *
 * المجموعة هنا هي الأساس؛ تُضاف رموز جديدة لاحقًا (مصادقة/scopes/idempotency/
 * rate-limit) دون كسر المستقر منها.
 */
enum PublicApiErrorCode: string
{
    case INTERNAL_ERROR          = 'internal_error';
    case BAD_REQUEST             = 'bad_request';
    case NOT_FOUND               = 'not_found';
    case METHOD_NOT_ALLOWED      = 'method_not_allowed';
    case VALIDATION_FAILED       = 'validation_failed';
    case UNAUTHENTICATED         = 'unauthenticated';
    case FORBIDDEN               = 'forbidden';
    case TENANT_CONTEXT_REQUIRED = 'tenant_context_required';
    case CLIENT_INACTIVE         = 'client_inactive';
    case INSUFFICIENT_SCOPE      = 'insufficient_scope';
    case RATE_LIMITED            = 'rate_limited';

    /** رمز HTTP الافتراضي لكل رمز خطأ — مرجع واحد يمنع التضارب بين المسارات. */
    public function defaultHttpStatus(): int
    {
        return match ($this) {
            self::BAD_REQUEST             => 400,
            self::UNAUTHENTICATED        => 401,
            self::FORBIDDEN,
            self::TENANT_CONTEXT_REQUIRED,
            self::CLIENT_INACTIVE,
            self::INSUFFICIENT_SCOPE     => 403,
            self::NOT_FOUND              => 404,
            self::METHOD_NOT_ALLOWED     => 405,
            self::VALIDATION_FAILED      => 422,
            self::RATE_LIMITED           => 429,
            self::INTERNAL_ERROR         => 500,
        };
    }
}
