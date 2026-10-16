<?php

namespace App\Services;

use App\Contracts\AiAssistantProvider;

/**
 * المزوّد التجريبي الحتمي: ردٌّ ثابت حسب اللغة، لا يردّد نصّ المستخدم، ولا
 * يستعمل شبكة ولا أسراراً ولا إعدادات المنصة. `planToolCalls` تُحقَن في
 * الاختبارات وحدها لإثبات أن البوابة تفحص كل استدعاء أداة؛ الافتراضي لا يقترح شيئاً.
 */
class MockAiAssistantProvider implements AiAssistantProvider
{
    /**
     * @param  (callable(array):list<array{name:string, arguments:array<string,mixed>}>)|null  $planToolCalls
     */
    public function __construct(private readonly mixed $planToolCalls = null) {}

    public function name(): string
    {
        return 'mock';
    }

    public function respond(array $input): array
    {
        $content = $input['locale'] === 'en'
            ? 'This is a deterministic mock response. No external provider was contacted.'
            : 'هذا ردّ تجريبي حتمي. لم يُجرَ أي اتصال بمزوّد خارجي.';

        $toolCalls = is_callable($this->planToolCalls) ? ($this->planToolCalls)($input) : [];

        return ['content' => $content, 'tool_calls' => $toolCalls];
    }
}
