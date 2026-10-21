<?php

namespace App\Services\Accounting;

/**
 * خانة محجوزة في سلسلة ZATCA المشتركة — REM-18b-2. قيمة ثابتة يعيدها `ZatcaChainAllocator::reserve()` تحت قفل رأس السلسلة
 * وتُستهلك بـ`record()` في المعاملة نفسها. لا تُخزَّن ولا تعبر حدود معاملة: الخانة غير المسجَّلة لا تستهلك ICV (تتراجع
 * مع المعاملة، ورأس السلسلة لا يتقدّم إلا بإدراج المدخل — مُشغّل T4).
 */
final class ZatcaChainSlot
{
    public function __construct(
        public readonly string $chainId,
        public readonly string $tenantId,
        public readonly int $icv,
        public readonly string $previousHash,
    ) {}
}
