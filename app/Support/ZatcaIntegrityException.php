<?php

namespace App\Support;

use RuntimeException;

/**
 * مستند ZATCA صادر لا يطابق سجل إصداره الثابت في السلسلة المشتركة؛ لا يُرسَل.
 *
 * الرسالة ثابتة بلا قيم (لا هاش ولا XML ولا معرّفات)، و`reason` رمز قصير ثابت للتشخيص والاختبار.
 * يرث RuntimeException فيُحوَّل في الواجهات القائمة إلى 422 / فشل لقطة كما أي رفض مسبق، دون تغيير عقد أي API.
 */
final class ZatcaIntegrityException extends RuntimeException
{
    public function __construct(public readonly string $reason)
    {
        parent::__construct("تعذر التحقق من سلامة مستند ZATCA الصادر قبل الإرسال ({$reason}).");
    }
}
