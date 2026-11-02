<?php

namespace App\Events;

/**
 * أساس أحداث نطاق طلب المتجر (COPS-H1-2، ADR-29 §2.4).
 *
 * تُطلَق **بعد الالتزام فقط** (`DB::afterCommit` داخل `CommerceOrderEventRecorder`) وبمعرّفات حصراً — لا اسم ولا هاتف ولا بريد ولا مبلغ —
 * فالمستمع يقرأ ما يحتاجه بنفسه تحت سياق المستأجر. الأحداث إعلام لا مصدر حقيقة: مصدر الحقيقة صف `commerce_order_events` الملتزم
 * (والتغذية والمصالحة تستدركان أي فقد). مستمعوها **لا يرمون** (الطابور متزامن؛ فشل التنبيه لا يُفشل الطلب) والناشر يحمي المعاملة والاستجابة
 * من استثناء مستمع شاذ ويسجّله بالمعرّفات فقط.
 */
abstract class CommerceOrderDomainEvent
{
    public function __construct(
        public readonly string $tenantId,
        public readonly string $orderId,
        /** معرّف صف `commerce_order_events` الملتزم (UUID). */
        public readonly string $eventId,
    ) {}

    /** نوع صف السجل المقابل (`CommerceOrderEvent::TYPES`). */
    abstract public static function recordType(): string;
}
