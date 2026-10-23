<?php

namespace App\Support;

use DomainException;

/**
 * رفض عملية تنسيق دفع برمز ثابت (`reason`) تترجمه الواجهة. بلا أسرار ولا قيم مزوّد في الرسالة.
 *
 * الرموز: rollout_disabled · platform_stop · forbidden · invalid_idempotency_key · idempotency_conflict · gateway_unavailable · gateway_unverified ·
 * adapter_unavailable · invalid_payable · invalid_snapshot · nothing_due · currency_unsupported · amount_below_minimum · active_attempt_exists · provider_unavailable · attempt_not_found ·
 * not_started · provider_reference_mismatch · cannot_cancel · provider_unresolved · payable_changed.
 */
final class PaymentOrchestrationException extends DomainException
{
    public function __construct(public readonly string $reason, string $message, ?\Throwable $previous = null)
    {
        parent::__construct($message, 0, $previous);
    }
}
