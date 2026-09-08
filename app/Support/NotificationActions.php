<?php

namespace App\Support;

/** Server allowlist for notification navigation. Source authorization is rechecked on open. */
final class NotificationActions
{
    /** action => required source_type */
    public const ALLOWED = [
        'view_product' => 'product',
        'view_financial_alert' => 'financial_control_alert',
        'view_zatca_submission' => 'invoice',
        // PR-NOTIF-5
        'view_receivable_invoice' => 'invoice',
        'view_pos_session' => 'pos_session',
    ];
}
