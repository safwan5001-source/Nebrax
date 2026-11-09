<?php

namespace App\Support;

use App\Models\FuelShiftSettlementJob;

/**
 * نتيجة تقييم مهمة تسوية وردية (P1-3b-1) — قيمة نقية. الأسباب رموز ثابتة غير مالية فقط (لا قيم ولا بيانات شخصية).
 *
 * `posted` (P1-3b-2d) لا يُبنى إلا من معالج المحرك بعد ترحيل (أو إعادة) ناجح؛ ويُسجَّل إنهاؤه **داخل معاملة الترحيل نفسها** فلا يمرّ بـ`record()` ثانيةً.
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

    /** تسوية الوردية رُحِّلت (أو وُجد ترحيلها السابق). المهمة تنتهي بالنتيجة نفسها. */
    public static function posted(): self
    {
        return new self(FuelShiftSettlementJob::OUTCOME_POSTED);
    }

    public function isFinal(): bool
    {
        return $this->outcome === FuelShiftSettlementJob::OUTCOME_DISABLED || $this->outcome === FuelShiftSettlementJob::OUTCOME_POSTED;
    }
}
