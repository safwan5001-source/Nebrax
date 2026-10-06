<?php

namespace App\Services\Commerce;

use RuntimeException;

/**
 * CUST-HV V2a — فشلٌ متوقَّع في مكتبة وسائط المُخصِّص، برمزٍ ثابتٍ تترجمه
 * الواجهة (`code`) ونصٍّ عربيٍّ احتياطي. لا يحمل أبداً مساراً/دلواً/مفتاحاً.
 */
final class StorefrontMediaException extends RuntimeException
{
    /** @param array<string,mixed> $context */
    public function __construct(
        public readonly string $errorCode,
        string $message,
        public readonly int $status = 422,
        public readonly array $context = [],
    ) {
        parent::__construct($message);
    }

    public static function storageNotEnabled(): self
    {
        return new self('storage_not_enabled', 'رفع الوسائط غير مفعّل لهذه البيئة بعد.', 503);
    }

    public static function storageUnavailable(): self
    {
        return new self('storage_unavailable', 'تعذّر الوصول إلى مخزن الوسائط الآن. أعد المحاولة بعد قليل.', 503);
    }
}
