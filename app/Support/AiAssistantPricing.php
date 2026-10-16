<?php

namespace App\Support;

/**
 * جدول أسعار المساعد الذكي وتقدير الحجز (AI-02A). عدد صحيح دائماً: رموز، وmicro-USD (1/1,000,000
 * دولار) — ممنوع float. مزوّد/نموذج بلا سعر = `null` (يرفضه الاستدعاء) لا «مجاني».
 */
final class AiAssistantPricing
{
    /** تكلفة ثابتة تقديرية لتغليف الطلب (system prompt وغيره) تُضاف لتقدير الإدخال. */
    private const INPUT_OVERHEAD_TOKENS = 64;

    /**
     * @return array{billable:bool, input_micro_usd_per_1k:int, output_micro_usd_per_1k:int}|null
     */
    public static function profile(string $provider, string $model): ?array
    {
        $entry = (config('ai_assistant.pricing')[$provider] ?? [])[$model] ?? null;
        if (! is_array($entry)
            || ! is_int($entry['input_micro_usd_per_1k'] ?? null) || $entry['input_micro_usd_per_1k'] < 0
            || ! is_int($entry['output_micro_usd_per_1k'] ?? null) || $entry['output_micro_usd_per_1k'] < 0) {
            return null;
        }

        return [
            // الإعفاء من القياس المالي للمزوّد التجريبي وحده؛ أي مزوّد آخر دائماً قابل للفوترة.
            'billable' => $provider === 'mock' ? (bool) ($entry['billable'] ?? true) : true,
            'input_micro_usd_per_1k' => $entry['input_micro_usd_per_1k'],
            'output_micro_usd_per_1k' => $entry['output_micro_usd_per_1k'],
        ];
    }

    /** @param array{input_micro_usd_per_1k:int, output_micro_usd_per_1k:int} $profile */
    public static function costMicroUsd(array $profile, int $inputTokens, int $outputTokens): int
    {
        // تقريب لأعلى لكل جانب: التكلفة لا تُقدَّر بأقل من الحقيقة أبداً.
        return intdiv(max(0, $inputTokens) * $profile['input_micro_usd_per_1k'] + 999, 1000)
            + intdiv(max(0, $outputTokens) * $profile['output_micro_usd_per_1k'] + 999, 1000);
    }

    /** تقدير متحفظ (رمز لكل 3 بايت) — يُبالغ عمداً كي لا يقلّ الحجز عن الفعلي. */
    public static function estimateInputTokens(string $message): int
    {
        return intdiv(strlen($message) + 2, 3) + self::INPUT_OVERHEAD_TOKENS;
    }
}
