<?php

namespace App\Services\Commerce;

use RuntimeException;

/**
 * COPS-H2-1 (AR-2) — يمنع إلغاء التزام دفع طلب تنفيذه في النقل أو مكتمل. يرميه الكاتب الوحيد لحالة `cancelled` على النية
 * (`CommercePaymentIntentService::cancelWithinTransaction`) فيغطي كل مسارات الإلغاء (المسار القديم بوابة مغلقة/مفتوحة، المكنسة، `cancel()` المباشر).
 * يرث `RuntimeException` ليبقى سلوك المستدعين القدماء (422 / تخطّي المكنسة) — لكن {@see CommerceOrderLifecycleService} يحوّله إلى رمز مصفوفة
 * الإلغاء الصحيح ولا يعيد تسميته `payment_captured`.
 */
final class CommerceOrderFulfillmentLockedException extends RuntimeException
{
    public const IN_TRANSIT = 'fulfillment_in_transit';

    public const COMPLETED = 'fulfillment_completed';

    public function __construct(public readonly string $reason, string $message)
    {
        parent::__construct($message);
    }
}
