<?php

namespace App\Services\Commerce;

use App\Models\PaymentGateway;
use App\Models\PaymentMethod;
use App\Models\SalesChannel;
use App\Services\OnlinePaymentMethodSettingsService;
use App\Services\PaymentMethodChannelAvailabilityService;

/**
 * ═══════════════════════════════════════════════════════════════
 *  وسائل الدفع الإلكتروني في Checkout المتجر — Beta (mada/Visa/Mastercard/Apple Pay)
 * ═══════════════════════════════════════════════════════════════
 *  يجسّر بين إعداد التاجر (`OnlinePaymentMethodSettingsService`: `enabled`/`ready`) ومسار الدفع القائم (`PaymentMethod` المرتبطة ببوابة)؛ **لا يخلق مساراً موازياً**:
 *  الوسيلة الجاهزة تُحلّ إلى `PaymentMethod` موجودة ثم يكمل `PATCH checkout/payment` → `complete` → `payment-intent` كما هي، بكل فحوصها.
 *
 *  • **المعروضة** = ما فعّله التاجر (`enabled`) حتى لو لم تجهز بوابة؛ بلا مفعَّلة ⇒ لا مفتاح في الاستجابة ويبقى شكلها حرفياً كما كان.
 *  • **الجاهزة (`ready`)** = كل ما يلي معاً: مفعَّلة؛ اتصال بوابة جاهز يعلنها (نشط، متحقَّق، لا إعداد مزوّد غير قابل للتحقق)؛ بوابة المنصة للدفع الإلكتروني مفتوحة؛
 *    ذلك الاتصال مرتبط بطريقة دفع نشطة متاحة لهذه القناة، ويقبل المنسّق بدء محاولة عليه (`usableGatewayFor`). غياب أي شرط ⇒ غير جاهزة.
 *  • **غير الجاهزة لا تُنشئ شيئاً:** `resolveReady()` يعيد null فيرفض المتحكّم الاختيار قبل أي كتابة؛ لا طلب، لا نية، لا محاولة، لا سند، لا قيد.
 *  • لا تعتبر شعارات التذييل دليل جاهزية: هذه الفئة لا تقرأها إطلاقاً.
 */
final class StorefrontOnlineMethodResolver
{
    public function __construct(
        private readonly OnlinePaymentMethodSettingsService $settings,
        private readonly PaymentMethodChannelAvailabilityService $availability,
        private readonly CommerceOnlinePaymentService $online,
    ) {}

    /**
     * @return list<array{key: string, ready: bool, payment_method_id: string|null}>
     */
    public function forChannel(SalesChannel $channel): array
    {
        $out = [];
        foreach ($this->settings->enabledRows() as $row) {
            $method = $this->readyMethod($row, $channel);
            $out[] = [
                'key' => (string) $row['key'],
                'ready' => $method !== null,
                'payment_method_id' => $method?->id,
            ];
        }

        return $out;
    }

    /** طريقة الدفع القابلة للتحصيل الآن للوسيلة؛ null ⇒ غير مفعَّلة أو غير جاهزة. */
    public function resolveReady(string $key, SalesChannel $channel): ?PaymentMethod
    {
        foreach ($this->settings->enabledRows() as $row) {
            if ($row['key'] === $key) {
                return $this->readyMethod($row, $channel);
            }
        }

        return null;
    }

    /** @param array<string, mixed> $row صف `overview()` */
    private function readyMethod(array $row, SalesChannel $channel): ?PaymentMethod
    {
        if ($row['ready'] !== true || ! CommerceOnlinePaymentService::enabled()) {
            return null;
        }
        foreach ($row['connections'] as $connection) {
            if ($connection['eligible'] !== true) {
                continue;
            }
            $gateway = PaymentGateway::query()->find($connection['gateway_id']);
            if ($gateway === null || $gateway->payment_method_id === null) {
                continue;
            }
            $method = PaymentMethod::query()->where('is_active', true)->find($gateway->payment_method_id);
            if ($method === null || ! $this->availability->isAvailable($method, $channel)) {
                continue;
            }
            if ($this->online->usableGatewayFor($method)?->getKey() === $gateway->getKey()) {
                return $method;
            }
        }

        return null;
    }
}
