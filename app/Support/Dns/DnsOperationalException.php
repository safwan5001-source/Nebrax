<?php

namespace App\Support\Dns;

use RuntimeException;

/**
 * فشلٌ تشغيلي في استعلام DNS (محلّل/شبكة/وقت تشغيل) — **ليس** إثباتاً أن
 * التاجر لا يملك النطاق. `StorefrontDomainVerificationService::verify()`
 * يترجمها إلى `DomainVerificationResult::operationalFailure()`، ولا يُسقِط
 * `verification_status` أبداً ولا يمسّ `verification_token` — القرار §23-B.
 */
final class DnsOperationalException extends RuntimeException
{
}
