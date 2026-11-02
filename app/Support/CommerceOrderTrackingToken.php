<?php

namespace App\Support;

use App\Models\CommerceOrder;
use RuntimeException;

/**
 * ═══════════════════════════════════════════════════════════════
 *  COPS-H2-5 (D-H2-15/16) — رمز تتبّع الضيف الموقَّع، **منفصل الغرض** عن مرجع الطلب `v1`
 * ═══════════════════════════════════════════════════════════════
 *  الصيغة: `trk1.{order_id}.{exp}.{hex-hmac}`؛ التوقيع HMAC-SHA256 يربط `tenant | sales_channel | order | exp` بمفتاح مشتق لغرض التتبع فقط
 *  (`HMAC(app.key, "awj.commerce.order-tracking.v1")` أو `COMMERCE_TRACKING_KEY` للتدوير). عديم الحالة: لا عمود ولا جدول.
 *
 *  - **لا يخوّل شيئاً سوى قراءة إسقاط التتبع الضيّق**: لا بدء دفع ولا `payment-status` ولا `commerce/v1/orders` (كلها بمرجع `v1`)، والمرجع `v1`
 *    لا يخوّل صفحة التتبع (بادئة وصيغة ومفتاح مختلفة).
 *  - مربوط بمستأجر وقناة وطلب: رمز لطلب آخر/مستأجر آخر/قناة أخرى لا يتحقق.
 *  - `exp` = `confirmed_at + ttl` حتمي ⇒ الرمز نفسه في كل إصدار للطلب نفسه (لا هوية ملكية جديدة عند إعادة الطلب).
 *  - فشل مغلق وموحَّد: أي خلل (صيغة/توقيع/انتهاء) ⇒ `parse()`/`verify()` تعيدان null/false بلا تفاصيل. مقارنة ثابتة الزمن.
 *  - يُنقل في **مسار** الرابط لا الاستعلام، ولا يُكتب في أي سجل تدقيق (مسارات `store/v1` لا تمرّ بـ`PublicApiRequestAudit`).
 */
final class CommerceOrderTrackingToken
{
    private const PREFIX = 'trk1';

    private const PURPOSE = 'awj.commerce.order-tracking.v1';

    /** الحد الأقصى لطول الرمز المقبول قبل أي معالجة. */
    public const MAX_LENGTH = 160;

    /** تاريخ انتهاء الرمز لهذا الطلب (UNIX) — حتمي من تأكيده. null لطلب غير مؤكَّد. */
    public static function expiryFor(CommerceOrder $order): ?int
    {
        if ($order->confirmed_at === null) {
            return null;
        }

        return $order->confirmed_at->copy()->addDays(max(1, (int) config('commerce.guest_tracking_ttl_days', 90)))->getTimestamp();
    }

    /** يصدر الرمز؛ null لطلب غير مؤكَّد. */
    public static function issue(CommerceOrder $order): ?string
    {
        $exp = self::expiryFor($order);
        if ($exp === null) {
            return null;
        }

        return implode('.', [self::PREFIX, $order->id, (string) $exp, self::signature($order, $exp)]);
    }

    /**
     * يفكّ البنية فقط (لا توقيع): `[order_id, exp, sig]` أو null. لا يثق بشيء قبل `verify()`. الصيغة قانونية وحيدة التمثيل
     * (uuid وhex بأحرف صغيرة، وexp عشري بلا أصفار بادئة) فلكل رمز صالح نصٌّ واحد فقط.
     *
     * @return array{0: string, 1: int, 2: string}|null
     */
    public static function parse(string $token): ?array
    {
        if ($token === '' || strlen($token) > self::MAX_LENGTH) {
            return null;
        }
        $parts = explode('.', $token);
        if (count($parts) !== 4 || $parts[0] !== self::PREFIX) {
            return null;
        }
        [, $orderId, $exp, $sig] = $parts;
        if (preg_match('/\A[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\z/', $orderId) !== 1
            // قانوني فقط: بلا أصفار بادئة. التوقيع يُحسب على العدد، فتمثيلات «01893456000» و«001893456000» كانت تتحقق بالتوقيع نفسه
            // وتكسر وحدانية التمثيل (ثلاث سلال تحديد معدل لرمز واحد). نرفضها صراحةً بدل تطبيعها.
            || preg_match('/\A[1-9][0-9]{0,11}\z/', $exp) !== 1
            || preg_match('/\A[0-9a-f]{64}\z/', $sig) !== 1) {
            return null;
        }

        return [$orderId, (int) $exp, $sig];
    }

    /** يتحقق أن الرمز يخص هذا الطلب تحديداً ولم ينتهِ. أي خلل ⇒ false بلا تفاصيل. */
    public static function verify(CommerceOrder $order, string $token, ?int $now = null): bool
    {
        $parsed = self::parse($token);
        if ($parsed === null) {
            return false;
        }
        [$orderId, $exp, $sig] = $parsed;

        $signatureOk = hash_equals(self::signature($order, $exp), $sig);
        $sameOrder = hash_equals((string) $order->id, $orderId);
        $live = $exp > ($now ?? now()->getTimestamp());

        // لا اختصار بين الشروط: نُقيِّم الثلاثة دائماً ثم نجمعها.
        return $signatureOk && $sameOrder && $live;
    }

    private static function signature(CommerceOrder $order, int $exp): string
    {
        return hash_hmac(
            'sha256',
            implode('|', [self::PREFIX, $order->tenant_id, $order->sales_channel_id, $order->id, (string) $exp]),
            self::key(),
        );
    }

    private static function key(): string
    {
        $configured = config('commerce.tracking_key');
        if (is_string($configured) && $configured !== '') {
            return hash_hmac('sha256', self::PURPOSE, $configured);
        }

        $app = (string) config('app.key');
        if (str_starts_with($app, 'base64:')) {
            $app = (string) base64_decode(substr($app, 7), true);
        }
        if ($app === '') {
            throw new RuntimeException('APP_KEY غير مضبوط — لا يمكن توقيع رموز تتبّع الطلبات.');
        }

        return hash_hmac('sha256', self::PURPOSE, $app);
    }
}
