<?php

namespace App\Services\Payments;

use App\Contracts\Payments\GatewayAdapter;
use App\Models\PaymentGateway;
use App\Support\Payments\AttemptContext;
use App\Support\Payments\GatewayCapabilities;
use App\Support\Payments\HostedCheckout;
use App\Support\Payments\ProviderPaymentSnapshot;
use Carbon\CarbonImmutable;
use RuntimeException;

/**
 * محوّل وهمي حتمي للاختبار: لا شبكة ولا أموال حقيقية. يُحلّ من `GatewayAdapterRegistry` في `local`/`testing` فقط.
 * يسجّل الاستدعاءات ويسمح بحقن الأعطال وبرمجة لقطات المزوّد (بما فيها الخارجة عن الترتيب) — لا يزيّف اعتماداً حقيقياً.
 */
final class FakeGatewayAdapter implements GatewayAdapter
{
    public const PROVIDER = 'fake';

    /** @var list<array{attempt_id: string, amount_minor: int, currency: string, payable_key: string}> */
    public array $checkoutCalls = [];

    /** @var array<string, array{amount_minor: int, currency: string}> */
    private array $payments = [];

    /** @var array<string, ProviderPaymentSnapshot> */
    private array $snapshots = [];

    private int $failCheckouts = 0;

    private ?\Throwable $fetchFailure = null;

    public function provider(): string
    {
        return self::PROVIDER;
    }

    public function capabilities(): GatewayCapabilities
    {
        return new GatewayCapabilities(true, ['SAR']);
    }

    public function createCheckout(AttemptContext $context): HostedCheckout
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

        return new HostedCheckout($id, 'https://fake-checkout.invalid/pay/'.$context->attemptId, CarbonImmutable::now('UTC')->addMinutes(30));
    }

    public function fetchPayment(PaymentGateway $gateway, string $providerPaymentId): ProviderPaymentSnapshot
    {
        if ($this->fetchFailure !== null) {
            throw $this->fetchFailure;
        }

        if (isset($this->snapshots[$providerPaymentId])) {
            return $this->snapshots[$providerPaymentId];
        }

        $known = $this->payments[$providerPaymentId] ?? ['amount_minor' => 0, 'currency' => 'SAR'];

        return new ProviderPaymentSnapshot($providerPaymentId, 'pending_customer', $known['amount_minor'], $known['currency']);
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
        $this->snapshots[$providerPaymentId] = new ProviderPaymentSnapshot(
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
