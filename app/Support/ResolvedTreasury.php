<?php

namespace App\Support;

use App\Models\CashBankAccount;

/**
 * نتيجة `TreasurySelectionResolver` (TREASURY-T3): خزينة/حساب بنكي **تحقّق** المحلِّل من ملكيته وحالته وحسابه الدفتري.
 * قيمة للقراءة فقط؛ لا تُنشئ قيداً ولا تغيّر حالة. `accountId` هو حساب الأستاذ الذي يُرحَّل عليه — الوحيد المسموح به لمستدعٍ.
 */
final class ResolvedTreasury
{
    public function __construct(
        public readonly CashBankAccount $entity,
        public readonly string $entityId,
        public readonly string $accountId,
        public readonly string $type,
        public readonly string $name,
        public readonly string $currency,
        /** هل جاء من السياسة الافتراضية (لا اختيار صريح)؟ */
        public readonly bool $viaDefault,
    ) {}
}
