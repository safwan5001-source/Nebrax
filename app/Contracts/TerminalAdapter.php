<?php

namespace App\Contracts;

use App\Models\PosPaymentTerminal;
use App\Models\PosTerminalRequest;
use App\Support\PosTerminalResult;

/**
 * عقد محوّل جهاز دفع POS (PAY-H6-02). كل عملية **idempotent بمعرّف الطلب** عند المزوّد/الجسر، ولا تُستدعى داخل معاملة قاعدة بيانات.
 * المحوّل لا يكتب سنداً ولا قيداً: يعيد نتيجة يطبّقها `PosTerminalService` على الطلب. المحوّلات الحقيقية (جسر محلي بأوامر موقّعة أو سحابة مزوّد)
 * تُضاف في H6-03 بعد حسم مزوّد الأجهزة (D-18).
 */
interface TerminalAdapter
{
    public function provider(): string;

    /**
     * يرسل الطلب إلى الجهاز. يعيد `pending` (بانتظار العميل) أو نتيجة فورية، و`error` **فقط** حين يُثبت المحوّل أن شيئاً لم يُرسَل.
     * **استثناء = نتيجة غامضة** (قد يكون الجهاز استلم ووافق وضاع الردّ): تتعامل معه الخدمة كطلب `sent` غير مؤكد فيُستعلَم/يُلغى ولا يُحرَّر الجهاز.
     */
    public function start(PosPaymentTerminal $terminal, PosTerminalRequest $request): PosTerminalResult;

    /** حالة الطلب لدى المزوّد الآن (الحقيقة)، لا ما ادّعاه العميل. */
    public function fetch(PosPaymentTerminal $terminal, PosTerminalRequest $request): PosTerminalResult;

    /** إلغاء طلب لم يُوافَق عليه بعد. */
    public function cancel(PosPaymentTerminal $terminal, PosTerminalRequest $request): PosTerminalResult;

    /** إلغاء موافقة قائمة (void/reverse) فتُردّ للعميل. النجاح = `voided`. */
    public function void(PosPaymentTerminal $terminal, PosTerminalRequest $request): PosTerminalResult;
}
