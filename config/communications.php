<?php

/**
 * منصة الاتصالات (AWJ-COMMS) — إعدادات تشغيلية. لا أسرار في المستودع ولا قيم افتراضية للمفاتيح.
 *
 * مفاتيح HMAC لبصمة الطلب: **منفصلة تماماً عن `APP_KEY`** ولا تُشتقّ منه ولا تُولَّد آلياً. تُضبط من مخزن
 * أسرار المنصة (متغيرات بيئة)، بإصدارات صريحة:
 *
 *   COMMUNICATIONS_HMAC_ACTIVE_VERSION=1
 *   COMMUNICATIONS_HMAC_KEY_1=<base64 لـ32 بايت على الأقل>      (openssl rand -base64 32)
 *   COMMUNICATIONS_HMAC_KEY_2=...                                   (عند التدوير)
 *
 * غياب الإصدار النشط أو مفتاحه، أو مفتاح غير صالح/قصير، أو مفتاح مساوٍ لـAPP_KEY ⇒ فشل مغلق قبل أي إدراج.
 * التدوير: أضف المفتاح الجديد وحوّل الإصدار النشط؛ تبقى المفاتيح القديمة مضبوطة حتى لا يبقى صفّ بإصدارها
 * (لا إعادة تجزئة للقديم: لا نملك العنوان الخام). **لا يُنشأ أي مفتاح هنا.**
 */
// كل إصدار مدعوم (1..32767، كما في Schema والـKeyring) يُكتشف من أسماء متغيرات البيئة، لا من نطاق ثابت.
$hmacKeys = [];
foreach ([getenv(), $_ENV, $_SERVER] as $source) {
    foreach (is_array($source) ? $source : [] as $name => $value) {
        if (is_string($name) && preg_match('/^COMMUNICATIONS_HMAC_KEY_([1-9][0-9]{0,4})\z/', $name, $m) === 1
            && (int) $m[1] <= 32767 && ! isset($hmacKeys[(int) $m[1]])) {
            $key = env($name);
            if (is_string($key) && $key !== '') {
                $hmacKeys[(int) $m[1]] = $key;
            }
        }
    }
}
ksort($hmacKeys);

return [
    'hmac' => [
        'active_version' => env('COMMUNICATIONS_HMAC_ACTIVE_VERSION'),
        'keys'           => $hmacKeys,
    ],

    /*
     * سياسة الإدراج لكل تصنيف (TTL بالثواني + أقصى محاولات). OTP: محاولة واحدة دائماً بغضّ النظر عن هذا الإعداد
     * (الثابت تفرضه القاعدة). `marketing` غير مفعَّل: يتطلب سجل موافقات (قرار D3/D4 مفتوح) فيُرفض إدراجه حتى ذلك.
     */
    'policy' => [
        'otp'           => ['ttl_seconds' => 300,   'max_attempts' => 1],
        'transactional' => ['ttl_seconds' => 86400, 'max_attempts' => 3],
        'service'       => ['ttl_seconds' => 86400, 'max_attempts' => 3],
    ],
];
