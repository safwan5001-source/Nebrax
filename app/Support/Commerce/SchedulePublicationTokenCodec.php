<?php

namespace App\Support\Commerce;

/**
 * CUST-H1-4 — يحوّل `storefront_presentations.schedule_epoch` (عدّاد داخلي)
 * إلى/من `schedule_token` معتم يُسلَّم للتاجر. مرجعها المعماري:
 * `docs/plans/store/CUST-H1-ARCH-1-...md` §10 "Schedule"، §34.
 *
 * لماذا موقَّع لا مجرَّد Base64 للعدّاد: العدّاد نفسه ليس سرّاً، لكن الغرض
 * الكامل من الرمز هو حماية تزامن تفاؤلي — إن استطاع العميل بناء رمزٍ لعدّاد
 * لم يلاحظه الخادم فعلياً (مثلاً بتخمين +1)، فقد تجاوز الفحص الذي صُمِّم
 * ليمنعه بالضبط: تحديثاً أعمى فوق حالة جدولة أحدث لم يرها. توقيع HMAC يمنع
 * بناء رمزٍ صالح لعدّادٍ لم يُسلَّمه الخادم فعلياً لهذا المتجر تحديداً — لا
 * دور تفويضي هنا (المستخدم مخوَّل أصلاً على هذا المتجر)، بل صحّة الرمز نفسه.
 *
 * لا يُضمَّن `tenant_id`: معرّف المتجر ليس سرّاً (يظهر في الـURL نفسه)،
 * والرمز مرتبط بمتجرٍ واحد فقط عبر التوقيع — استخدامه لمتجرٍ آخر يفشل
 * التحقّق حتى لو كان العدّاد مطابقاً صدفة.
 */
final class SchedulePublicationTokenCodec
{
    public function encode(string $storefrontId, int $scheduleEpoch): string
    {
        $signature = $this->sign($storefrontId, $scheduleEpoch);

        $raw = json_encode(['e' => $scheduleEpoch, 's' => $signature], JSON_UNESCAPED_SLASHES);

        return rtrim(strtr(base64_encode((string) $raw), '+/', '-_'), '=');
    }

    /**
     * @return int|null العدّاد المُرمَّز إن كان الرمز سليماً وموقَّعاً لهذا
     *                   المتجر تحديداً؛ null لأي رمزٍ مشوَّه/موقَّع لمتجرٍ آخر/مزوَّر.
     */
    public function decode(string $storefrontId, string $token): ?int
    {
        $padded = str_pad(strtr($token, '-_', '+/'), (int) (4 * ceil(strlen($token) / 4)), '=', STR_PAD_RIGHT);
        $decoded = base64_decode($padded, true);
        if ($decoded === false) {
            return null;
        }

        $payload = json_decode($decoded, true);
        if (
            ! is_array($payload)
            || ! isset($payload['e'], $payload['s'])
            || ! is_int($payload['e'])
            || ! is_string($payload['s'])
        ) {
            return null;
        }

        $expected = $this->sign($storefrontId, $payload['e']);
        if (! hash_equals($expected, $payload['s'])) {
            return null;
        }

        return $payload['e'];
    }

    private function sign(string $storefrontId, int $scheduleEpoch): string
    {
        return hash_hmac('sha256', $storefrontId.':'.$scheduleEpoch, (string) config('app.key'));
    }
}
