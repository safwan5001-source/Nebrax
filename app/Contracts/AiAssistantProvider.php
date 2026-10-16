<?php

namespace App\Contracts;

use App\Support\AiProviderException;

/**
 * مزوّد المساعد الذكي. في AI-01/02 التنفيذ الوحيد `MockAiAssistantProvider`: حتميّ داخل العملية،
 * بلا شبكة ولا أسرار. أي مزوّد حقيقي لاحقاً ينفّذ هذا العقد ويمرّ بعد بوابات المنصة والمستأجر
 * والفاعل **والميزانية**، لا قبلها.
 */
interface AiAssistantProvider
{
    public function name(): string;

    /** النموذج المستعمل — مفتاح التسعير مع `name()`. غيابه في جدول الأسعار يمنع الاستدعاء. */
    public function model(): string;

    /**
     * يخطّط ردّاً على رسالة. لا يملك المزوّد أي وصول للبيانات: يعيد نصّاً واستهلاكاً مُبلَّغاً به
     * ومقترحات استدعاء أدوات (اسم + معطيات) تفحصها البوابة قبل أي تنفيذ.
     *
     * @param  array{message:string, locale:string, max_output_tokens:int, today:string, timezone:string}  $input  `today`/`timezone`: تاريخ اليوم بتوقيت المستأجر (Y-m-d) واسم المنطقة — غير حساسَين.
     * @return array{
     *     content:string,
     *     tool_calls:list<array{name:string, arguments:array<string,mixed>}>,
     *     usage:array{input_tokens:int, output_tokens:int}
     * }
     * @throws AiProviderException
     */
    public function respond(array $input): array;
}
