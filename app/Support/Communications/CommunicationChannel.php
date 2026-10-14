<?php

namespace App\Support\Communications;

/**
 * ADR-COMMS-01 — قنوات منصة الاتصالات. قائمة مغلقة تملكها المنصة: إضافة قناة قرارٌ معماري
 * لا قيمة نصية حرّة. الإشعارات الداخلية (`NotificationService`) خارج هذه القائمة عمداً:
 * هي مسارٌ قائم لا يمرّ بمزوّد خارجي.
 */
enum CommunicationChannel: string
{
    case Sms = 'sms';
    case WhatsApp = 'whatsapp';
    case Email = 'email';
    case Push = 'push';

    /** هل عنوان المستلم رقم هاتف بصيغة E.164؟ */
    public function usesPhoneAddress(): bool
    {
        return $this === self::Sms || $this === self::WhatsApp;
    }
}
