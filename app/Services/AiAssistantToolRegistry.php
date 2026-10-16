<?php

namespace App\Services;

use App\Contracts\AiAssistantTool;

/**
 * سجلّ الأدوات **المغلق**. يُعلَن هنا فقط ما يُسمح للمساعد باستدعائه؛ لا اكتشاف
 * ديناميكي ولا اسم أداة من النموذج يُحلّ خارج هذه القائمة. في AI-01 القائمة فارغة
 * عمداً (لا أدوات مالية ولا مستندات) — أدوات AI-02 تُضاف هنا وحدها.
 */
class AiAssistantToolRegistry
{
    /** @var array<string, AiAssistantTool>|null */
    private ?array $index = null;

    /** @return list<AiAssistantTool> */
    protected function definitions(): array
    {
        return [];
    }

    public function find(string $name): ?AiAssistantTool
    {
        $this->index ??= collect($this->definitions())
            ->mapWithKeys(fn (AiAssistantTool $tool): array => [$tool->name() => $tool])
            ->all();

        return $this->index[$name] ?? null;
    }

    /** @return list<string> */
    public function names(): array
    {
        return array_values(array_map(
            static fn (AiAssistantTool $tool): string => $tool->name(),
            $this->definitions(),
        ));
    }
}
