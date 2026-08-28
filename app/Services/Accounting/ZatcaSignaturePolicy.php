<?php

namespace App\Services\Accounting;

/** سياسة توقيع مثبتة من إعدادات النشر؛ لا تحمل أسراراً ولا تقبل افتراضات. */
final class ZatcaSignaturePolicy
{
    public function __construct(
        public readonly string $identifier,
        public readonly string $digest,
    ) {}
}
