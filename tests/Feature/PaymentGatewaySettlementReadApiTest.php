<?php

namespace Tests\Feature;

use App\Models\CashBankAccount;
use App\Models\Invoice;
use App\Models\JournalEntry;
use App\Models\Partner;
use App\Models\Payment;
use App\Models\PaymentGateway;
use App\Models\PaymentGatewaySettlement;
use App\Models\Tenant;
use App\Models\User;
use App\Services\Accounting\CashBankAccountService;
use App\Services\Accounting\ChartOfAccountsSeeder;
use App\Services\Accounting\InvoiceService;
use App\Services\Accounting\PaymentGatewaySettlementService;
use App\Services\Accounting\PaymentService;
use App\Tenancy\TenantContext;
use DomainException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use PHPUnit\Framework\Attributes\Test;
use Tests\TestCase;

/**
 * PAY-H3-02a — واجهة قراءة ومعاينة التسويات: المعاينة لا تكتب شيئاً، وحكمها «قابل للترحيل» يطابق ما يقبله `post()` فعلاً
 * (توازي القواعد)، والفرق غير المفسَّر ظاهر لا مرفوض صامتاً (D-21)، والعزل بين المستأجرين، والصلاحيات.
 */
class PaymentGatewaySettlementReadApiTest extends TestCase
{
    use InteractsWithApi;
    use RefreshDatabase;

    private Tenant $tenant;

    private Partner $customer;

    private string $ownerToken;

    private PaymentGateway $gateway;

    protected function setUp(): void
    {
        parent::setUp();
        $this->tenant = Tenant::create(['name' => 'شركة التسوية', 'slug' => 'pay-h3-02a', 'vat_number' => '300000000000013', 'currency' => 'SAR']);
        app(TenantContext::class)->set($this->tenant->id);
        app(ChartOfAccountsSeeder::class)->seed($this->tenant->id);
        $this->customer = Partner::create(['name' => 'عميل', 'type' => 'customer']);
        $this->gateway = PaymentGateway::create(['provider' => PaymentGateway::PROVIDER_STRIPE, 'name' => 'Stripe', 'secret_key' => 'sk_test_must_not_leak']);
        $owner = User::create(['tenant_id' => $this->tenant->id, 'name' => 'المالك', 'email' => 'o@pay-h3-02a.test', 'password' => 'password123', 'role' => 'owner']);
        $this->ownerToken = $owner->createToken('t')->plainTextToken;
    }

    #[Test]
    public function preview_reports_a_reconciled_settlement_as_postable_and_writes_nothing(): void
    {
        $payment = $this->collect(115000);
        $entries = JournalEntry::query()->count();

        $res = $this->preview($payment, net: 112000, fee: 3000)->assertOk();
        $res->assertJsonPath('data.gross', 115000)->assertJsonPath('data.difference', 0)->assertJsonPath('data.reconciled', true)
            ->assertJsonPath('data.postable', true)->assertJsonPath('data.blockers', [])->assertJsonPath('data.replay', false);

        $this->assertSame($entries, JournalEntry::query()->count());
        $this->assertSame(0, PaymentGatewaySettlement::query()->count());
    }

    #[Test]
    public function an_unexplained_difference_is_visible_and_blocks_posting_without_any_entry(): void
    {
        $payment = $this->collect(115000);

        $res = $this->preview($payment, net: 100000, fee: 2500)->assertOk();
        $res->assertJsonPath('data.difference', 12500)->assertJsonPath('data.reconciled', false)->assertJsonPath('data.postable', false);
        $this->assertContains('unreconciled_difference', collect($res->json('data.blockers'))->pluck('code')->all());
        $this->assertSame(0, PaymentGatewaySettlement::query()->count());
    }

    #[Test]
    public function preview_flags_unauthorised_fee_tax_deductions_and_credits_exactly_as_post_rejects_them(): void
    {
        $payment = $this->collect(115000);
        $bank = $this->mainBank();
        $cases = [
            'fee_tax_not_authorized' => ['net' => 111000, 'fee' => 3000, 'extra' => ['provider_fee_tax' => 1000]],
            'deductions_unsupported' => ['net' => 111000, 'fee' => 3000, 'extra' => ['provider_deductions' => 1000]],
            'credits_unsupported' => ['net' => 113000, 'fee' => 3000, 'extra' => ['provider_credits' => 1000]],
        ];
        foreach ($cases as $code => $case) {
            $res = $this->preview($payment, $case['net'], $case['fee'], $case['extra'])->assertOk();
            $this->assertContains($code, collect($res->json('data.blockers'))->pluck('code')->all(), $code);
            $this->assertFalse($res->json('data.postable'), $code);
            try {
                app(PaymentGatewaySettlementService::class)->post([
                    'payment_gateway_id' => $this->gateway->id, 'cash_bank_account_id' => $bank->id, 'provider_settlement_ref' => "PARITY-{$code}",
                    'net_bank_amount' => $case['net'], 'provider_fee_ex_tax' => $case['fee'],
                    'items' => [['payment_id' => $payment->id, 'gross_amount' => 115000]],
                ] + $case['extra']);
                $this->fail("post() accepted what preview blocked: {$code}");
            } catch (DomainException) {
                $this->addToAssertionCount(1);
            }
        }
        $this->assertSame(0, PaymentGatewaySettlement::query()->count());
    }

    #[Test]
    public function items_beyond_the_remaining_clearing_balance_are_reported_not_thrown(): void
    {
        $payment = $this->collect(115000);

        $res = $this->preview($payment, net: 1, fee: 0, gross: 200000)->assertOk();
        $this->assertContains('invalid_items', collect($res->json('data.blockers'))->pluck('code')->all());
        $this->assertFalse($res->json('data.postable'));
    }

    #[Test]
    public function list_show_unsettled_and_replay_follow_a_posted_settlement(): void
    {
        $payment = $this->collect(115000);
        $bank = $this->mainBank();
        $this->getJson2("/api/payment-gateways/{$this->gateway->id}/unsettled-payments")->assertOk()
            ->assertJsonPath('data.0.payment_id', $payment->id)->assertJsonPath('data.0.remaining', 115000);

        $settlement = app(PaymentGatewaySettlementService::class)->post([
            'payment_gateway_id' => $this->gateway->id, 'cash_bank_account_id' => $bank->id, 'provider_settlement_ref' => 'SET-A',
            'net_bank_amount' => 40000, 'provider_fee_ex_tax' => 1000,
            'items' => [['payment_id' => $payment->id, 'gross_amount' => 41000, 'provider_event_ref' => 'EVT-A']],
        ]);

        $this->getJson2("/api/payment-gateways/{$this->gateway->id}/unsettled-payments")->assertOk()
            ->assertJsonPath('data.0.settled', 41000)->assertJsonPath('data.0.remaining', 74000);
        $this->getJson2('/api/payment-gateway-settlements')->assertOk()->assertJsonPath('meta.total', 1)->assertJsonPath('data.0.provider_settlement_ref', 'SET-A');
        $show = $this->getJson2("/api/payment-gateway-settlements/{$settlement->id}")->assertOk();
        $show->assertJsonPath('data.items.0.gross_amount', 41000)->assertJsonPath('data.journal_entry_id', $settlement->journal_entry_id);
        $this->assertStringNotContainsString('sk_test', $show->getContent());

        $res = $this->preview($payment, net: 40000, fee: 1000, gross: 41000, ref: 'SET-A', event: 'EVT-B')->assertOk();
        $res->assertJsonPath('data.replay', true);
    }

    #[Test]
    public function permissions_and_tenant_isolation_are_enforced(): void
    {
        $payment = $this->collect(115000);
        $this->postJson('/api/payment-gateway-settlements/preview', [])->assertUnauthorized();

        $limited = $this->tokenForRole($this->tenant->id, 'self_service', 'ss@pay-h3-02a.test');
        $this->withToken($limited)->getJson('/api/payment-gateway-settlements')->assertForbidden();
        $this->withToken($limited)->getJson("/api/payment-gateways/{$this->gateway->id}/unsettled-payments")->assertForbidden();

        $other = $this->registerTenant('pay-h3-02a-b', 'owner@pay-h3-02a-b.test');
        $this->withToken($other['token'])->getJson("/api/payment-gateways/{$this->gateway->id}/unsettled-payments")->assertNotFound();
        $this->withToken($other['token'])->postJson('/api/payment-gateway-settlements/preview', [
            'payment_gateway_id' => $this->gateway->id, 'net_bank_amount' => 1, 'items' => [['payment_id' => $payment->id, 'gross_amount' => 1]],
        ])->assertNotFound();
        $this->withToken($other['token'])->getJson('/api/payment-gateway-settlements')->assertOk()->assertJsonPath('meta.total', 0);
    }

    // ───────────────────────── أدوات ─────────────────────────

    private function getJson2(string $uri): \Illuminate\Testing\TestResponse
    {
        return $this->withToken($this->ownerToken)->getJson($uri);
    }

    /** @param  array<string, int>  $extra */
    private function preview(Payment $payment, int $net, int $fee, array $extra = [], ?int $gross = null, string $ref = 'SET-PREVIEW', string $event = 'EVT-P')
    {
        return $this->withToken($this->ownerToken)->postJson('/api/payment-gateway-settlements/preview', [
            'payment_gateway_id' => $this->gateway->id, 'provider_settlement_ref' => $ref,
            'net_bank_amount' => $net, 'provider_fee_ex_tax' => $fee,
            'items' => [['payment_id' => $payment->id, 'gross_amount' => $gross ?? 115000, 'provider_event_ref' => $event]],
        ] + $extra);
    }

    private function collect(int $amount): Payment
    {
        app(TenantContext::class)->set($this->tenant->id);
        $invoice = app(InvoiceService::class)->post(app(InvoiceService::class)->create(
            ['partner_id' => $this->customer->id, 'payment_type' => 'credit'],
            [['quantity' => 1, 'unit_price' => 100000, 'tax_rate' => 15]],
        ));
        $payments = app(PaymentService::class);

        return $payments->post($payments->create([
            'partner_id' => $this->customer->id, 'invoice_id' => $invoice->id, 'amount' => $amount, 'method' => 'bank', 'payment_gateway_id' => $this->gateway->id,
        ]));
    }

    private function mainBank(): CashBankAccount
    {
        app(CashBankAccountService::class)->bootstrapDefaults();

        return CashBankAccount::where('type', 'bank')->where('is_main', true)->firstOrFail();
    }
}
