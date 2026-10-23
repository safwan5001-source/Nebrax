<?php

namespace App\Support;

use DomainException;

/**
 * رفض عمل على استرداد البوابة (PAY-H3-01b) برمز `reason` ثابت تترجمه الواجهة (يعاد 422 بجسم `{message, reason}` في طبقة الـAPI).
 *
 * الرموز: forbidden · rollout_disabled · platform_stop · invalid_idempotency_key · idempotency_conflict · invalid_amount · invalid_allocations ·
 * attempt_not_found · not_captured · capture_not_posted · not_refundable · dispute_active · unrecognized_refund_open · gateway_unavailable ·
 * refunds_unsupported · currency_mismatch · partner_mismatch · source_ineligible · source_branch_mismatch · capture_branch_mismatch ·
 * branch_context_mismatch · exceeds_source_balance · exceeds_payment_capacity · refund_not_found · invalid_state · self_approval · busy ·
 * provider_unavailable · reason_required · evidence_missing · no_unrecognized_refund · baseline_regressed.
 */
final class PaymentRefundException extends DomainException
{
    public function __construct(public readonly string $reason, string $message, ?\Throwable $previous = null)
    {
        parent::__construct($message, 0, $previous);
    }
}
