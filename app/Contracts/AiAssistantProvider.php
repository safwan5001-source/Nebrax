<?php

namespace App\Contracts;

/**
 * مزوّد المساعد الذكي. في AI-01 التنفيذ الوحيد `MockAiAssistantProvider`:
 * حتميّ داخل العملية، بلا شبكة ولا أسرار. أي مزوّد حقيقي لاحقاً ينفّذ هذا
 * العقد ويمرّ بعد بوابات المنصة والمستأجر والفاعل، لا قبلها.
 */
interface AiAssistantProvider
{
    public function name(): string;

    /**
     * يخطّط ردّاً على رسالة. لا يملك المزوّد أي وصول للبيانات: يعيد نصّاً
     * ومقترحات استدعاء أدوات (اسم + معطيات) تفحصها البوابة قبل أي تنفيذ.
     *
     * @param  array{message:string, locale:string}  $input
     * @return array{content:string, tool_calls:list<array{name:string, arguments:array<string,mixed>}>}
     */
    public function respond(array $input): array;
}
