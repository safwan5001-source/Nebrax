<?php

namespace App\Services\Accounting;

/** بيانات مصادقة النقل المفكوكة تبقى داخل الخادم ولا تُسجّل أو تُعاد عبر API. */
final class ZatcaTransportCredential
{
    public function __construct(
        public readonly string $environment,
        public readonly string $csid,
        public readonly string $secret,
    ) {
    }
}
