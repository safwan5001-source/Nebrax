<?php

namespace App\Support;

use App\Http\Middleware\ResolveStorefrontDomain;
use App\Services\Commerce\RetailAccountGate;
use App\Services\Commerce\WholesaleBuyerGate;
use Illuminate\Http\Request;
use Illuminate\Cache\RateLimiting\Limit;

/**
 * ═══════════════════════════════════════════════════════════════
 *  B2C ACTIVATION READINESS — هوية زائر المتجر الموقَّعة لمحدِّدات المصادقة (مغلقة افتراضياً)
 * ═══════════════════════════════════════════════════════════════
 *  المشكلة: كل زوار المتجر يصلون إلى Laravel من عنوان خادم Next.js، فمفتاح `tenant|ip` في محدِّدات الدخول/التسجيل/الاستعادة سلّةٌ
 *  واحدة لكل المتجر (20/دقيقة للدخول): مشترٍ مخرِّب يقفل الجميع، وتدفّق تسوّق حقيقي بحجم B2C يتجاوزها.
 *
 *  ما يمكن إثباته هنا — وما لا يمكن:
 *   - يُثبَت أن المُرسِل هو خادم المتجر (سرّ البوابة، يضع `ResolveStorefrontDomain` وحده العلامة الخادمية).
 *   - لا يُثبَت من هذا المستودع أن العنوان الذي رآه خادم المتجر هو عنوان الزائر الحقيقي (يعتمد على سلسلة الحافة: Vercel/Railway/CDN).
 *     لذلك **لا يُقرأ هنا أي `X-Forwarded-For`/`X-Real-IP`/`Forwarded`** إطلاقاً (تبقى خاملة). المصدر الوحيد المقبول ترويسةٌ
 *     يضعها خادم المتجر نفسه **بعد أن يُعلن المشغّل صراحةً** مصدر العنوان الموثوق في بيئته (`STOREFRONT_CLIENT_IP_SOURCE`)،
 *     وتُوقَّع بـ HMAC مشتقّ من سرّ البوابة ومربوطة بـ: المضيف المُمرَّر + العنوان + الطابع الزمني.
 *
 *  الضمانات:
 *   - مغلق افتراضياً: `storefront.client_identity.enabled` = `false` ⇒ السلوك القديم حرفياً (سلة `tenant|ip` المشتركة).
 *   - يتطلب علامة البوابة الموثَّقة + توقيعاً صحيحاً + طابعاً زمنياً طازجاً + عنواناً عاماً (لا خاص/محجوز/loopback — عنوان داخلي معناه
 *     أن المصدر مُهيَّأ خطأً فتنهار الهوية إلى سلة واحدة، فنرفضه ونعود للسلوك القديم بدل أن نخدع أنفسنا).
 *   - التوقيع مربوط بالمضيف: ترويسة مسروقة من متجر لا تُقبل على متجر آخر.
 *   - IPv6 يُجمَّع على بادئة /64 (المستخدم المنزلي يملك /64 كاملة؛ دورانه داخلها لا يجب أن يمنحه سلالاً جديدة).
 *   - **لا يُضعف الجملة:** يُفعَّل فقط على مضيف حسابات تجزئة مفتوح وجملة مغلقة؛ مضيف الجملة (ولو مع التجزئة) يبقى على السلة المشتركة
 *     بحدّها الأصلي. محدِّدات البريد (5/دقيقة للدخول، 3 للتسجيل…) لا تُمسّ هنا إطلاقاً — هي حارس القوة الغاشمة الحقيقي.
 *   - مع الهوية الصالحة: سلة لكل زائر بالحدّ الأصلي نفسه + **سقف للمتجر كله** (`backstop_multiplier` × الحدّ) يبقى كابحاً لرشّ بيانات
 *     الاعتماد الموزّع، فيُفقد قفلُ-الجميع-بمخرِّب-واحد لكن لا يُفتح المتجر بلا سقف.
 */
final class StorefrontClientIdentity
{
    public const HEADER_IP = 'X-Storefront-Client-Ip';

    public const HEADER_TIMESTAMP = 'X-Storefront-Client-Ip-Ts';

    public const HEADER_SIGNATURE = 'X-Storefront-Client-Ip-Sig';

    private const ATTRIBUTE = 'storefront_client_bucket';

    /** HMAC بمفتاحٍ مشتقّ (فصل نطاق): مفتاح التوقيع ليس سرّ البوابة نفسه. */
    public static function signature(string $gatewaySecret, string $forwardedHost, string $ip, int $timestamp): string
    {
        $key = hash_hmac('sha256', 'awj-storefront-client-ip.v1', $gatewaySecret);

        return hash_hmac('sha256', implode("\n", ['awj-client-ip.v1', $forwardedHost, $ip, (string) $timestamp]), $key);
    }

    /**
     * سلّة الزائر الموقَّعة لهذا الطلب، أو null (= السلوك القديم). ميموَّه على الطلب.
     */
    public static function bucket(Request $request): ?string
    {
        $cached = $request->attributes->get(self::ATTRIBUTE);
        if ($cached !== null) {
            return $cached === false ? null : (string) $cached;
        }

        $bucket = self::derive($request);
        $request->attributes->set(self::ATTRIBUTE, $bucket ?? false);

        return $bucket;
    }

    private static function derive(Request $request): ?string
    {
        $secret = (string) config('storefront.gateway_secret', '');
        if (! (bool) config('storefront.client_identity.enabled')
            || $secret === ''
            || $request->attributes->get(ResolveStorefrontDomain::GATEWAY_VERIFIED_ATTRIBUTE) !== true
        ) {
            return null;
        }

        $host = $request->header('X-Storefront-Forwarded-Host');
        $ip = $request->header(self::HEADER_IP);
        $ts = $request->header(self::HEADER_TIMESTAMP);
        $sig = $request->header(self::HEADER_SIGNATURE);
        if (! is_string($host) || ! is_string($ip) || ! is_string($ts) || ! is_string($sig)
            || $host === '' || $ip === '' || preg_match('/^\d{9,12}$/', $ts) !== 1 || preg_match('/^[a-f0-9]{64}$/', $sig) !== 1
        ) {
            return null;
        }

        $skew = max(1, (int) config('storefront.client_identity.max_skew_seconds', 60));
        if (abs(time() - (int) $ts) > $skew) {
            return null;
        }

        if (! hash_equals(self::signature($secret, $host, $ip, (int) $ts), $sig)) {
            return null;
        }

        $normalized = self::normalize($ip);

        return $normalized === null ? null : substr(hash('sha256', $normalized), 0, 32);
    }

    /** عنوان عام صالح فقط؛ IPv4 المُغلَّف بـIPv6 (`::ffff:a.b.c.d`) يُختزل إلى IPv4 أولاً؛ IPv6 → بادئة /64. */
    private static function normalize(string $ip): ?string
    {
        $packed = filter_var($ip, FILTER_VALIDATE_IP) === false ? false : @inet_pton($ip);
        if ($packed === false) {
            return null;
        }

        // ::ffff:a.b.c.d — نفس المستخدم بصيغتين؛ يجب أن يقع في سلة IPv4 نفسها ويُفحص كـIPv4 (وإلا رفضه فلتر النطاق المحجوز).
        if (strlen($packed) === 16 && str_starts_with($packed, str_repeat("\0", 10)."\xff\xff")) {
            $packed = substr($packed, 12);
            $ip = (string) inet_ntop($packed);
        }

        if (filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE) === false) {
            return null;
        }

        return strlen($packed) === 16 ? 'v6:'.bin2hex(substr($packed, 0, 8)) : 'v4:'.$ip;
    }

    /** هل يجوز لهذا المضيف استعمال سلة الزائر؟ تجزئة مفتوحة وجملة مغلقة فقط (لا إضعاف للجملة). */
    private static function hostEligible(): bool
    {
        return app(RetailAccountGate::class)->isOpen() && ! app(WholesaleBuyerGate::class)->isOpen();
    }

    /**
     * أبعاد "الشبكة" لمحدِّد مصادقة متجر. بلا هوية موقَّعة صالحة (أو مضيف جملة) ⇒ السلة القديمة حرفياً
     * `{name}|{tenant}|ip|{ip}`؛ وإلا سلة الزائر بالحدّ نفسه + سقف المتجر.
     *
     * @return array<int, Limit>
     */
    public static function networkLimits(Request $request, string $name, string $tenant, int $perMinute): array
    {
        $bucket = self::bucket($request);

        if ($bucket === null || ! self::hostEligible()) {
            return [Limit::perMinute($perMinute)->by("{$name}|{$tenant}|ip|{$request->ip()}")];
        }

        $multiplier = max(1, (int) config('storefront.client_identity.backstop_multiplier', 10));

        return [
            Limit::perMinute($perMinute)->by("{$name}|{$tenant}|visitor|{$bucket}"),
            Limit::perMinute($perMinute * $multiplier)->by("{$name}|{$tenant}|store-backstop"),
        ];
    }
}
