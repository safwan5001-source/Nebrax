<?php

namespace App\Services\DocumentCenter;

use App\Models\AiRequest;
use App\Services\AiRequestLedger;
use App\Support\AiAssistantDenied;
use App\Support\AiAssistantPricing;
use Illuminate\Support\Str;

/**
 * قياس استخراج المستندات ضمن **ميزانية الذكاء الاصطناعي نفسها** (AI-07) — سياسة اختيارية تُضبط ولا تُفرَض:
 * `ai_assistant.budget.meter_document_extraction` (الافتراضي مطفأ كي لا يتغيّر سلوك أي مؤسسة قائمة).
 *
 * لا نظام ميزانية ثانٍ: يمرّ عبر `AiRequestLedger` / `AiBudgetService` ذاتهما (سقف المنصة ثم سقف المؤسسة، حجز ذرّي قبل
 * الاتصال، تسوية بالاستهلاك الفعلي، `failure_charge`)، وتُميَّز الصفوف بـ`feature = document_extraction`. التسعير من
 * `ai_assistant.pricing.<provider>.<model>`؛ مزوّد/نموذج بلا سعر ⇒ رفض (`pricing_unknown`) لا «مجاني».
 *
 * عند الرفض لا يُرسَل المستند إلى المزوّد إطلاقاً (يُسجَّل المحاولة «متخطّاة» ويُجرَّب المزوّد التالي إن وُجد).
 */
final class DocumentExtractionMeter
{
    public const FEATURE = 'document_extraction';

    /** أكواد فشل HTTP لا يولّد فيها المزوّد رموزاً ⇒ تسوية بصفر لا بالمحجوز. */
    private const UNBILLED_FAILURES = [
        'provider_authentication_failed', 'provider_rate_limited', 'provider_request_rejected',
        'provider_not_configured', 'provider_network_disabled', 'unsupported_provider_file_type',
    ];

    public function __construct(private readonly AiRequestLedger $ledger) {}

    public static function enabled(): bool
    {
        return (bool) config('ai_assistant.budget.meter_document_extraction', false);
    }

    /**
     * يحجز قبل الاتصال. يعيد `null` حين القياس مطفأ.
     *
     * @throws AiAssistantDenied  `pricing_unknown` | `budget_not_configured` | `budget_exceeded` | `platform_budget_exceeded`
     */
    public function reserve(string $tenantId, ?string $actorId, string $provider, string $model, int $pageCount): ?AiRequest
    {
        if (! self::enabled()) {
            return null;
        }

        $profile = AiAssistantPricing::profile($provider, $model) ?? throw AiAssistantDenied::for('pricing_unknown');
        $input = max(1, $pageCount) * max(1, (int) config('ai_assistant.document_extraction.input_tokens_per_page', 6000))
            + (int) config('ai_assistant.document_extraction.overhead_tokens', 3000);
        $output = (int) config('ai_assistant.document_extraction.max_output_tokens', 4096);

        return $this->ledger->open(
            $tenantId,
            $actorId ?? '00000000-0000-0000-0000-000000000000',
            $provider,
            $model,
            $profile,
            $input + $output,
            AiAssistantPricing::costMicroUsd($profile, $input, $output),
            null,
            $this->ledger->hmac('document_extraction|' . Str::uuid()),
            self::FEATURE,
        );
    }

    public function settle(?AiRequest $request, string $provider, string $model, ?int $inputTokens, ?int $outputTokens): void
    {
        if ($request === null) {
            return;
        }
        $profile = AiAssistantPricing::profile($provider, $model);
        // المزوّد لم يُبلّغ عن الاستهلاك ⇒ فشل مغلق بسياسة الفشل (لا نفترض أن المستند كان مجانياً).
        if ($profile === null || $inputTokens === null || $outputTokens === null) {
            $this->ledger->fail($request, null, 'usage_unreported');

            return;
        }
        $this->ledger->complete($request, [
            'input_tokens' => $inputTokens,
            'output_tokens' => $outputTokens,
            'cost_micro_usd' => AiAssistantPricing::costMicroUsd($profile, $inputTokens, $outputTokens),
        ]);
    }

    public function fail(?AiRequest $request, ?string $safeCode): void
    {
        if ($request === null) {
            return;
        }
        $unbilled = $safeCode !== null && in_array($safeCode, self::UNBILLED_FAILURES, true);
        $this->ledger->fail($request, $unbilled ? ['input_tokens' => 0, 'output_tokens' => 0, 'cost_micro_usd' => 0] : null, $safeCode ?? 'provider_error');
    }
}
