<?php

namespace App\Services;

use App\Contracts\GatewayAdapter;
use App\Contracts\RefundsPayments;
use App\Models\PaymentGateway;
use App\Support\PaymentAttemptContext;
use App\Support\PaymentGatewayCapabilities;
use App\Support\PaymentHostedCheckout;
use App\Support\InvalidPaymentWebhookException;
use App\Support\PaymentProviderRefund;
use App\Support\PaymentProviderSnapshot;
use App\Support\PaymentRefundRejectedException;
use App\Support\PaymentRefundUnknownException;
use App\Support\PaymentRawWebhook;
use App\Support\PaymentVerifiedWebhook;
use Carbon\CarbonImmutable;
use RuntimeException;

/**
 * محوّل وهمي حتمي للاختبار: لا شبكة ولا أموال حقيقية. يُحلّ من `PaymentGatewayAdapterRegistry` في `local`/`testing` فقط.
 * يسجّل الاستدعاءات ويسمح بحقن الأعطال وبرمجة لقطات المزوّد (بما فيها الخارجة عن الترتيب) — لا يزيّف اعتماداً حقيقياً.
 */
final class FakePaymentGatewayAdapter implements GatewayAdapter, RefundsPayments
{
    public const PROVIDER = 'fake';

    /** @var list<array{attempt_id: string, amount_minor: int, currency: string, payable_key: string, return_url: ?string}> */
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

    /** @var list<array{provider_payment_id: string, amount_minor: int}> كل استدعاء `refundPayment` (بما فيه الفاشل) — يثبت عدم الإرسال المزدوج. */
    public array $refundCalls = [];

    /** @var array<string, int> المسترد التراكمي لكل دفعة لدى «المزوّد» (حقيقته؛ يقرؤه `fetchPayment`). */
    private array $refunded = [];

    /** طابور أعطال الاسترداد: `rejected` (لم يُنفَّذ) · `unknown_not_applied` (انقطع ولم يُنفَّذ) · `unknown_applied` (انقطع بعد التنفيذ). */
    private array $refundFailures = [];

    private ?\Throwable $fetchFailure = null;

    public function provider(): string
    {
        return self::PROVIDER;
    }

    public function capabilities(): PaymentGatewayCapabilities
    {
        return new PaymentGatewayCapabilities(true, ['SAR'], 1, true, ['mada', 'visa', 'mastercard', 'apple_pay'], ['apple_pay']);
    }

    public function createCheckout(PaymentAttemptContext $context): PaymentHostedCheckout
    {
        $this->checkoutCalls[] = [
            'attempt_id' => $context->attemptId,
            'amount_minor' => $context->amountMinor,
            'currency' => $context->currency,
            'payable_key' => $context->payableKey,
            'return_url' => $context->returnUrl,
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
            return $this->withRefunded($this->snapshots[$providerPaymentId]);
        }

        $known = $this->payments[$providerPaymentId] ?? ['amount_minor' => 0, 'currency' => 'SAR'];

        return $this->withRefunded(new PaymentProviderSnapshot($providerPaymentId, 'pending_customer', $known['amount_minor'], $known['currency']));
    }

    /**
     * استرداد وهمي حتمي: يراكم `refunded` ويرفض ما يتجاوز المبلغ الملتقط. يحاكي الأعطال بالطابور: `rejected` لا يُنفَّذ، `unknown_not_applied` ينقطع قبل
     * التنفيذ، `unknown_applied` ينفَّذ ثم ينقطع الردّ (الحالة الخطرة التي يحسمها المطابِق بالتراكمي). لا idempotency (كالمزوّد الحقيقي).
     */
    public function refundPayment(PaymentGateway $gateway, string $providerPaymentId, int $amountMinor): PaymentProviderRefund
    {
        $this->refundCalls[] = ['provider_payment_id' => $providerPaymentId, 'amount_minor' => $amountMinor];

        $failure = array_shift($this->refundFailures);
        if ($failure === 'rejected') {
            throw new PaymentRefundRejectedException('fake.refund_rejected', 'رفض المزوّد الوهمي الاسترداد.');
        }
        if ($failure === 'unknown_not_applied') {
            throw new PaymentRefundUnknownException('fake.unavailable', 'انقطاع المزوّد الوهمي قبل التنفيذ.');
        }

        $snapshot = $this->fetchSnapshotFor($providerPaymentId);
        $available = $snapshot->capturedMinor - ($this->refunded[$providerPaymentId] ?? 0);
        if ($amountMinor <= 0 || $amountMinor > $available) {
            throw new PaymentRefundRejectedException('fake.refund_exceeds_available', 'الاسترداد يتجاوز المتاح لدى المزوّد الوهمي.');
        }

        $this->refunded[$providerPaymentId] = ($this->refunded[$providerPaymentId] ?? 0) + $amountMinor;

        if ($failure === 'unknown_applied') {
            throw new PaymentRefundUnknownException('fake.unavailable', 'انقطع ردّ المزوّد الوهمي بعد التنفيذ.');
        }

        return new PaymentProviderRefund($providerPaymentId, $this->refunded[$providerPaymentId], $snapshot->currency, CarbonImmutable::now('UTC'));
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

    /** @param  'rejected'|'unknown_not_applied'|'unknown_applied'  $kind */
    public function failNextRefund(string $kind): void
    {
        $this->refundFailures[] = $kind;
    }

    /** يحاكي استرداداً خارجياً (من لوحة المزوّد) رفع المسترد التراكمي دون علم أَوْج. */
    public function scriptRefunded(string $providerPaymentId, int $refundedMinor): void
    {
        $this->refunded[$providerPaymentId] = $refundedMinor;
    }

    private function fetchSnapshotFor(string $providerPaymentId): PaymentProviderSnapshot
    {
        return $this->snapshots[$providerPaymentId]
            ?? new PaymentProviderSnapshot($providerPaymentId, 'pending_customer', ($this->payments[$providerPaymentId]['amount_minor'] ?? 0), ($this->payments[$providerPaymentId]['currency'] ?? 'SAR'));
    }

    private function withRefunded(PaymentProviderSnapshot $snapshot): PaymentProviderSnapshot
    {
        $refunded = $this->refunded[$snapshot->providerPaymentId] ?? 0;

        return $refunded === $snapshot->refundedMinor ? $snapshot : new PaymentProviderSnapshot(
            $snapshot->providerPaymentId, $snapshot->status, $snapshot->amountMinor, $snapshot->currency,
            $snapshot->capturedMinor, $snapshot->capturedAt, $snapshot->failureCode, $refunded,
        );
    }

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
