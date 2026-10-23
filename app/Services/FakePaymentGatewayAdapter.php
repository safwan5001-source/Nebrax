<?php

namespace App\Services;

use App\Contracts\GatewayAdapter;
use App\Models\PaymentGateway;
use App\Support\PaymentAttemptContext;
use App\Support\PaymentGatewayCapabilities;
use App\Support\PaymentHostedCheckout;
use App\Support\InvalidPaymentWebhookException;
use App\Support\PaymentProviderSnapshot;
use App\Support\PaymentRawWebhook;
use App\Support\PaymentVerifiedWebhook;
use Carbon\CarbonImmutable;
use RuntimeException;

/**
 * محوّل وهمي حتمي للاختبار: لا شبكة ولا أموال حقيقية. يُحلّ من `PaymentGatewayAdapterRegistry` في `local`/`testing` فقط.
 * يسجّل الاستدعاءات ويسمح بحقن الأعطال وبرمجة لقطات المزوّد (بما فيها الخارجة عن الترتيب) — لا يزيّف اعتماداً حقيقياً.
 */
final class FakePaymentGatewayAdapter implements GatewayAdapter
{
    public const PROVIDER = 'fake';

    /** @var list<array{attempt_id: string, amount_minor: int, currency: string, payable_key: string}> */
    public array $checkoutCalls = [];

    /** @var array<string, array{amount_minor: int, currency: string}> */
    private array $payments = [];

    /** @var array<string, PaymentProviderSnapshot> */
    private array $snapshots = [];

    /** يُنفَّذ داخل `createCheckout` بعد تسجيل الدفعة وقبل الإرجاع — يحاكي سباقاً (إلغاء) أثناء استدعاء المزوّد. */
    public ?\Closure $onCheckout = null;

    /** عدد استعلامات `fetchPayment` (يثبت أن الحدث/المطابِق يستعلمان المزوّد ولا يصدّقان الجسم). */
    public int $fetchCount = 0;

    private int $failCheckouts = 0;

    private ?\Throwable $fetchFailure = null;

    public function provider(): string
    {
        return self::PROVIDER;
    }

    public function capabilities(): PaymentGatewayCapabilities
    {
        return new PaymentGatewayCapabilities(true, ['SAR']);
    }

    public function createCheckout(PaymentAttemptContext $context): PaymentHostedCheckout
    {
        $this->checkoutCalls[] = [
            'attempt_id' => $context->attemptId,
            'amount_minor' => $context->amountMinor,
            'currency' => $context->currency,
            'payable_key' => $context->payableKey,
        ];

        if ($this->failCheckouts > 0) {
            $this->failCheckouts--;
            throw new RuntimeException('fake provider outage');
        }

        $id = 'fake_'.$context->attemptId; // نفس المحاولة ⇒ نفس المرجع (idempotent عند المزوّد)
        $this->payments[$id] = ['amount_minor' => $context->amountMinor, 'currency' => $context->currency];
        if ($this->onCheckout !== null) {
            ($this->onCheckout)($context);
        }

        return new PaymentHostedCheckout($id, 'https://fake-checkout.invalid/pay/'.$context->attemptId, CarbonImmutable::now('UTC')->addMinutes(30));
    }

    public function fetchPayment(PaymentGateway $gateway, string $providerPaymentId): PaymentProviderSnapshot
    {
        $this->fetchCount++;

        if ($this->fetchFailure !== null) {
            throw $this->fetchFailure;
        }

        if (isset($this->snapshots[$providerPaymentId])) {
            return $this->snapshots[$providerPaymentId];
        }

        $known = $this->payments[$providerPaymentId] ?? ['amount_minor' => 0, 'currency' => 'SAR'];

        return new PaymentProviderSnapshot($providerPaymentId, 'pending_customer', $known['amount_minor'], $known['currency']);
    }

    /** توقيع حتمي للاختبار: HMAC-SHA256 للجسم الخام بأحد أسرار الـwebhook، في ترويسة `x-fake-signature`. الجسم JSON `{id, type, payment_id}`. */
    public function verifyWebhook(PaymentGateway $gateway, PaymentRawWebhook $webhook): PaymentVerifiedWebhook
    {
        $signature = (string) $webhook->header('x-fake-signature');
        $valid = false;
        foreach ($gateway->webhookSecretsForVerification() as $secret) {
            $valid = hash_equals(hash_hmac('sha256', $webhook->body, $secret), $signature) || $valid;
        }
        if (! $valid) {
            throw new InvalidPaymentWebhookException('signature');
        }

        $data = json_decode($webhook->body, true);
        if (! is_array($data) || ! is_string($data['id'] ?? null) || $data['id'] === '') {
            throw new InvalidPaymentWebhookException('malformed');
        }

        return new PaymentVerifiedWebhook(
            $data['id'],
            is_string($data['type'] ?? null) ? $data['type'] : null,
            is_string($data['payment_id'] ?? null) ? $data['payment_id'] : null,
        );
    }

    public static function sign(string $body, string $secret): string
    {
        return hash_hmac('sha256', $body, $secret);
    }

    // ───────────── أدوات الاختبار ─────────────

    public function failNextCheckouts(int $times = 1): void
    {
        $this->failCheckouts = $times;
    }

    public function failFetchWith(?\Throwable $failure): void
    {
        $this->fetchFailure = $failure;
    }

    /** يبرمج ما سيعيده المزوّد عن هذه الدفعة (آخر برمجة تغلب). المبلغ/العملة الافتراضيان من إنشاء الصفحة. */
    public function script(string $providerPaymentId, string $status, ?int $capturedMinor = null, ?int $amountMinor = null, ?string $currency = null, ?string $failureCode = null): void
    {
        $known = $this->payments[$providerPaymentId] ?? ['amount_minor' => 0, 'currency' => 'SAR'];
        $amount = $amountMinor ?? $known['amount_minor'];
        $this->snapshots[$providerPaymentId] = new PaymentProviderSnapshot(
            $providerPaymentId,
            $status,
            $amount,
            $currency ?? $known['currency'],
            $capturedMinor ?? ($status === 'captured' ? $amount : 0),
            $status === 'captured' ? CarbonImmutable::now('UTC') : null,
            $failureCode,
        );
    }
}
