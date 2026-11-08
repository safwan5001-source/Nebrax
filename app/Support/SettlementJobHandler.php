<?php

namespace App\Support;

use App\Models\FuelShiftSettlementJob;

/**
 * عقد معالج مهمة التسوية (P1-3b-1). المنفّذ الوحيد الآن `FuelShiftSettlementPrecheckHandler` (قراءة فقط، لا مستند ولا قيد).
 * محرك الترحيل يحلّ محله في P1-3b-3 بموافقة جديدة. أي استثناء يُعالَج بإعادة المحاولة (الإيجار والحاجز في الخدمة).
 */
interface SettlementJobHandler
{
    public function handle(FuelShiftSettlementJob $job): SettlementJobOutcome;
}
