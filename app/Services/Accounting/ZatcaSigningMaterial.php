<?php

namespace App\Services\Accounting;

/** مادة توقيع مفكوكة التشفير تبقى داخل طبقة الخادم ولا تُعاد عبر API. */
final class ZatcaSigningMaterial
{
    /** @param list<string> $certificateChain شهادات DER بترميز Base64، leaf أولاً */
    public function __construct(
        public readonly string $environment,
        public readonly string $stage,
        public readonly string $privateKey,
        public readonly array $certificateChain,
    ) {
    }
}
