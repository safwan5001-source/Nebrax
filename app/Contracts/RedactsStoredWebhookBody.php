<?php

namespace App\Contracts;

/**
 * محوّل مزوّد يحمل أسراراً داخل جسم الـwebhook نفسه (مثل Moyasar: `secret_token` في الجسم بلا HMAC).
 * `PaymentWebhookInbox` يحفظ النسخة المنقّحة فقط، فلا يُخزَّن السر في `payment_provider_events`؛ أما البصمة (`body_hash`) فتُحسب
 * على الجسم الخام لكشف التكرار/التعارض.
 */
interface RedactsStoredWebhookBody
{
    /** يعيد جسماً صالحاً للحفظ بلا أي سرّ. لا يرمي: عند الفشل يعيد عنصراً نائباً بلا محتوى. */
    public function redactForStorage(string $body): string;
}
