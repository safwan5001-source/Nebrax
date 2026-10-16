<?php

namespace App\Services;

use App\Contracts\AiAssistantProvider;
use Throwable;

/**
 * المزوّد التجريبي الحتمي: ردٌّ ثابت حسب اللغة، لا يردّد نصّ المستخدم، ولا يستعمل شبكة ولا أسراراً ولا
 * إعدادات المنصة. يُبلّغ باستهلاك حتمي (رمز لكل 4 بايت) كي تُختبر الميزانية بلا مزوّد حقيقي.
 *
 * حقن الاختبارات وحدها: `$planToolCalls` تقترح أدوات (للتحقق أن البوابة تفحص كل استدعاء)، و`$failure`
 * يُحاكي فشل مزوّد، و`$usageOverride` يُحاكي استهلاكاً مُبلَّغاً به مختلفاً. الافتراضي لا يقترح شيئاً.
 */
class MockAiAssistantProvider implements AiAssistantProvider
{
    /**
     * @param  (callable(array):list<array{name:string, arguments:array<string,mixed>}>)|null  $planToolCalls
     * @param  array{input_tokens:int, output_tokens:int}|null  $usageOverride
     */
    public function __construct(
        private readonly mixed $planToolCalls = null,
        private readonly ?Throwable $failure = null,
        private readonly ?array $usageOverride = null,
    ) {}

    public function name(): string
    {
        return 'mock';
    }

    public function model(): string
    {
        return 'mock-1';
    }

    public function respond(array $input): array
    {
        if ($this->failure !== null) {
            throw $this->failure;
        }

        $content = $input['locale'] === 'en'
            ? 'This is a deterministic mock response. No external provider was contacted.'
            : 'هذا ردّ تجريبي حتمي. لم يُجرَ أي اتصال بمزوّد خارجي.';

        $toolCalls = is_callable($this->planToolCalls) ? ($this->planToolCalls)($input) : [];

        return [
            'content' => $content,
            'tool_calls' => $toolCalls,
            'usage' => $this->usageOverride ?? [
                'input_tokens' => intdiv(strlen($input['message']) + 3, 4),
                'output_tokens' => min($input['max_output_tokens'], intdiv(strlen($content) + 3, 4)),
            ],
        ];
    }
}
