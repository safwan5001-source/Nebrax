<?php

namespace App\Contracts;

use App\Support\AiAssistantDenied;
use App\Support\AiProviderException;

/**
 * مزوّد مساعد **خارجي** (AI-07): يخرج الطلب إلى خدمة نموذج، فيخضع لضوابط إضافية لا يحتاجها `mock`:
 * جاهزية مزوّد المنصة (المفتاح/النموذج/بوابة الشبكة) وإقرار المستأجر الصريح وتسعير معرَّف وميزانية، ثم
 * **مرحلتان**: تخطيط (قد يقترح أدوات مسجَّلة) ثم صياغة الجواب من نتائج الأدوات **بعد حجبها** لا من البيانات الخام.
 */
interface AiExternalAssistantProvider extends AiAssistantProvider
{
    /** @throws AiAssistantDenied `provider_unavailable` ما لم يجتز كل شروط المنصة (بلا كشف السبب للعميل). */
    public function assertReady(): void;

    /**
     * ما يُحجز للطلب كله (نداءان كحدّ أقصى) من رموز الإدخال والإخراج — يُحجز قبل أي استدعاء.
     *
     * @return array{0:int, 1:int} [input_tokens, output_tokens]
     */
    public function reservationEstimate(int $estimatedInput, int $maxOutputTokens): array;

    /**
     * المرحلة الثانية: صياغة الجواب النهائي من ملخّصات نتائج الأدوات **المحجوبة** (بلا هويات ولا أسماء أطراف).
     *
     * @param  array{message:string, locale:string, max_output_tokens:int, today:string, timezone:string}  $input
     * @param  array<string,mixed>  $continuation  كما أعادها `respond()`.
     * @param  list<array{tool:string, digest:array<string,mixed>}>  $results  بترتيب اقتراح الأدوات نفسه.
     * @return array{content:string, usage:array{input_tokens:int, output_tokens:int}}
     * @throws AiProviderException يحمل استهلاك المرحلة الأولى إن عُرف.
     */
    public function compose(array $input, array $continuation, array $results): array;
}
