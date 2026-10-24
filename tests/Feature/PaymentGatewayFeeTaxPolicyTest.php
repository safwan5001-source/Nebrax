<?php

namespace Tests\Feature;

use App\Events\PaymentRefundConfirmed;
use App\Models\PaymentConnectionEvent;
use App\Services\PaymentGatewayService;
use App\Support\PaymentGatewayException;
use App\Models\AccountRoleMapping;
use App\Models\PaymentGatewayAdjustment;
use App\Models\PaymentGatewayAdjustmentEvent;
use App\Services\PaymentGatewayAdjustmentService;
use App\Support\GatewayAdjustmentException;
use RuntimeException;
use App\Models\CreditNote;
use App\Models\JournalEntry;
use App\Models\Partner;
use App\Models\PaymentAttempt;
use App\Models\PaymentGateway;
use App\Models\PaymentGatewaySettlement;
use App\Models\PaymentGatewaySettlementLine;
use App\Models\PaymentRefund;
use App\Models\PlatformAdministrator;
use App\Models\Tenant;
use App\Models\User;
use App\Services\Accounting\CashBankAccountService;
use App\Services\Accounting\ChartOfAccountsSeeder;
use App\Services\Accounting\CreditNoteService;
use App\Services\Accounting\CustomerRefundService;
use App\Services\Accounting\InvoiceService;
use App\Services\Accounting\PaymentGatewaySettlementService;
use App\Services\FakePaymentGatewayAdapter;
use App\Services\InvoicePaymentRequestService;
use App\Services\PaymentOrchestrator;
use App\Services\PaymentRefundPostingService;
use App\Services\PaymentRefundService;
use App\Services\PaymentsRolloutControlService;
use App\Support\SchedulerHeartbeat;
use App\Support\Settings;
use App\Tenancy\TenantContext;
use DomainException;
use Illuminate\Database\QueryException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Str;
use PHPUnit\Framework\Attributes\Test;
use Tests\TestCase;

/**
 * PAY-H3-02c-2 — ضريبة عمولة المزوّد (ADR-0008 D-04 الخيار ب، A6-6): الافتراضي `reject`، و`tax_input` لا يُفعَّل قبل EXT-05 (إعداد `payments.fee_tax_opinion_ref`)
 * ولا إلا بسياسة الاتصال ومرجع الفاتورة الضريبية. يثبت: الإغلاق الافتراضي، بوابة الرأي الضريبي عند الضبط **وعند الترحيل**، القيد A6-6 (مدين `tax_input` لا العمولة)،
 * التدقيق، المعاينة، التكرار الآمن، حارس القاعدة، الصلاحيات.
 */
class PaymentGatewayFeeTaxPolicyTest extends TestCase
{
    use CapturesThrowable;
    use InteractsWithApi;
    use RefreshDatabase;

    private Tenant $tenant;

    private User $owner;

    private User $admin;

    private string $ownerToken;

    private Partner $customer;

    private PaymentGateway $gateway;

    private FakePaymentGatewayAdapter $fake;

    private PlatformAdministrator $platform;

    private PaymentGatewaySettlementService $settlements;

    protected function setUp(): void
    {
        parent::setUp();
        $this->travelTo(now('UTC')->setDate(2026, 10, 23)->setTime(9, 0));
        $this->tenant = Tenant::create(['name' => 'شركة D-04', 'slug' => 'pay-h3-02c2', 'vat_number' => '300000000000013', 'currency' => 'SAR']);
        app(TenantContext::class)->set($this->tenant->id);
        app(ChartOfAccountsSeeder::class)->seed($this->tenant->id);
        app(CashBankAccountService::class)->bootstrapDefaults();
        Settings::put('sales', ['allow_standalone_credit_notes' => true], $this->tenant);
        $this->owner = User::create(['tenant_id' => $this->tenant->id, 'name' => 'المالك', 'email' => 'owner@pay-h3-02c2.test', 'password' => 'password123', 'role' => 'owner']);
        $this->admin = User::create(['tenant_id' => $this->tenant->id, 'name' => 'المدير', 'email' => 'admin@pay-h3-02c2.test', 'password' => 'password123', 'role' => 'admin']);
        $this->ownerToken = $this->owner->createToken('t')->plainTextToken;
        $this->customer = Partner::create(['name' => 'عميل', 'type' => 'customer']);
        $this->platform = PlatformAdministrator::create(['name' => 'مشغّل', 'email' => 'ops@pay-h3-02c2.test', 'password' => 'platform-password-123']);
        SchedulerHeartbeat::record();
        $this->app->singleton(FakePaymentGatewayAdapter::class);
        $this->fake = app(FakePaymentGatewayAdapter::class);
        $gateway = PaymentGateway::query()->create(['provider' => 'fake', 'name' => 'Fake', 'environment' => 'sandbox']);
        DB::table('payment_gateways')->where('id', $gateway->id)->update(['status' => PaymentGateway::STATUS_ACTIVE, 'is_active' => true]);
        $this->gateway = $gateway->fresh();
        app(PaymentsRolloutControlService::class)->setTenantState($this->platform, $this->tenant->id, true, 'تفعيل للاختبار');
        $this->settlements = app(PaymentGatewaySettlementService::class);
    }

    #[Test]
    public function the_default_policy_rejects_fee_tax_even_when_the_opinion_exists(): void
    {
        config(['payments.fee_tax_opinion_ref' => 'EXT-05-OPINION']);
        [, $paymentId] = $this->capture();
        $this->assertSame('reject', $this->gateway->fresh()->fee_tax_policy);
        $entries = JournalEntry::query()->count();

        $e = $this->thrown(fn () => $this->settlements->record($this->taxed($paymentId, 'REJ')), 'default reject', DomainException::class);
        $this->assertStringContainsString('Provider fee tax posting is not authorized', $e->getMessage());
        $this->assertSame($entries, JournalEntry::query()->count());
        $this->assertSame(0, PaymentGatewaySettlement::query()->count());
    }

    #[Test]
    public function the_policy_cannot_be_enabled_without_the_recorded_opinion_and_every_change_is_audited(): void
    {
        $svc = app(PaymentGatewayService::class);

        $e = $this->thrown(fn () => $svc->setFeeTaxPolicy($this->gateway, 'input_vat', $this->owner, 'بعد الرأي الضريبي'), 'no opinion', PaymentGatewayException::class);
        $this->assertSame('gateway.fee_tax_opinion_required', $e->reason);
        $this->assertSame('reject', $this->gateway->fresh()->fee_tax_policy);

        config(['payments.fee_tax_opinion_ref' => 'EXT-05-OPINION']);
        $e = $this->thrown(fn () => $svc->setFeeTaxPolicy($this->gateway, 'input_vat', $this->owner, 'abc'), 'reason', PaymentGatewayException::class);
        $this->assertSame('gateway.reason_required', $e->reason);
        $e = $this->thrown(fn () => $svc->setFeeTaxPolicy($this->gateway, 'expense', $this->owner, 'سبب كافٍ للتغيير'), 'invalid', PaymentGatewayException::class);
        $this->assertSame('gateway.invalid_fee_tax_policy', $e->reason);

        $svc->setFeeTaxPolicy($this->gateway, 'input_vat', $this->owner, 'اعتُمد الرأي الضريبي EXT-05');
        $this->assertSame('input_vat', $this->gateway->fresh()->fee_tax_policy);
        $svc->setFeeTaxPolicy($this->gateway, 'reject', $this->owner, 'إيقاف الاحتساب مؤقتاً');   // العودة إلى reject مسموحة دائماً
        config(['payments.fee_tax_opinion_ref' => null]);
        $svc->setFeeTaxPolicy($this->gateway, 'reject', $this->owner, 'تأكيد الإغلاق دون رأي');
        $events = PaymentConnectionEvent::query()->where('event_type', 'fee_tax_policy_changed')->orderBy('occurred_at')->get();
        $this->assertSame([['reject', 'input_vat'], ['input_vat', 'reject']], $events->map(fn ($ev) => [$ev->from_status, $ev->to_status])->all());
        $this->assertSame($this->owner->id, $events->first()->actor_user_id);

        // القاعدة تحصر القيم
        $this->thrown(fn () => DB::transaction(fn () => DB::table('payment_gateways')->where('id', $this->gateway->id)->update(['fee_tax_policy' => 'expense'])), 'db policy', QueryException::class);
    }

    #[Test]
    public function a6_6_with_the_policy_the_opinion_and_the_invoice_fee_tax_is_input_vat_not_commission(): void
    {
        $this->enableTaxPolicy();
        [, $paymentId] = $this->capture();
        $bankBefore = $this->balance('1120');

        $s = $this->settlements->record($this->taxed($paymentId, 'A6-6'));

        $this->assertTrue($s->isPosted());
        $this->assertSame(600, $s->provider_fee_tax);
        $this->assertSame('PROV-TAX-INV-77', $s->fee_tax_invoice_ref);
        $entry = JournalEntry::query()->with('lines.account')->findOrFail($s->journal_entry_id);
        $sum = fn (string $code, string $side) => (int) $entry->lines->filter(fn ($l) => $l->account->code === $code)->sum($side);
        $this->assertSame(110400, $sum('1120', 'debit'));
        $this->assertSame(4000, $sum('5510', 'debit'), 'العمولة بلا الضريبة');
        $this->assertSame(600, $sum('1150', 'debit'), 'ضريبة الرسوم مدخلات');
        $this->assertSame(115000, $sum('1170', 'credit'));
        $this->assertEquals($entry->lines->sum('debit'), $entry->lines->sum('credit'));
        $this->assertSame(0, $this->balance('1170'));
        $this->assertSame($bankBefore + 110400, $this->balance('1120'));
        $this->assertSame(4000, $this->balance('5510'));
        $this->assertSame(600, $this->balance('1150'));
    }

    #[Test]
    public function the_gates_are_rechecked_at_posting_time_and_the_invoice_reference_is_mandatory(): void
    {
        $this->enableTaxPolicy();
        [, $paymentId] = $this->capture();

        $e = $this->thrown(fn () => $this->settlements->record(['fee_tax_invoice_ref' => ''] + $this->taxed($paymentId, 'NOINV')), 'invoice', DomainException::class);
        $this->assertStringStartsWith('fee_tax_invoice_required', $e->getMessage());

        config(['payments.fee_tax_opinion_ref' => null]);   // الرأي أُزيل بعد ضبط السياسة ⇒ يعود الإغلاق
        $this->thrown(fn () => $this->settlements->record($this->taxed($paymentId, 'NOOP')), 'opinion removed', DomainException::class);

        config(['payments.fee_tax_opinion_ref' => 'EXT-05-OPINION']);
        app(PaymentGatewayService::class)->setFeeTaxPolicy($this->gateway, 'reject', $this->owner, 'إيقاف الاحتساب مؤقتاً');
        $this->thrown(fn () => $this->settlements->record($this->taxed($paymentId, 'POLREJ')), 'policy reject', DomainException::class);
        $this->assertSame(0, PaymentGatewaySettlement::query()->count());
    }

    #[Test]
    public function a_posted_fee_tax_settlement_replays_safely_after_the_gates_close(): void
    {
        $this->enableTaxPolicy();
        [, $paymentId] = $this->capture();
        $first = $this->settlements->record($this->taxed($paymentId, 'REPLAY-TAX'));
        $entries = JournalEntry::query()->count();

        config(['payments.fee_tax_opinion_ref' => null]);
        $again = $this->settlements->record($this->taxed($paymentId, 'REPLAY-TAX'));
        $this->assertSame($first->id, $again->id);
        $this->assertSame($entries, JournalEntry::query()->count());
        $changed = ['fee_tax_invoice_ref' => 'OTHER-INV'] + $this->taxed($paymentId, 'REPLAY-TAX');
        $this->thrown(fn () => $this->settlements->record($changed), 'changed invoice', DomainException::class);
    }

    #[Test]
    public function preview_and_the_api_follow_the_same_gates_and_permissions(): void
    {
        [, $paymentId] = $this->capture();
        $accountant = $this->tokenForRole($this->tenant->id, 'accountant', 'acc@pay-h3-02c2.test');
        $payload = $this->taxed($paymentId, 'PV-TAX');
        $codes = fn ($res) => collect($res->json('data.blockers'))->pluck('code')->all();

        $res = $this->withToken($this->ownerToken)->postJson('/api/payment-gateway-settlements/preview', $payload)->assertOk();
        $this->assertContains('fee_tax_not_authorized', $codes($res));
        $res->assertJsonPath('data.postable', false);

        // الضبط عبر الـAPI: المحاسب ممنوع، والمالك بلا رأي ⇒ 422 برمز ثابت، ومعه ⇒ 200 ويظهر في المورد
        $this->withToken($accountant)->putJson("/api/payment-gateways/{$this->gateway->id}/fee-tax-policy", ['policy' => 'input_vat', 'reason' => 'بعد الرأي الضريبي'])->assertForbidden();
        $this->withToken($this->ownerToken)->putJson("/api/payment-gateways/{$this->gateway->id}/fee-tax-policy", ['policy' => 'input_vat', 'reason' => 'بعد الرأي الضريبي'])
            ->assertStatus(422)->assertJsonPath('error.code', 'gateway.fee_tax_opinion_required');
        $this->withToken($this->ownerToken)->putJson("/api/payment-gateways/{$this->gateway->id}/fee-tax-policy", ['policy' => 'bogus', 'reason' => 'بعد الرأي الضريبي'])->assertUnprocessable();
        config(['payments.fee_tax_opinion_ref' => 'EXT-05-OPINION']);
        $this->withToken($this->ownerToken)->putJson("/api/payment-gateways/{$this->gateway->id}/fee-tax-policy", ['policy' => 'input_vat', 'reason' => 'بعد الرأي الضريبي'])
            ->assertOk()->assertJsonPath('data.fee_tax_policy', 'input_vat')->assertJsonPath('data.fee_tax_opinion_recorded', true);

        $res = $this->withToken($this->ownerToken)->postJson('/api/payment-gateway-settlements/preview', ['fee_tax_invoice_ref' => ''] + $payload)->assertOk();
        $this->assertContains('fee_tax_invoice_required', $codes($res));
        $res = $this->withToken($this->ownerToken)->postJson('/api/payment-gateway-settlements/preview', $payload)->assertOk();
        $res->assertJsonPath('data.postable', true)->assertJsonPath('data.blockers', []);

        $other = $this->registerTenant('pay-h3-02c2-b', 'owner@pay-h3-02c2-b.test');
        $this->withToken($other['token'])->putJson("/api/payment-gateways/{$this->gateway->id}/fee-tax-policy", ['policy' => 'reject', 'reason' => 'محاولة من مستأجر آخر'])->assertNotFound();
    }

    #[Test]
    public function a_provider_tax_invoice_cannot_be_recovered_twice_and_a_revoked_gateway_can_return_to_reject(): void
    {
        $this->enableTaxPolicy();
        [, $first] = $this->capture();
        [, $second] = $this->capture();
        $this->settlements->record($this->taxed($first, 'TAX-ONE'));
        $entries = JournalEntry::query()->count();

        $e = $this->thrown(fn () => $this->settlements->record($this->taxed($second, 'TAX-TWO')), 'reused invoice', DomainException::class);
        $this->assertStringStartsWith('fee_tax_invoice_reused', $e->getMessage());
        $this->assertSame($entries, JournalEntry::query()->count());
        $other = ['fee_tax_invoice_ref' => 'prov-tax-inv-77'] + $this->taxed($second, 'TAX-TWO');
        $this->thrown(fn () => $this->settlements->record($other), 'case-insensitive reuse', DomainException::class);
        $this->assertTrue($this->settlements->record(['fee_tax_invoice_ref' => 'PROV-TAX-INV-78'] + $this->taxed($second, 'TAX-TWO'))->isPosted());

        DB::table('payment_gateways')->where('id', $this->gateway->id)->update(['status' => PaymentGateway::STATUS_REVOKED, 'is_active' => false]);
        $svc = app(PaymentGatewayService::class);
        $this->assertSame('reject', $svc->setFeeTaxPolicy($this->gateway->fresh(), 'reject', $this->owner, 'إيقاف الاحتساب بعد الإلغاء')->fee_tax_policy);
    }

    private function enableTaxPolicy(): void
    {
        config(['payments.fee_tax_opinion_ref' => 'EXT-05-OPINION']);
        app(PaymentGatewayService::class)->setFeeTaxPolicy($this->gateway, 'input_vat', $this->owner, 'اعتُمد الرأي الضريبي EXT-05');
    }

    /** تحصيل 115000 · عمولة 4000 · ضريبة رسوم 600 · صافي 110400 + مرجع فاتورة المزوّد. */
    private function taxed(string $paymentId, string $ref): array
    {
        return ['provider_fee_tax' => 600, 'fee_tax_invoice_ref' => 'PROV-TAX-INV-77'] + $this->input($paymentId, 115000, [], net: 110400, fee: 4000, ref: $ref);
    }

    // ───────────────────────── أدوات ─────────────────────────

    /** @param  array<string, int>  $refunds  refundId ⇒ amount */
    private function input(string $paymentId, int $gross, array $refunds, int $net, int $fee, string $ref): array
    {
        $bank = \App\Models\CashBankAccount::where('type', 'bank')->where('is_main', true)->firstOrFail();

        return [
            'payment_gateway_id' => $this->gateway->id, 'cash_bank_account_id' => $bank->id, 'provider_settlement_ref' => $ref,
            'settlement_date' => '2026-10-23', 'net_bank_amount' => $net, 'provider_fee_ex_tax' => $fee,
            'items' => [['payment_id' => $paymentId, 'gross_amount' => $gross]],
            'refunds' => collect($refunds)->map(fn ($amount, $id) => ['payment_refund_id' => $id, 'amount_minor' => $amount])->values()->all(),
        ];
    }

    /** @param  array<string, int>  $refunds */
    private function payload(string $paymentId, int $gross, array $refunds, int $net, int $fee, string $ref): array
    {
        return $this->input($paymentId, $gross, $refunds, $net, $fee, $ref);
    }

    private function unsettledRefundRemaining(PaymentRefund $refund): int
    {
        $rows = $this->settlements->unsettledRefunds($this->gateway->id);
        $row = collect($rows)->firstWhere('refund_id', $refund->id);

        return $row === null ? 0 : (int) $row['remaining'];
    }

    private function remainingOfPayment(string $paymentId): int
    {
        $row = collect($this->settlements->unsettledPayments($this->gateway->id))->firstWhere('payment_id', $paymentId);

        return $row === null ? 0 : (int) $row['remaining'];
    }

    private function balance(string $code): int
    {
        $row = DB::table('journal_lines')
            ->join('accounts', 'accounts.id', '=', 'journal_lines.account_id')
            ->where('journal_lines.tenant_id', $this->tenant->id)
            ->where('accounts.code', $code)
            ->selectRaw('COALESCE(SUM(journal_lines.debit),0) as d, COALESCE(SUM(journal_lines.credit),0) as c')->first();

        return (int) $row->d - (int) $row->c;
    }

    /** @return array{0: PaymentAttempt, 1: string} الالتقاط الملتقَط المرحَّل (A1) ومعرّف سند القبض. */
    private function capture(): array
    {
        $invoice = app(InvoiceService::class)->post(app(InvoiceService::class)->create(
            ['partner_id' => $this->customer->id, 'payment_type' => 'credit'],
            [['quantity' => 1, 'unit_price' => 100000, 'tax_rate' => 15]],
        ));
        $requests = app(InvoicePaymentRequestService::class);
        $request = $requests->create($invoice, $this->gateway, $this->owner);
        $attempt = $requests->startAttempt($request, 'idem-cap-'.uniqid(), null, $this->owner);
        $this->fake->script($attempt->provider_payment_id, 'captured');
        app(PaymentOrchestrator::class)->sync($attempt);
        $attempt = $attempt->fresh();
        $this->assertSame(PaymentAttempt::POSTING_POSTED, $attempt->posting_status);
        $paymentId = \App\Models\PaymentAttemptPosting::query()->where('payment_attempt_id', $attempt->id)->value('payment_id');
        $this->assertNotNull($paymentId);

        return [$attempt, (string) $paymentId];
    }

    private function creditNote(): CreditNote
    {
        $service = app(CreditNoteService::class);
        $note = $service->create(
            ['type' => 'sales', 'partner_id' => $this->customer->id, 'refund_type' => 'credit', 'reason' => 'تصحيح تجاري'],
            [['description' => 'تصحيح', 'quantity' => 1, 'unit_price' => 100000, 'tax_rate' => 15]],
        );

        return $service->post($note);
    }

    /** استرداد مؤكَّد من المزوّد، والترحيل معزول (الحدث موقوف) ليُستدعى صراحةً. */
    private function confirmedRefund(PaymentAttempt $attempt, int $amount): PaymentRefund
    {
        Event::fake([PaymentRefundConfirmed::class]);
        $refunds = app(PaymentRefundService::class);
        $note = $this->creditNote();
        $refund = $refunds->request($attempt->fresh(), $amount, [['source_type' => CustomerRefundService::SOURCE_CREDIT_NOTE, 'source_id' => $note->id, 'amount' => $amount]], 'idem-set-'.uniqid(), $this->owner);
        $done = $refunds->submit($refunds->approve($refund, $this->admin), $this->admin);
        $this->assertSame(PaymentRefund::CONFIRMED, $done->status);

        return $done;
    }

    /** استرداد مؤكَّد ومرحَّل A5 (مدين 1130 / دائن 1170). */
    private function postedRefund(PaymentAttempt $attempt, int $amount): PaymentRefund
    {
        $refund = $this->confirmedRefund($attempt, $amount);
        $this->assertSame(PaymentRefundPostingService::OUTCOME_POSTED, app(PaymentRefundPostingService::class)->process($refund->fresh()));

        return $refund->fresh();
    }
}
