<?php

namespace App\Support;

use DomainException;

/**
 * رفض عمل على تعديل مزوّد البوابة (PAY-H3-02c) برمز `reason` ثابت تترجمه الواجهة.
 *
 * الرموز: forbidden · rollout_disabled · gateway_not_found · adjustment_not_found · invalid_kind · invalid_amount · reason_required ·
 * evidence_required · duplicate_event · invalid_state · self_approval · reserve_insufficient.
 */
final class GatewayAdjustmentException extends DomainException
{
    public function __construct(public readonly string $reason, string $message, ?\Throwable $previous = null)
    {
        parent::__construct($message, 0, $previous);
    }
}
