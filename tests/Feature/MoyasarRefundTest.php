<?php

namespace Tests\Feature;

use App\Models\PaymentGateway;
use App\Models\Tenant;
use App\Services\FakePaymentGatewayAdapter;
use App\Services\MoyasarAdapter;
use App\Services\PaymentGatewayAdapterRegistry;
use App\Support\PaymentProviderRefund;
use App\Support\PaymentRefundRejectedException;
use App\Support\PaymentRefundUnknownException;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Http\Client\Factory as HttpFactory;
use Illuminate\Http\Client\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\Attributes\Test;
use Tests\TestCase;

/**
 * PAY-H3-01a — عقد استرداد المحوّل (ADR-0007): Moyasar بـFixtures وفق وثائقه الرسمية (`POST /payments/{id}/refund`، `refunded` تراكمي، لا idempotency)،
 * والمحوّل الوهمي، والتفريق القاطع بين «رُفض (لم يُنفَّذ)» و«غير معروف (قد نُفِّذ)». لا محاسبة هنا إطلاقاً؛ الدفعة الحقيقية تنتظر EXT-01.
 */
class MoyasarRefundTest extends TestCase
{
    use CapturesThrowable;
    use RefreshDatabase;

    private const PAYMENT_ID = 'a1b2c3d4-0000-4000-8000-000000000001';

    private PaymentGateway $gateway;

    private MoyasarAdapter $adapter;

    protected function setUp(): void
    {
        parent::setUp();
        config(['payment_providers.moyasar.retry_sleep_ms' => 0]);
        $tenant = Tenant::create(['name' => 'استرداد ميسّر', 'slug' => 'pay-h3-01a', 'vat_number' => '300000000000013', 'currency' => 'SAR']);
        app(TenantContext::class)->set($tenant->id);
        $gateway = PaymentGateway::query()->create([
            'provider' => 'moyasar', 'name' => 'Moyasar Sandbox', 'environment' => 'sandbox',
            'secret_key' => MoyasarFixtures::SECRET_KEY, 'publishable_key' => MoyasarFixtures::PUBLISHABLE_KEY, 'webhook_secret' => MoyasarFixtures::WEBHOOK_SECRET,
        ]);
        DB::table('payment_gateways')->where('id', $gateway->id)->update(['status' => PaymentGateway::STATUS_ACTIVE, 'is_active' => true, 'verified_at' => now()]);
        $this->gateway = $gateway->fresh();
        $this->adapter = app(MoyasarAdapter::class);
    }

    #[Test]
    public function a_partial_refund_posts_the_amount_and_returns_the_cumulative_refunded_from_the_provider(): void
    {
        $posts = [];
        $this->fakeHttp([
            'api.moyasar.com/v1/invoices/*' => Http::response($this->invoiceWith($this->paid())),
            'api.moyasar.com/v1/payments/*' => function (Request $request) use (&$posts) {
                $posts[] = $request;

                return Http::response($this->paid(refunded: 40000, status: 'refunded', refundedAt: '2026-10-23T12:00:00.000Z'));
            },
        ]);

        $result = $this->adapter->refundPayment($this->gateway, MoyasarFixtures::INVOICE_ID, 40000);

        $this->assertInstanceOf(PaymentProviderRefund::class, $result);
        $this->assertSame(self::PAYMENT_ID, $result->providerPaymentId);
        $this->assertSame(40000, $result->refundedMinor);
        $this->assertSame('SAR', $result->currency);
        $this->assertSame('2026-10-23 12:00:00', $result->refundedAt?->format('Y-m-d H:i:s'));
        $this->assertCount(1, $posts);
        $this->assertSame('POST', $posts[0]->method());
        $this->assertStringEndsWith('/v1/payments/'.self::PAYMENT_ID.'/refund', $posts[0]->url());
        $this->assertSame(['amount' => 40000], $posts[0]->data());
        $this->assertSame('Basic '.base64_encode(MoyasarFixtures::SECRET_KEY.':'), $posts[0]->header('Authorization')[0]);
    }

    #[Test]
    public function a_second_partial_refund_is_capped_by_what_remains_at_the_provider(): void
    {
        $this->fakeHttp(['api.moyasar.com/v1/invoices/*' => Http::response($this->invoiceWith($this->paid(refunded: 40000, status: 'refunded')))]);

        // المتاح 115000 − 40000 = 75000؛ 75001 يُرفض قبل أي إرسال.
        $e = $this->thrown(fn () => $this->adapter->refundPayment($this->gateway, MoyasarFixtures::INVOICE_ID, 75001), 'exceeds', PaymentRefundRejectedException::class);
        $this->assertSame('moyasar.refund_exceeds_available', $e->reason);
        Http::assertNotSent(fn (Request $r) => $r->method() === 'POST');

        $this->fakeHttp([
            'api.moyasar.com/v1/invoices/*' => Http::response($this->invoiceWith($this->paid(refunded: 40000, status: 'refunded'))),
            'api.moyasar.com/v1/payments/*' => Http::response($this->paid(refunded: 115000, status: 'refunded')),
        ]);
        $this->assertSame(115000, $this->adapter->refundPayment($this->gateway, MoyasarFixtures::INVOICE_ID, 75000)->refundedMinor);
    }

    #[Test]
    public function the_captured_amount_not_the_charged_amount_bounds_a_partially_captured_payment(): void
    {
        $this->fakeHttp(['api.moyasar.com/v1/invoices/*' => Http::response($this->invoiceWith(array_merge($this->paid(), ['captured' => 60000])))]);

        $e = $this->thrown(fn () => $this->adapter->refundPayment($this->gateway, MoyasarFixtures::INVOICE_ID, 60001), 'captured cap', PaymentRefundRejectedException::class);
        $this->assertSame('moyasar.refund_exceeds_available', $e->reason);
    }

    #[Test]
    public function a_malformed_captured_value_is_rejected_before_any_post_and_fails_the_snapshot_read(): void
    {
        foreach (['invalid', -5, '', [], 1.5] as $bad) {
            $this->fakeHttp(['api.moyasar.com/v1/invoices/*' => Http::response($this->invoiceWith(array_merge($this->paid(), ['captured' => $bad])))]);
            $e = $this->thrown(fn () => $this->adapter->refundPayment($this->gateway, MoyasarFixtures::INVOICE_ID, 100), 'bad captured', PaymentRefundRejectedException::class);
            $this->assertSame('moyasar.malformed_response', $e->reason);
            Http::assertNotSent(fn (Request $r) => $r->method() === 'POST');

            $this->thrown(fn () => $this->adapter->fetchPayment($this->gateway, MoyasarFixtures::INVOICE_ID), 'bad captured snapshot', \App\Support\PaymentGatewayException::class);
        }
    }

    #[Test]
    public function a_non_scalar_currency_is_a_definite_rejection_before_and_unknown_after_the_post(): void
    {
        foreach ([['SAR'], new \stdClass, 123] as $bad) {
            $this->fakeHttp(['api.moyasar.com/v1/invoices/*' => Http::response($this->invoiceWith(array_merge($this->paid(), ['currency' => $bad])))]);
            $e = $this->thrown(fn () => $this->adapter->refundPayment($this->gateway, MoyasarFixtures::INVOICE_ID, 100), 'bad pre currency', PaymentRefundRejectedException::class);
            $this->assertSame('moyasar.malformed_response', $e->reason);
            Http::assertNotSent(fn (Request $r) => $r->method() === 'POST');

            $this->fakeHttp([
                'api.moyasar.com/v1/invoices/*' => Http::response($this->invoiceWith($this->paid())),
                'api.moyasar.com/v1/payments/*' => Http::response(array_merge($this->paid(refunded: 100, status: 'refunded'), ['currency' => $bad])),
            ]);
            $e = $this->thrown(fn () => $this->adapter->refundPayment($this->gateway, MoyasarFixtures::INVOICE_ID, 100), 'bad post currency', PaymentRefundUnknownException::class);
            $this->assertSame('moyasar.malformed_response', $e->reason);
        }
    }

    #[Test]
    public function a_non_string_payment_status_is_a_definite_rejection_before_any_post_and_fails_the_snapshot_read(): void
    {
        foreach ([['paid'], new \stdClass, 7] as $bad) {
            $this->fakeHttp(['api.moyasar.com/v1/invoices/*' => Http::response($this->invoiceWith(array_merge($this->paid(), ['status' => $bad])))]);
            $e = $this->thrown(fn () => $this->adapter->refundPayment($this->gateway, MoyasarFixtures::INVOICE_ID, 100), 'bad status', PaymentRefundRejectedException::class);
            $this->assertSame('moyasar.malformed_response', $e->reason);
            Http::assertNotSent(fn (Request $r) => $r->method() === 'POST');

            $this->thrown(fn () => $this->adapter->fetchPayment($this->gateway, MoyasarFixtures::INVOICE_ID), 'bad status snapshot', \App\Support\PaymentGatewayException::class);
        }
    }

    #[Test]
    public function a_malformed_payments_entry_or_a_foreign_invoice_payment_is_rejected_before_any_post(): void
    {
        $cases = [
            'scalar entry' => [$this->paid(), 'x'],
            'null entry' => [$this->paid(), null],
        ];
        foreach ($cases as $label => $payments) {
            $this->fakeHttp(['api.moyasar.com/v1/invoices/*' => Http::response(MoyasarFixtures::invoice('paid', 11500, $payments))]);
            $e = $this->thrown(fn () => $this->adapter->refundPayment($this->gateway, MoyasarFixtures::INVOICE_ID, 100), $label, PaymentRefundRejectedException::class);
            $this->assertSame('moyasar.malformed_response', $e->reason, $label);
            Http::assertNotSent(fn (Request $r) => $r->method() === 'POST');
        }

        foreach (['another-invoice-id', null, ['x']] as $foreign) {
            $this->fakeHttp(['api.moyasar.com/v1/invoices/*' => Http::response($this->invoiceWith(array_merge($this->paid(), ['invoice_id' => $foreign])))]);
            $e = $this->thrown(fn () => $this->adapter->refundPayment($this->gateway, MoyasarFixtures::INVOICE_ID, 100), 'foreign payment', PaymentRefundRejectedException::class);
            $this->assertSame('moyasar.reference_mismatch', $e->reason);
            Http::assertNotSent(fn (Request $r) => $r->method() === 'POST');
        }
    }

    #[Test]
    public function a_response_total_beyond_the_captured_amount_is_unknown_not_proof(): void
    {
        $partial = array_merge($this->paid(), ['captured' => 60000]);
        $this->fakeHttp([
            'api.moyasar.com/v1/invoices/*' => Http::response($this->invoiceWith($partial)),
            'api.moyasar.com/v1/payments/*' => Http::response(array_merge($partial, ['refunded' => 80000, 'status' => 'refunded'])),
        ]);

        $e = $this->thrown(fn () => $this->adapter->refundPayment($this->gateway, MoyasarFixtures::INVOICE_ID, 100), 'over captured', PaymentRefundUnknownException::class);
        $this->assertSame('moyasar.malformed_response', $e->reason);
    }

    #[Test]
    public function an_invalid_amount_and_an_unpaid_or_ambiguous_invoice_are_definite_rejections_before_any_post(): void
    {
        $this->fakeHttp(['api.moyasar.com/v1/invoices/*' => Http::response($this->invoiceWith($this->paid()))]);
        $e = $this->thrown(fn () => $this->adapter->refundPayment($this->gateway, MoyasarFixtures::INVOICE_ID, 0), 'zero', PaymentRefundRejectedException::class);
        $this->assertSame('moyasar.invalid_refund_amount', $e->reason);

        $this->fakeHttp(['api.moyasar.com/v1/invoices/*' => Http::response($this->invoiceWith(MoyasarFixtures::payment('failed', 11500, self::PAYMENT_ID)))]);
        $e = $this->thrown(fn () => $this->adapter->refundPayment($this->gateway, MoyasarFixtures::INVOICE_ID, 100), 'no paid', PaymentRefundRejectedException::class);
        $this->assertSame('moyasar.no_paid_payment', $e->reason);

        $this->fakeHttp(['api.moyasar.com/v1/invoices/*' => Http::response(MoyasarFixtures::invoice('paid', 11500, [
            $this->paid(), $this->paid(id: 'a1b2c3d4-0000-4000-8000-000000000002'),
        ]))]);
        $e = $this->thrown(fn () => $this->adapter->refundPayment($this->gateway, MoyasarFixtures::INVOICE_ID, 100), 'ambiguous', PaymentRefundRejectedException::class);
        $this->assertSame('moyasar.ambiguous_payment', $e->reason);
        Http::assertNotSent(fn (Request $r) => $r->method() === 'POST');
    }

    #[Test]
    public function an_invoice_with_another_id_is_a_reference_mismatch_and_nothing_is_sent(): void
    {
        $this->fakeHttp(['api.moyasar.com/v1/invoices/*' => Http::response(MoyasarFixtures::invoice('paid', 11500, [$this->paid()], id: 'other-invoice'))]);

        $e = $this->thrown(fn () => $this->adapter->refundPayment($this->gateway, MoyasarFixtures::INVOICE_ID, 100), 'mismatch', PaymentRefundRejectedException::class);
        $this->assertSame('moyasar.reference_mismatch', $e->reason);
        Http::assertNotSent(fn (Request $r) => $r->method() === 'POST');
    }

    /** @param  class-string<\Throwable>  $class */
    #[Test]
    #[DataProvider('postFailures')]
    public function a_post_failure_is_classified_as_rejected_or_unknown_and_is_never_retried(int|string $outcome, string $class, string $reason): void
    {
        $posts = 0;
        $this->fakeHttp([
            'api.moyasar.com/v1/invoices/*' => Http::response($this->invoiceWith($this->paid())),
            'api.moyasar.com/v1/payments/*' => function () use (&$posts, $outcome) {
                $posts++;
                if ($outcome === 'connection') {
                    throw new ConnectionException('boom');
                }

                return Http::response($outcome === 'badjson' ? 'not json' : ['message' => 'x'], $outcome === 'badjson' ? 200 : (int) $outcome);
            },
        ]);

        $e = $this->thrown(fn () => $this->adapter->refundPayment($this->gateway, MoyasarFixtures::INVOICE_ID, 100), 'post failure', $class);
        $this->assertSame($reason, $e->reason);
        $this->assertSame(1, $posts, 'POST الاسترداد لا يُعاد تلقائياً أبداً');
        $this->assertStringNotContainsString(MoyasarFixtures::SECRET_KEY, $e->getMessage());
    }

    /** @return array<string, array{int|string, string, string}> */
    public static function postFailures(): array
    {
        return [
            '400 رفض أعمال' => [400, PaymentRefundRejectedException::class, 'moyasar.rejected'],
            '401 اعتماد' => [401, PaymentRefundRejectedException::class, 'moyasar.unauthorized'],
            '404 غير موجود' => [404, PaymentRefundRejectedException::class, 'moyasar.not_found'],
            '429 حدّ الطلبات' => [429, PaymentRefundRejectedException::class, 'moyasar.rate_limited'],
            '500 بعد الإرسال' => [500, PaymentRefundUnknownException::class, 'moyasar.unavailable'],
            '503 بعد الإرسال' => [503, PaymentRefundUnknownException::class, 'moyasar.unavailable'],
            'انقطاع/مهلة' => ['connection', PaymentRefundUnknownException::class, 'moyasar.unavailable'],
            '200 بجسم غير JSON' => ['badjson', PaymentRefundUnknownException::class, 'moyasar.malformed_response'],
        ];
    }

    #[Test]
    public function a_success_response_that_is_not_for_this_payment_or_lacks_the_cumulative_refunded_is_unknown_not_assumed(): void
    {
        foreach ([
            array_merge($this->paid(refunded: 100), ['id' => 'someone-else']),
            array_diff_key($this->paid(refunded: 100), ['refunded' => 1]),
            $this->paid(refunded: 999999),   // تراكمي يتجاوز مبلغ الدفعة
            $this->paid(refunded: 0),        // 2xx لا يثبت التطبيق (التراكمي لم يتقدّم)
            $this->paid(refunded: -5),       // سالب معيب: لا يتسرّب كاستثناء خارج العقد
        ] as $response) {
            $this->fakeHttp([
                'api.moyasar.com/v1/invoices/*' => Http::response($this->invoiceWith($this->paid())),
                'api.moyasar.com/v1/payments/*' => Http::response($response),
            ]);
            $e = $this->thrown(fn () => $this->adapter->refundPayment($this->gateway, MoyasarFixtures::INVOICE_ID, 100), 'malformed ok', PaymentRefundUnknownException::class);
            $this->assertSame('moyasar.malformed_response', $e->reason);
        }
    }

    #[Test]
    public function a_response_must_prove_the_cumulative_advanced_by_at_least_the_requested_amount(): void
    {
        // قبل: 40000. طلب 10000. ردّ بـ40000 (لم يتقدّم) أو 49999 (أقل من المتوقع) ⇒ غير معروف؛ 50000 أو أكثر (استرداد خارجي متزامن) ⇒ نجاح.
        foreach ([[40000, false], [49999, false], [50000, true], [52000, true]] as [$after, $ok]) {
            $this->fakeHttp([
                'api.moyasar.com/v1/invoices/*' => Http::response($this->invoiceWith($this->paid(refunded: 40000, status: 'refunded'))),
                'api.moyasar.com/v1/payments/*' => Http::response($this->paid(refunded: $after, status: 'refunded')),
            ]);
            if ($ok) {
                $this->assertSame($after, $this->adapter->refundPayment($this->gateway, MoyasarFixtures::INVOICE_ID, 10000)->refundedMinor);
            } else {
                $this->thrown(fn () => $this->adapter->refundPayment($this->gateway, MoyasarFixtures::INVOICE_ID, 10000), "after {$after}", PaymentRefundUnknownException::class);
            }
        }
    }

    #[Test]
    public function a_malformed_refunded_in_the_snapshot_is_a_failed_read_and_in_the_preflight_a_definite_rejection_before_any_post(): void
    {
        // قراءة (fetchPayment): لا تُطبَّع إلى صفر فتخفي استرداداً حقيقياً من المطابِق — تفشل قراءةً قابلة للإعادة.
        $this->fakeHttp(['api.moyasar.com/v1/invoices/*' => Http::response($this->invoiceWith($this->paid(refunded: -7)))]);
        $e = $this->thrown(fn () => $this->adapter->fetchPayment($this->gateway, MoyasarFixtures::INVOICE_ID), 'snapshot negative', \App\Support\PaymentGatewayException::class);
        $this->assertSame('moyasar.malformed_response', $e->reason);

        // مسترد أكبر من مبلغ الدفعة في اللقطة: لا يُطبَّع إلى «استرداد كامل» (دليل اكتمال زائف للمطابِق).
        $this->fakeHttp(['api.moyasar.com/v1/invoices/*' => Http::response($this->invoiceWith($this->paid(refunded: 999999)))]);
        $e = $this->thrown(fn () => $this->adapter->fetchPayment($this->gateway, MoyasarFixtures::INVOICE_ID), 'snapshot overlarge', \App\Support\PaymentGatewayException::class);
        $this->assertSame('moyasar.malformed_response', $e->reason);

        // دفعة ملتقطة جزئياً: المسترد المقبول يُحدّ بالملتقط الفعلي (60000) لا بمبلغ الشحن (115000).
        $partial = array_merge($this->paid(refunded: 80000), ['captured' => 60000]);
        $this->fakeHttp(['api.moyasar.com/v1/invoices/*' => Http::response($this->invoiceWith($partial))]);
        $e = $this->thrown(fn () => $this->adapter->fetchPayment($this->gateway, MoyasarFixtures::INVOICE_ID), 'above captured', \App\Support\PaymentGatewayException::class);
        $this->assertSame('moyasar.malformed_response', $e->reason);
        $e = $this->thrown(fn () => $this->adapter->refundPayment($this->gateway, MoyasarFixtures::INVOICE_ID, 100), 'preflight above captured', PaymentRefundRejectedException::class);
        $this->assertSame('moyasar.malformed_response', $e->reason);

        // الفحص المسبق: خط الأساس المعيب (سالب أو أكبر من مبلغ الدفعة) ⇒ لا إرسال.
        foreach ([-7, 999999] as $bad) {
            $this->fakeHttp(['api.moyasar.com/v1/invoices/*' => Http::response($this->invoiceWith($this->paid(refunded: $bad)))]);
            $e = $this->thrown(fn () => $this->adapter->refundPayment($this->gateway, MoyasarFixtures::INVOICE_ID, 100), "preflight {$bad}", PaymentRefundRejectedException::class);
            $this->assertSame('moyasar.malformed_response', $e->reason);
            Http::assertNotSent(fn (Request $r) => $r->method() === 'POST');
        }
    }

    #[Test]
    public function a_malformed_currency_on_both_invoice_and_payment_is_rejected_before_any_post(): void
    {
        foreach ([null, '', 'SA', 'SARX', '12$'] as $bad) {
            $payment = $this->paid();
            $payment['currency'] = $bad;
            $invoice = $this->invoiceWith($payment);
            $invoice['currency'] = $bad;
            $this->fakeHttp(['api.moyasar.com/v1/invoices/*' => Http::response($invoice)]);

            $e = $this->thrown(fn () => $this->adapter->refundPayment($this->gateway, MoyasarFixtures::INVOICE_ID, 100), 'currency '.json_encode($bad), PaymentRefundRejectedException::class);
            $this->assertSame('moyasar.malformed_response', $e->reason);
            Http::assertNotSent(fn (Request $r) => $r->method() === 'POST');
        }
    }

    #[Test]
    public function a_success_response_in_another_currency_than_the_payment_is_unknown_not_accepted(): void
    {
        $this->fakeHttp([
            'api.moyasar.com/v1/invoices/*' => Http::response($this->invoiceWith($this->paid())),
            'api.moyasar.com/v1/payments/*' => Http::response(array_merge($this->paid(refunded: 100, status: 'refunded'), ['currency' => 'USD'])),
        ]);

        $e = $this->thrown(fn () => $this->adapter->refundPayment($this->gateway, MoyasarFixtures::INVOICE_ID, 100), 'currency', PaymentRefundUnknownException::class);
        $this->assertSame('moyasar.malformed_response', $e->reason);
    }

    #[Test]
    public function a_failed_invoice_lookup_is_a_definite_rejection_since_nothing_was_sent(): void
    {
        $this->fakeHttp(['api.moyasar.com/v1/invoices/*' => Http::response([], 503)]);

        $e = $this->thrown(fn () => $this->adapter->refundPayment($this->gateway, MoyasarFixtures::INVOICE_ID, 100), 'lookup', PaymentRefundRejectedException::class);
        $this->assertSame('moyasar.unavailable', $e->reason);
        Http::assertNotSent(fn (Request $r) => $r->method() === 'POST');
    }

    #[Test]
    public function a_live_key_in_sandbox_cannot_reach_the_network_even_for_a_refund(): void
    {
        $this->fakeHttp();
        DB::table('payment_gateways')->where('id', $this->gateway->id)->update(['secret_key' => encrypt('sk_live_forged_0001')]);

        $this->thrown(fn () => $this->adapter->refundPayment($this->gateway->fresh(), MoyasarFixtures::INVOICE_ID, 100), 'live key', PaymentRefundRejectedException::class);
        Http::assertNothingSent();
    }

    #[Test]
    public function the_snapshot_carries_the_cumulative_refunded_amount_without_changing_existing_statuses(): void
    {
        $this->fakeHttp(['api.moyasar.com/v1/invoices/*' => Http::response($this->invoiceWith($this->paid(refunded: 40000, status: 'refunded')))]);

        $snapshot = $this->adapter->fetchPayment($this->gateway, MoyasarFixtures::INVOICE_ID);
        $this->assertSame('captured', $snapshot->status, 'دفعة مستردة جزئياً تبقى مُلتقَطة (سلوك H2-01a لم يتغير)');
        $this->assertSame(115000, $snapshot->capturedMinor);
        $this->assertSame(40000, $snapshot->refundedMinor);

        $this->fakeHttp(['api.moyasar.com/v1/invoices/*' => Http::response($this->invoiceWith($this->paid()))]);
        $this->assertSame(0, $this->adapter->fetchPayment($this->gateway, MoyasarFixtures::INVOICE_ID)->refundedMinor);
    }

    #[Test]
    public function capabilities_advertise_refunds_only_where_implemented_and_the_registry_exposes_the_refunder(): void
    {
        $registry = app(PaymentGatewayAdapterRegistry::class);

        $this->assertTrue($this->adapter->capabilities()->refunds);
        $this->assertInstanceOf(MoyasarAdapter::class, $registry->refunder('moyasar'));
        $this->assertInstanceOf(FakePaymentGatewayAdapter::class, $registry->refunder('fake'));
        $this->assertNull($registry->refunder('stripe'));
        $this->assertFalse((new \App\Support\PaymentGatewayCapabilities(true, ['SAR']))->refunds, 'الافتراضي: لا قدرة بلا تنفيذ');
    }

    // ═══════════════ المحوّل الوهمي ═══════════════

    #[Test]
    public function the_fake_adapter_accumulates_refunds_caps_them_and_exposes_the_cumulative_through_fetch(): void
    {
        $fake = $this->fakeAdapterWithCapture('fake-pay-1', 115000);

        $this->assertSame(40000, $fake->refundPayment($this->gateway, 'fake-pay-1', 40000)->refundedMinor);
        $this->assertSame(115000, $fake->refundPayment($this->gateway, 'fake-pay-1', 75000)->refundedMinor);
        $this->assertSame(115000, $fake->fetchPayment($this->gateway, 'fake-pay-1')->refundedMinor);

        $e = $this->thrown(fn () => $fake->refundPayment($this->gateway, 'fake-pay-1', 1), 'over', PaymentRefundRejectedException::class);
        $this->assertSame('fake.refund_exceeds_available', $e->reason);
        $this->assertCount(3, $fake->refundCalls);
    }

    #[Test]
    public function the_fake_adapter_simulates_the_three_failure_shapes_including_applied_then_lost_response(): void
    {
        $fake = $this->fakeAdapterWithCapture('fake-pay-2', 50000);

        $fake->failNextRefund('rejected');
        $this->thrown(fn () => $fake->refundPayment($this->gateway, 'fake-pay-2', 10000), 'rejected', PaymentRefundRejectedException::class);
        $this->assertSame(0, $fake->fetchPayment($this->gateway, 'fake-pay-2')->refundedMinor);

        $fake->failNextRefund('unknown_not_applied');
        $this->thrown(fn () => $fake->refundPayment($this->gateway, 'fake-pay-2', 10000), 'lost before', PaymentRefundUnknownException::class);
        $this->assertSame(0, $fake->fetchPayment($this->gateway, 'fake-pay-2')->refundedMinor);

        // الخطِر: نُفِّذ ثم ضاع الردّ — وحده التراكمي لدى المزوّد يكشفه، فإعادة الإرسال العمياء كانت ستردّ مرتين.
        $fake->failNextRefund('unknown_applied');
        $this->thrown(fn () => $fake->refundPayment($this->gateway, 'fake-pay-2', 10000), 'lost after', PaymentRefundUnknownException::class);
        $this->assertSame(10000, $fake->fetchPayment($this->gateway, 'fake-pay-2')->refundedMinor);
    }

    #[Test]
    public function an_external_refund_raises_the_cumulative_the_provider_reports(): void
    {
        $fake = $this->fakeAdapterWithCapture('fake-pay-3', 50000);
        $fake->scriptRefunded('fake-pay-3', 20000);

        $this->assertSame(20000, $fake->fetchPayment($this->gateway, 'fake-pay-3')->refundedMinor);
    }

    #[Test]
    public function the_refund_layer_never_touches_the_ledger_vouchers_or_documents(): void
    {
        foreach (['app/Contracts/RefundsPayments.php', 'app/Support/PaymentProviderRefund.php', 'app/Support/PaymentRefundRejectedException.php', 'app/Support/PaymentRefundUnknownException.php', 'app/Services/MoyasarAdapter.php', 'app/Services/MoyasarApiClient.php', 'app/Services/FakePaymentGatewayAdapter.php'] as $file) {
            $source = $this->withoutComments((string) file_get_contents(base_path($file)));
            $this->assertDoesNotMatchRegularExpression('/\b(LedgerService|PaymentService|JournalEntry|InvoiceService|CustomerRefund|CreditNote|ZatcaService)\b/', $source, "{$file}: لمس المحاسبة");
        }
    }

    // ═══════════════ مساعدات ═══════════════

    /** @return array<string, mixed> */
    private function paid(int $refunded = 0, string $status = 'paid', string $id = self::PAYMENT_ID, ?string $refundedAt = null): array
    {
        return array_merge(MoyasarFixtures::payment($status === 'refunded' ? 'refunded' : 'paid', 115000, $id), [
            'captured' => 115000,
            'refunded' => $refunded,
            'refunded_at' => $refundedAt,
        ]);
    }

    /** @param  array<string, mixed>  $payment */
    private function invoiceWith(array $payment): array
    {
        return MoyasarFixtures::invoice('paid', 115000, [$payment]);
    }

    private function fakeAdapterWithCapture(string $id, int $amount): FakePaymentGatewayAdapter
    {
        $fake = new FakePaymentGatewayAdapter();
        $fake->script($id, 'captured', $amount, $amount);

        return $fake;
    }

    private function withoutComments(string $php): string
    {
        $out = '';
        foreach (token_get_all($php) as $token) {
            if (is_array($token) && in_array($token[0], [T_COMMENT, T_DOC_COMMENT], true)) {
                continue;
            }
            $out .= is_array($token) ? $token[1] : $token;
        }

        return $out;
    }

    /** @param array<string, mixed> $stubs */
    private function fakeHttp(array $stubs = []): void
    {
        Http::swap(new HttpFactory());
        Http::fake($stubs === [] ? null : $stubs);
    }
}
