<?php

namespace App\Support;

/**
 * مخطّط الرابط الذي يراه المتصفح عند الاستضافة خلف حافة TLS (Railway).
 *
 * الخادم يستقبل الطلب `http` من الحافة (لا `trustProxies`)، فتُولَّد الروابط الموقَّعة `http://`، فيحجب
 * المتصفح صور `https` الصفحة المختلطة أو يرقّيها بعضها فقط (AWJ-HORIZON-MEDIA-STORAGE S4). **التحقق من التوقيع
 * يجري على `http`** (ما يراه التطبيق)، لذلك يُستبدل المخطّط **بعد** التوقيع فقط، فلا يتغيّر ما يُحسَب عليه
 * التوقيع ولا يُكسَر أي رابط قائم. لا يُفعَّل `trustProxies` عمداً: يمسّ Host/Forwarded التي يقوم عليها تحديد
 * المستأجر، وقد يكسر روابطاً موقَّعة تُولَّد عبر الشبكة الخاصة. يُطبَّق فقط حين تؤكّد الحافة `https`.
 */
final class EdgeScheme
{
    public static function forBrowser(string $signedUrl): string
    {
        $forwarded = request()->headers->get('X-Forwarded-Proto');
        if (! is_string($forwarded)) {
            return $signedUrl;
        }
        $first = strtolower(trim(explode(',', $forwarded)[0]));

        return $first === 'https' && str_starts_with($signedUrl, 'http://')
            ? 'https://'.substr($signedUrl, strlen('http://'))
            : $signedUrl;
    }
}
