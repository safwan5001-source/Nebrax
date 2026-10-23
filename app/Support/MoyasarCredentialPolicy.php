<?php

namespace App\Support;

/**
 * سياسة مفاتيح Moyasar (ADR-0005): قرار المالك 2026-10-23 — Sandbox فقط.
 *  • بيئة `sandbox` تقبل `sk_test_`/`pk_test_` فقط وتَرفض مفاتيح `live` برمز ثابت.
 *  • بيئة `live` ممنوعة كلياً ما دام `payment_providers.moyasar.live_enabled` مطفأً (لا يُفعَّل إلا بقرار G-LIVE مستقل).
 *  • المفتاح السري لا يكون `pk_` والقابل للنشر لا يكون `sk_` (خلط شائع يكشف سرّاً في واجهة عامة).
 * تُستدعى عند الإنشاء/التعديل/التدوير **وعند كل استدعاء شبكي** (دفاع بالعمق ضد صفوف مكتوبة خارج الخدمة).
 * الفحص على البادئة الموثّقة فقط؛ صحة المفتاح الفعلية يثبتها التحقق عبر الـAPI (PAY-H2-01b).
 */
final class MoyasarCredentialPolicy
{
    public const SECRET_TEST = 'sk_test_';

    public const SECRET_LIVE = 'sk_live_';

    public const PUBLISHABLE_TEST = 'pk_test_';

    public const PUBLISHABLE_LIVE = 'pk_live_';

    /** @throws PaymentGatewayException */
    public function assert(string $environment, ?string $publishableKey, ?string $secretKey): void
    {
        $environment = strtolower(trim($environment));
        if ($environment === 'live' && config('payment_providers.moyasar.live_enabled') !== true) {
            throw new PaymentGatewayException(
                'gateway.moyasar_live_not_enabled',
                'بيئة Moyasar الحية غير مفعّلة: الاعتماد الحالي لبيئة Sandbox فقط.'
            );
        }

        $this->assertKey($environment, $secretKey, secret: true);
        $this->assertKey($environment, $publishableKey, secret: false);
    }

    private function assertKey(string $environment, ?string $key, bool $secret): void
    {
        $key = $key === null ? '' : trim($key);
        if ($key === '') {
            return; // مسودة بلا مفتاح بعد
        }

        $wrongKind = $secret ? 'pk_' : 'sk_';
        if (str_starts_with($key, $wrongKind)) {
            throw new PaymentGatewayException(
                'gateway.moyasar_key_type_mismatch',
                $secret ? 'حقل المفتاح السري يحمل مفتاحاً قابلاً للنشر.' : 'حقل المفتاح القابل للنشر يحمل مفتاحاً سرّياً.'
            );
        }

        $test = $secret ? self::SECRET_TEST : self::PUBLISHABLE_TEST;
        $live = $secret ? self::SECRET_LIVE : self::PUBLISHABLE_LIVE;
        $expected = $environment === 'live' ? $live : $test;
        $opposite = $environment === 'live' ? $test : $live;

        if (str_starts_with($key, $opposite)) {
            throw new PaymentGatewayException(
                $environment === 'live' ? 'gateway.moyasar_test_key_in_live' : 'gateway.moyasar_live_key_in_sandbox',
                $environment === 'live' ? 'مفتاح تجريبي في بيئة حية.' : 'مفتاح حي (live) مرفوض في بيئة Sandbox.'
            );
        }
        if (! str_starts_with($key, $expected)) {
            throw new PaymentGatewayException('gateway.moyasar_invalid_key_format', 'صيغة مفتاح Moyasar غير معروفة.');
        }
    }
}
