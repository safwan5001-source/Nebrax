<?php

namespace App\Support\Communications;

/**
 * ADR-COMMS-01 §5 — تصنيف الرسالة إلزامي. كل فئة لها قواعد موافقة ومحتوى وتبديل مزود مستقلة،
 * فلا يعتمد المستهلك على حسن نيّته: البوابة (شريحة لاحقة) تقرأ هذه الحقائق وترفض قبل الإرسال.
 * OTP لا يُصنَّف ضمن المعاملات ولا يُحرَّر قالبه من المستأجر.
 */
enum MessageClassification: string
{
    case Otp = 'otp';
    case Transactional = 'transactional';
    case Service = 'service';
    case Marketing = 'marketing';

    /** التسويق وحده يشترط موافقة صريحة موثّقة. أما موافقة المعاملات فقرار مؤجَّل (D3). */
    public function requiresExplicitConsent(): bool
    {
        return $this === self::Marketing;
    }

    /** OTP لا يُخزَّن محتواه ولا رمزه في أي سجل (ADR-05 §19). */
    public function mayStoreBody(): bool
    {
        return $this !== self::Otp;
    }

    /** التسويق لا يُبدَّل مزوّده تلقائياً؛ بقية الفئات تسمح به عند الفشل القابل لإعادة المحاولة (يضبطه التوجيه لاحقاً). */
    public function allowsProviderFallback(): bool
    {
        return $this !== self::Marketing;
    }
}
