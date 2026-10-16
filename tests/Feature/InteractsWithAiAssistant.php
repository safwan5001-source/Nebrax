<?php

namespace Tests\Feature;

use App\Models\AiAuditEvent;
use App\Models\AiBudget;
use App\Models\AiRequest;
use App\Services\AiBudgetService;
use App\Services\MockAiAssistantProvider;
use App\Support\AiAssistantDataCategory;
use App\Support\AiAssistantPricing;
use App\Support\Settings;
use App\Tenancy\TenantContext;
use Illuminate\Testing\TestResponse;

/**
 * مساعدات اختبارات المساعد الذكي (AI-02): مستأجر جاهز، تسعير تجريبي قابل للفوترة، أسقف، وقراءة السجلات.
 */
trait InteractsWithAiAssistant
{
    protected const AI_URL = '/api/ai-assistant/messages';
    protected const AI_SECRET = 'sk-ant-api03-TOP-SECRET-DO-NOT-LEAK';
    protected const AI_PROMPT = 'ما هو رصيد العميل الخاص بشركة المنارة؟ PROMPT-CANARY-7731';

    /** مستأجر + مالك، مع تفعيل المنصة وموافقة المستأجر على رسائل المساعد. */
    protected function aiTenant(string $slug = 'ai-a', bool $platform = true): array
    {
        $auth = $this->registerTenant($slug, "owner@{$slug}.test");
        config(['ai_assistant.enabled' => $platform]);
        $this->aiOptIn($auth['tenant_id']);

        return $auth;
    }

    protected function aiOptIn(string $tenantId, array $categories = [AiAssistantDataCategory::ASSISTANT_MESSAGES]): void
    {
        $context = app(TenantContext::class);
        $previous = $context->id();
        $context->set($tenantId);
        Settings::put('ai_assistant', ['enabled' => true, 'consented_categories' => $categories]);
        $previous === null ? $context->forget() : $context->set($previous);
    }

    /** يجعل المزوّد التجريبي قابلاً للفوترة بأسعار صريحة (micro-USD لكل 1000 رمز). */
    protected function billableMock(int $inputRate = 3000, int $outputRate = 15000): void
    {
        config(['ai_assistant.pricing.mock.mock-1' => [
            'billable' => true,
            'input_micro_usd_per_1k' => $inputRate,
            'output_micro_usd_per_1k' => $outputRate,
        ]]);
    }

    /** @return array{0:int,1:int} [tokens, costMicroUsd] المحجوز لرسالة بعينها بالإعداد الحالي. */
    protected function reservationFor(string $message = self::AI_PROMPT): array
    {
        $profile = AiAssistantPricing::profile('mock', 'mock-1');
        $in = AiAssistantPricing::estimateInputTokens($message);
        $out = (int) config('ai_assistant.limits.max_output_tokens');

        return [$in + $out, AiAssistantPricing::costMicroUsd($profile, $in, $out)];
    }

    /** @return array{input_tokens:int,output_tokens:int} ما سيُبلّغ به المزوّد التجريبي لرسالة عربية. */
    protected function mockUsageFor(string $message = self::AI_PROMPT, string $locale = 'ar'): array
    {
        return (new MockAiAssistantProvider)->respond([
            'message' => $message, 'locale' => $locale, 'max_output_tokens' => (int) config('ai_assistant.limits.max_output_tokens'),
        ])['usage'];
    }

    protected function setCaps(?string $tenantId, int $tokens, int $costMicroUsd, ?string $period = null): AiBudget
    {
        $budgets = app(AiBudgetService::class);

        return $budgets->setCaps($tenantId, $period ?? $budgets->period(), $tokens, $costMicroUsd);
    }

    protected function budgetRow(?string $tenantId, ?string $period = null): AiBudget
    {
        $budgets = app(AiBudgetService::class);

        return AiBudget::query()->where('budget_key', $budgets->key($tenantId))->where('period', $period ?? $budgets->period())->firstOrFail();
    }

    protected function aiAsk(string $token, array $payload = [], array $headers = []): TestResponse
    {
        return $this->withToken($token)->withHeaders($headers)->postJson(self::AI_URL, array_merge(['message' => self::AI_PROMPT], $payload));
    }

    /** @return \Illuminate\Support\Collection<int,AiAuditEvent> */
    protected function auditEvents(?string $requestId = null)
    {
        return AiAuditEvent::withoutGlobalScopes()
            ->when($requestId, fn ($q) => $q->where('request_id', $requestId))
            ->orderBy('occurred_at')->orderBy('id')->get();
    }

    protected function requestRow(string $requestId): AiRequest
    {
        return AiRequest::withoutGlobalScopes()->findOrFail($requestId);
    }
}
