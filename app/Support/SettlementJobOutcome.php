<?php

namespace App\Support;

use App\Models\FuelShiftSettlementJob;

/**
 * نتيجة تقييم مهمة تسوية وردية (P1-3b-1) — قيمة نقية. الأسباب رموز ثابتة غير مالية فقط (لا قيم ولا بيانات شخصية).
 *
 * لا يوجد فرع «تم الترحيل» قابل للبناء من هنا: محرك الترحيل P1-3b-2 يضيفه بموافقة جديدة (والثابت `OUTCOME_POSTED` محجوز في النموذج).
 */
final class SettlementJobOutcome
{
    /** @param list<string> $reasons */
    private function __construct(public readonly string $outcome, public readonly array $reasons = []) {}

    /** @param list<string> $reasons */
    public static function blocked(array $reasons): self
    {
        $reasons = array_values(array_unique($reasons));
        sort($reasons);

        return new self(FuelShiftSettlementJob::OUTCOME_BLOCKED, $reasons);
    }

    /** اجتازت كل الفحوص المتاحة؛ لا محرك ترحيل بعد فتبقى معلقة. */
    public static function awaitingEngine(): self
    {
        return new self(FuelShiftSettlementJob::OUTCOME_AWAITING_ENGINE);
    }

    /** البوابة أو السياسة أُغلقت بعد التسجيل ⇒ لا عمل (المهمة تنتهي بلا أثر). */
    public static function disabled(): self
    {
        return new self(FuelShiftSettlementJob::OUTCOME_DISABLED);
    }

    public function isFinal(): bool
    {
        return $this->outcome === FuelShiftSettlementJob::OUTCOME_DISABLED;
    }
}
