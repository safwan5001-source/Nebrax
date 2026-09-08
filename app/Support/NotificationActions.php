<?php

namespace App\Support;

/**
 * ═══════════════════════════════════════════════════════════════
 *  قائمة إجراءات الإشعار المصرَّح بها — الخادم مصدر الحقيقة الوحيد
 * ═══════════════════════════════════════════════════════════════
 *  إشعار قد يشير إلى مصدر، لكن فتحه يمرّ دوماً على تفويض المصدر نفسه من
 *  جديد؛ هذه القائمة تمنع فقط أن يحمل الإشعار إجراءً حرّاً (رابطاً خارجياً
 *  أو أمر واجهة اختُرع وقت الإنتاج) — لا تُستخدم كبديل عن تفويض المصدر.
 */
final class NotificationActions
{
    /** action => source_type المطلوب لهذا الإجراء. */
    public const ALLOWED = [
        'view_product' => 'product',
        'view_financial_alert' => 'financial_control_alert',
        'view_zatca_submission' => 'invoice',
        // PR-NOTIF-5: الاستحقاق يفتح الفاتورة، وحدث POS يفتح الجلسة؛ كلا المسارين يعيد التفويض.
        'view_receivable_invoice' => 'invoice',
        'view_pos_session' => 'pos_session',
    ];
}
