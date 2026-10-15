<?php

namespace App\Services\Communications;

use App\Support\Communications\MessageIntent;
use App\Support\Communications\RequestCanonicalizer;

/**
 * AWJ-COMMS-02-B — بصمة الطلب = HMAC(مفتاح مشتق للمستأجر والإصدار، التمثيل القياسي v1). لا تُسجَّل ولا تُعرض.
 * التحقق يُعاد بإصدار **الصف المخزَّن** لا النشط: التدوير لا يُنتج تعارضاً كاذباً.
 */
final class RequestFingerprinter
{
    public function __construct(private readonly HmacKeyring $keyring)
    {
    }

    /** @return array{0: string, 1: int} [بصمة، إصدار المفتاح النشط] */
    public function fingerprintForNewMessage(MessageIntent $intent): array
    {
        $version = $this->keyring->activeVersion();

        return [$this->keyring->fingerprint($intent->tenantId, $version, RequestCanonicalizer::canonicalize($intent)), $version];
    }

    public function matches(MessageIntent $intent, int $storedVersion, string $storedFingerprint): bool
    {
        $expected = $this->keyring->fingerprint($intent->tenantId, $storedVersion, RequestCanonicalizer::canonicalize($intent));

        return hash_equals($expected, $storedFingerprint);
    }
}
