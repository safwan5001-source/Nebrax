<?php

namespace Tests\Feature;

use App\Events\PaymentRefundConfirmed;
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
use PHPUnit\Framework\Attributes\Test;
use Tests\TestCase;

/**
 * PAY-H3-02b — مصفوفة A6 (ADR-0008): استرداد بوابة مؤكَّد ومرحَّل A5 يُخصم من صرف المزوّد كسطر مدين على 1170، والفرق غير المفسَّر يبقى
 * `unreconciled` بلا قيد (D-21). يثبت: توازن القيد وأرصدة 1170/1130/الإيراد، الاستهلاك التراكمي للاسترداد، رفض الصافي السالب والاسترداد غير المرحَّل،
 * التكرار الآمن، حراس القاعدة، الصلاحيات، العزل بين المستأجرين، وبوابة التفعيل.
 */
class PaymentGatewaySettlementRefundTest extends TestCase
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
        $this->tenant = Tenant::create(['name' => 'شركة A6', 'slug' => 'pay-h3-02b', 'vat_number' => '300000000000013', 'currency' => 'SAR']);
        app(TenantContext::class)->set($this->tenant->id);
        app(ChartOfAccountsSeeder::class)->seed($this->tenant->id);
        app(CashBankAccountService::class)->bootstrapDefaults();
        Settings::put('sales', ['allow_standalone_credit_notes' => true], $this->tenant);
        $this->owner = User::create(['tenant_id' => $this->tenant->id, 'name' => 'المالك', 'email' => 'owner@pay-h3-02b.test', 'password' => 'password123', 'role' => 'owner']);
        $this->admin = User::create(['tenant_id' => $this->tenant->id, 'name' => 'المدير', 'email' => 'admin@pay-h3-02b.test', 'password' => 'password123', 'role' => 'admin']);
        $this->ownerToken = $this->owner->createToken('t')->plainTextToken;
        $this->customer = Partner::create(['name' => 'عميل', 'type' => 'customer']);
        $this->platform = PlatformAdministrator::create(['name' => 'مشغّل', 'email' => 'ops@pay-h3-02b.test', 'password' => 'platform-password-123']);
        SchedulerHeartbeat::record();
        $this->app->singleton(FakePaymentGatewayAdapter::class);
        $this->fake = app(FakePaymentGatewayAdapter::class);
        $gateway = PaymentGateway::query()->create(['provider' => 'fake', 'name' => 'Fake', 'environment' => 'sandbox']);
        DB::table('payment_gateways')->where('id', $gateway->id)->update(['status' => PaymentGateway::STATUS_ACTIVE, 'is_active' => true]);
        $this->gateway = $gateway->fresh();
        app(PaymentsRolloutControlService::class)->setTenantState($this->platform, $this->tenant->id, true, 'تفعيل للاختبار');
        $this->settlements = app(PaymentGatewaySettlementService::class);
    }

    // ───────────────────────── A6-1: استرداد سبق التسوية ─────────────────────────

    #[Test]
    public function a6_1_settlement_deducts_a_posted_refund_with_a_balanced_entry_and_zeroes_clearing(): void
    {
        [$attempt, $paymentId] = $this->capture();
        $refund = $this->postedRefund($attempt, 46000);
        $revenue = $this->balance('4110');
        $tax = $this->balance('2120');
        $receivable = $this->balance('1130');
        $this->assertSame(115000 - 46000, $this->balance('1170'), 'بعد A1 وA5: مدين 1170 بالمتبقي');

        $s = $this->settlements->record($this->input($paymentId, 115000, [$refund->id => 46000], net: 67400, fee: 1600, ref: 'A6-1'));

        $this->assertTrue($s->isPosted());
        $this->assertNull($s->unreconciled_minor);
        $this->assertSame(46000, $s->refunds_total);
        $entry = JournalEntry::query()->with('lines.account')->findOrFail($s->journal_entry_id);
        $this->assertSame(PaymentGatewaySettlement::class, $entry->source_type);
        $this->assertEquals($entry->lines->sum('debit'), $entry->lines->sum('credit'));
        $byAccount = fn (string $code, string $side) => (int) $entry->lines->filter(fn ($l) => $l->account->code === $code)->sum($side);
        $this->assertSame(67400, $byAccount('1120', 'debit'));
        $this->assertSame(1600, $byAccount('5510', 'debit'));
        $this->assertSame(46000, $byAccount('1170', 'debit'), 'بند الاسترداد مدين على 1170');
        $this->assertSame(115000, $byAccount('1170', 'credit'), 'التحصيل دائن على 1170');
        $this->assertSame(0, $this->balance('1170'), 'مقاصة البوابة تُصفَّر');
        $this->assertSame(67400, $this->balance('1120'));
        $this->assertSame($revenue, $this->balance('4110'), 'لا مساس بالإيراد');
        $this->assertSame($tax, $this->balance('2120'), 'لا مساس بالضريبة');
        $this->assertSame($receivable, $this->balance('1130'), 'لا مساس بالعملاء');
        $this->assertSame(1, $s->lines->count());
        $this->assertSame($refund->id, $s->lines->first()->payment_refund_id);
    }

    #[Test]
    public function a_refund_can_be_deducted_across_two_settlements_but_never_beyond_its_amount(): void
    {
        [$attempt, $paymentId] = $this->capture();
        $refund = $this->postedRefund($attempt, 46000);

        $this->settlements->record($this->input($paymentId, 60000, [$refund->id => 20000], net: 40000, fee: 0, ref: 'A6-3a'));
        $this->assertSame(26000, $this->unsettledRefundRemaining($refund));

        $over = $this->thrown(fn () => $this->settlements->record($this->input($paymentId, 55000, [$refund->id => 26001], net: 28999, fee: 0, ref: 'A6-3b')), 'over', DomainException::class);
        $this->assertStringContainsString('exceeds remaining', $over->getMessage());

        $this->settlements->record($this->input($paymentId, 55000, [$refund->id => 26000], net: 29000, fee: 0, ref: 'A6-3b'));
        $this->assertSame(0, $this->unsettledRefundRemaining($refund));
        $this->assertSame(0, $this->balance('1170'));
        $again = $this->thrown(fn () => $this->settlements->record($this->input($paymentId, 1, [$refund->id => 1], net: 0, fee: 0, ref: 'A6-3c')), 'again', DomainException::class);
        $this->assertStringContainsString('exceeds remaining', $again->getMessage());
    }

    // ───────────────────────── A6-2: استرداد بعد تسوية سابقة ─────────────────────────

    #[Test]
    public function a6_2_a_refund_after_a_full_settlement_leaves_a_credit_that_the_next_settlement_consumes(): void
    {
        [$first, $firstPayment] = $this->capture();
        $this->settlements->record($this->input($firstPayment, 115000, [], net: 113400, fee: 1600, ref: 'A2-1'));
        $this->assertSame(0, $this->balance('1170'));

        $refund = $this->postedRefund($first, 46000);
        $this->assertSame(-46000, $this->balance('1170'), 'بعد التسوية: A5 يترك دائناً للمزوّد');

        [, $secondPayment] = $this->capture();
        $s = $this->settlements->record($this->input($secondPayment, 115000, [$refund->id => 46000], net: 67400, fee: 1600, ref: 'A6-2'));

        $this->assertTrue($s->isPosted());
        $this->assertSame(0, $this->balance('1170'));
        $this->assertSame(113400 + 67400, $this->balance('1120'));
    }

    // ───────────────────────── A6-4/5: ما يُرفض بلا قيد ─────────────────────────

    #[Test]
    public function a_negative_net_is_rejected_without_any_record_or_entry(): void
    {
        [$attempt, $paymentId] = $this->capture();
        $refund = $this->postedRefund($attempt, 46000);
        $entries = JournalEntry::query()->count();

        $e = $this->thrown(fn () => $this->settlements->record($this->input($paymentId, 10000, [$refund->id => 46000], net: 0, fee: 0, ref: 'NEG')), 'negative', DomainException::class);
        $this->assertStringStartsWith('negative_net_unsupported', $e->getMessage());
        $this->assertSame($entries, JournalEntry::query()->count());
        $this->assertSame(0, PaymentGatewaySettlement::query()->count());
        $this->assertSame(46000, $this->unsettledRefundRemaining($refund));
    }

    #[Test]
    public function only_a_posted_refund_can_be_deducted(): void
    {
        [$attempt, $paymentId] = $this->capture();
        $pending = $this->confirmedRefund($attempt, 10000);   // مؤكَّد ولم يُرحَّل A5

        $e = $this->thrown(fn () => $this->settlements->record($this->input($paymentId, 115000, [$pending->id => 10000], net: 105000, fee: 0, ref: 'PEND')), 'pending', DomainException::class);
        $this->assertStringStartsWith('refund_not_posted', $e->getMessage());
        $this->assertSame(0, PaymentGatewaySettlement::query()->count());
    }

    // ───────────────────────── D-21: غير المفسَّر ─────────────────────────

    #[Test]
    public function an_unexplained_difference_is_saved_unreconciled_without_entry_or_consumption_and_posts_once_fixed(): void
    {
        [$attempt, $paymentId] = $this->capture();
        $refund = $this->postedRefund($attempt, 46000);
        $entries = JournalEntry::query()->count();
        $clearing = $this->balance('1170');

        $strict = $this->thrown(fn () => $this->settlements->post($this->input($paymentId, 115000, [$refund->id => 46000], net: 66900, fee: 1600, ref: 'D21')), 'strict', DomainException::class);
        $this->assertStringContainsString('does not reconcile', $strict->getMessage());
        $this->assertSame(0, PaymentGatewaySettlement::query()->count(), 'post() الصارم لا يحفظ شيئاً');

        $draft = $this->settlements->record($this->input($paymentId, 115000, [$refund->id => 46000], net: 66900, fee: 1600, ref: 'D21'));
        $this->assertSame(PaymentGatewaySettlement::STATUS_UNRECONCILED, $draft->status);
        $this->assertSame(500, $draft->unreconciled_minor, 'المتوقَّع 67400 − المُدخَل 66900');
        $this->assertNull($draft->journal_entry_id);
        $this->assertSame($entries, JournalEntry::query()->count(), 'لا قيد ولا حساب فروقات عام');
        $this->assertSame($clearing, $this->balance('1170'));
        $this->assertSame(115000, $this->remainingOfPayment($paymentId), 'المسودة لا تستهلك التحصيل');
        $this->assertSame(46000, $this->unsettledRefundRemaining($refund), 'ولا تستهلك الاسترداد');
        $this->assertSame(1, $draft->items->count());
        $this->assertSame(1, $draft->lines->count());

        // الإرسال نفسه بالمرجع نفسه يحدّث المسودة نفسها (لا مسودة ثانية)، وبفرق صفري يُرحَّل في السجل نفسه.
        $posted = $this->settlements->record($this->input($paymentId, 115000, [$refund->id => 46000], net: 67400, fee: 1600, ref: 'D21'));
        $this->assertSame($draft->id, $posted->id);
        $this->assertTrue($posted->isPosted());
        $this->assertNull($posted->unreconciled_minor);
        $this->assertNotNull($posted->journal_entry_id);
        $this->assertSame($entries + 1, JournalEntry::query()->count());
        $this->assertSame(0, $this->balance('1170'));
        $this->assertSame(1, PaymentGatewaySettlement::query()->count());
        $this->assertSame(1, $posted->items->count());
        $this->assertSame(1, $posted->lines->count());
    }

    // ───────────────────────── التكرار الآمن ─────────────────────────

    #[Test]
    public function replaying_a_posted_reference_is_idempotent_and_a_changed_replay_is_rejected(): void
    {
        [$attempt, $paymentId] = $this->capture();
        $refund = $this->postedRefund($attempt, 46000);
        $input = $this->input($paymentId, 115000, [$refund->id => 46000], net: 67400, fee: 1600, ref: 'REPLAY');
        $first = $this->settlements->record($input);
        $entries = JournalEntry::query()->count();

        $second = $this->settlements->record($input);
        $this->assertSame($first->id, $second->id);
        $this->assertSame($entries, JournalEntry::query()->count());

        $changed = $this->input($paymentId, 115000, [$refund->id => 40000], net: 73400, fee: 1600, ref: 'REPLAY');
        $e = $this->thrown(fn () => $this->settlements->record($changed), 'changed', DomainException::class);
        $this->assertStringContainsString('already posted with different amounts', $e->getMessage());
    }

    // ───────────────────────── حراس القاعدة ─────────────────────────

    #[Test]
    public function database_guards_protect_lines_and_settlement_status(): void
    {
        [$attempt, $paymentId] = $this->capture();
        $refund = $this->postedRefund($attempt, 46000);
        $pending = $this->confirmedRefund($attempt, 5000);
        $s = $this->settlements->record($this->input($paymentId, 115000, [$refund->id => 46000], net: 67400, fee: 1600, ref: 'GUARD'));
        $line = $s->lines->first();

        $raw = fn (array $row) => $row + ['id' => (string) \Illuminate\Support\Str::uuid(), 'tenant_id' => $this->tenant->id, 'line_type' => 'refund', 'created_at' => now(), 'updated_at' => now()];
        // الأب مرحَّل (له قيد) فلا إدراج بنود جديدة
        $this->thrown(fn () => DB::transaction(fn () => DB::table('payment_gateway_settlement_lines')->insert($raw(['settlement_id' => $s->id, 'payment_refund_id' => $pending->id, 'amount_minor' => 100]))), 'parent closed', QueryException::class);
        // بند مرحَّل ثابت
        $this->thrown(fn () => DB::transaction(fn () => DB::table('payment_gateway_settlement_lines')->where('id', $line->id)->update(['amount_minor' => 1])), 'immutable', QueryException::class);
        // المرحَّلة لا ترجع إلى unreconciled
        $this->thrown(fn () => DB::transaction(fn () => DB::table('payment_gateway_settlements')->where('id', $s->id)->update(['status' => 'unreconciled', 'unreconciled_minor' => 5])), 'final', QueryException::class);
        // حالة غير معروفة
        $this->thrown(fn () => DB::transaction(fn () => DB::table('payment_gateway_settlements')->where('id', $s->id)->update(['status' => 'bogus'])), 'status', QueryException::class);

        // على مسودة: استرداد غير مرحَّل ومبلغ يتجاوز المتبقي ونوع غير مدعوم مرفوضة، وفرق صفري لا يُحفظ unreconciled
        [, $otherPayment] = $this->capture();
        $draft = $this->settlements->record($this->input($otherPayment, 1000, [], net: 900, fee: 0, ref: 'DRAFT-G'));
        $this->assertTrue($draft->isUnreconciled());
        $this->thrown(fn () => DB::transaction(fn () => DB::table('payment_gateway_settlement_lines')->insert($raw(['settlement_id' => $draft->id, 'payment_refund_id' => $pending->id, 'amount_minor' => 100]))), 'not posted', QueryException::class);
        $this->thrown(fn () => DB::transaction(fn () => DB::table('payment_gateway_settlement_lines')->insert($raw(['settlement_id' => $draft->id, 'payment_refund_id' => $refund->id, 'amount_minor' => 1]))), 'overused', QueryException::class);
        $this->thrown(fn () => DB::transaction(fn () => DB::table('payment_gateway_settlement_lines')->insert($raw(['settlement_id' => $draft->id, 'payment_refund_id' => $refund->id, 'amount_minor' => 1, 'line_type' => 'reserve_hold']))), 'type', QueryException::class);
        $this->thrown(fn () => DB::transaction(fn () => DB::table('payment_gateway_settlements')->where('id', $draft->id)->update(['unreconciled_minor' => 0])), 'zero diff', QueryException::class);
        $this->thrown(fn () => DB::transaction(fn () => DB::table('payment_gateway_settlements')->where('id', $draft->id)->update(['status' => 'posted'])), 'post needs entry', QueryException::class);
    }

    #[Test]
    public function posted_settlements_and_their_children_cannot_be_deleted_so_consumption_cannot_be_released(): void
    {
        [$attempt, $paymentId] = $this->capture();
        $refund = $this->postedRefund($attempt, 46000);
        $s = $this->settlements->record($this->input($paymentId, 115000, [$refund->id => 46000], net: 67400, fee: 1600, ref: 'NODEL'));
        $line = PaymentGatewaySettlementLine::query()->where('settlement_id', $s->id)->firstOrFail();

        $this->thrown(fn () => $line->delete(), 'model delete', DomainException::class);
        $this->thrown(fn () => DB::transaction(fn () => DB::table('payment_gateway_settlement_lines')->where('id', $line->id)->delete()), 'db line delete', QueryException::class);
        $this->thrown(fn () => DB::transaction(fn () => DB::table('payment_gateway_settlement_items')->where('settlement_id', $s->id)->delete()), 'db item delete', QueryException::class);
        $this->thrown(fn () => DB::transaction(fn () => DB::table('payment_gateway_settlements')->where('id', $s->id)->delete()), 'db settlement delete', QueryException::class);
        $this->assertSame(0, $this->unsettledRefundRemaining($refund), 'الاستهلاك باقٍ: الاسترداد مخصوم كاملاً ولم يُحرَّر');
        $this->assertSame(1, PaymentGatewaySettlementLine::query()->where('settlement_id', $s->id)->count());
    }

    #[Test]
    public function the_settlement_currency_must_equal_the_tenant_currency(): void
    {
        [, $paymentId] = $this->capture();

        $e = $this->thrown(fn () => $this->settlements->record(['currency' => 'USD'] + $this->input($paymentId, 115000, [], net: 113400, fee: 1600, ref: 'CUR')), 'currency', DomainException::class);
        $this->assertStringStartsWith('currency_mismatch', $e->getMessage());
        $this->assertSame(0, PaymentGatewaySettlement::query()->count());
    }

    #[Test]
    public function uppercase_uuid_duplicates_are_rejected_as_domain_errors_and_replay_counts_every_line(): void
    {
        [$attempt, $paymentId] = $this->capture();
        $refund = $this->postedRefund($attempt, 46000);
        $input = $this->input($paymentId, 115000, [], net: 67400, fee: 1600, ref: 'UUID');
        $input['refunds'] = [
            ['payment_refund_id' => strtolower($refund->id), 'amount_minor' => 20000],
            ['payment_refund_id' => strtoupper($refund->id), 'amount_minor' => 26000],
        ];

        $e = $this->thrown(fn () => $this->settlements->record($input), 'dup', DomainException::class);
        $this->assertStringContainsString('cannot appear twice', $e->getMessage());
        $this->assertSame(0, PaymentGatewaySettlement::query()->count());

        $ok = $this->settlements->record($this->input($paymentId, 115000, [$refund->id => 46000], net: 67400, fee: 1600, ref: 'UUID'));
        $replay = $this->input($paymentId, 115000, [$refund->id => 46000], net: 67400, fee: 1600, ref: 'UUID');
        $replay['refunds'][] = ['payment_refund_id' => $refund->id, 'amount_minor' => 46000];   // الحمولة المكرَّرة ليست تكراراً مطابقاً
        $this->thrown(fn () => $this->settlements->record($replay), 'dup replay', DomainException::class);
        $this->assertSame($ok->id, $this->settlements->record($this->input($paymentId, 115000, [$refund->id => 46000], net: 67400, fee: 1600, ref: 'UUID'))->id);
    }

    #[Test]
    public function a_settlement_dated_before_the_refund_was_posted_cannot_deduct_it(): void
    {
        [$attempt, $paymentId] = $this->capture();
        $refund = $this->postedRefund($attempt, 46000);   // تاريخه المحاسبي 2026-10-23
        $input = ['settlement_date' => '2026-10-22'] + $this->input($paymentId, 115000, [$refund->id => 46000], net: 67400, fee: 1600, ref: 'DATE');

        $e = $this->thrown(fn () => $this->settlements->record($input), 'date', DomainException::class);
        $this->assertStringStartsWith('refund_after_settlement_date', $e->getMessage());
    }

    #[Test]
    public function an_identical_replay_of_a_posted_settlement_still_returns_after_the_tenant_is_disabled(): void
    {
        [$attempt, $paymentId] = $this->capture();
        $input = $this->input($paymentId, 115000, [], net: 113400, fee: 1600, ref: 'OFF');
        $first = $this->settlements->record($input);

        app(PaymentsRolloutControlService::class)->setTenantState($this->platform, $this->tenant->id, false, 'تعطيل');

        $this->assertSame($first->id, $this->settlements->record($input)->id, 'التكرار الآمن يُعاد ولو عُطّلت المؤسسة');
        $res = $this->withToken($this->ownerToken)->postJson('/api/payment-gateway-settlements/preview', $input)->assertOk();
        $res->assertJsonPath('data.replay', true)->assertJsonPath('data.postable', true);
    }

    #[Test]
    public function refund_identity_is_only_visible_to_holders_of_the_refund_view_permission(): void
    {
        [$attempt, $paymentId] = $this->capture();
        $refund = $this->postedRefund($attempt, 46000);
        $s = $this->settlements->record($this->input($paymentId, 115000, [$refund->id => 46000], net: 67400, fee: 1600, ref: 'PERM'));
        $accountant = $this->tokenForRole($this->tenant->id, 'accountant', 'acc2@pay-h3-02b.test');

        // المحاسب يرى التسوية وبند الاسترداد (نوعه ومبلغه) دون هوية الاسترداد
        $show = $this->withToken($accountant)->getJson("/api/payment-gateway-settlements/{$s->id}")->assertOk();
        $show->assertJsonPath('data.lines.0.amount_minor', 46000)->assertJsonPath('data.lines.0.payment_refund_id', null)->assertJsonPath('data.lines.0.refund_number', null);
        $owner = $this->withToken($this->ownerToken)->getJson("/api/payment-gateway-settlements/{$s->id}")->assertOk();
        $owner->assertJsonPath('data.lines.0.payment_refund_id', $refund->id);

        $this->withToken($accountant)->getJson("/api/payment-gateways/{$this->gateway->id}/unsettled-refunds")->assertForbidden();
        $payload = $this->payload($paymentId, 115000, [$refund->id => 46000], 67400, 1600, 'PERM-2');
        $this->withToken($accountant)->postJson('/api/payment-gateway-settlements/preview', $payload)->assertForbidden();
    }

    // ───────────────────────── API: الصلاحيات والتفعيل والعزل ─────────────────────────

    #[Test]
    public function the_record_endpoint_requires_its_permission_the_rollout_and_isolates_tenants(): void
    {
        [$attempt, $paymentId] = $this->capture();
        $refund = $this->postedRefund($attempt, 46000);
        $payload = $this->payload($paymentId, 115000, [$refund->id => 46000], 67400, 1600, 'API-1');
        [, $secondPayment] = $this->capture();   // قبل أي إيقاف: الالتقاط نفسه يحتاج المدفوعات مفعّلة

        $this->postJson('/api/payment-gateway-settlements', $payload)->assertUnauthorized();
        $accountant = $this->tokenForRole($this->tenant->id, 'accountant', 'acc@pay-h3-02b.test');
        $this->withToken($accountant)->postJson('/api/payment-gateway-settlements', $payload)->assertForbidden();
        $this->withToken($accountant)->postJson('/api/payment-gateway-settlements/preview', $payload)->assertForbidden();   // بنود الاسترداد تتطلب payment_refunds.view
        $this->withToken($accountant)->postJson('/api/payment-gateway-settlements/preview', $this->payload($secondPayment, 1000, [], 900, 100, 'API-0'))->assertOk();   // المعاينة بلا استرداد payments.view

        // الإيقاف الطارئ للمنصة لا يمنع التسجيل، أما تعطيل المؤسسة فيمنعه
        app(PaymentsRolloutControlService::class)->setPlatformState($this->platform, false, 'إيقاف طارئ للاختبار');
        $res = $this->withToken($this->ownerToken)->postJson('/api/payment-gateway-settlements', $payload);
        $res->assertOk();
        $res->assertJsonPath('data.status', 'posted')->assertJsonPath('data.refunds_total', 46000)->assertJsonPath('data.lines.0.amount_minor', 46000);
        app(PaymentsRolloutControlService::class)->setTenantState($this->platform, $this->tenant->id, false, 'تعطيل');
        $off = $this->withToken($this->ownerToken)->postJson('/api/payment-gateway-settlements', $this->payload($paymentId, 1000, [], 900, 100, 'API-2'))->assertStatus(409);
        $off->assertJsonPath('error.code', 'rollout_disabled');
        app(PaymentsRolloutControlService::class)->setTenantState($this->platform, $this->tenant->id, true, 'تفعيل');

        // D-21 عبر الـAPI: 200 بحالة unreconciled والفرق ظاهر
        $draft = $this->withToken($this->ownerToken)->postJson('/api/payment-gateway-settlements', $this->payload($secondPayment, 1000, [], 800, 100, 'API-3'))->assertOk();
        $draft->assertJsonPath('data.status', 'unreconciled')->assertJsonPath('data.unreconciled_minor', 100)->assertJsonPath('data.journal_entry_id', null);
        // خطأ نطاقي ⇒ 422 برمز ثابت لا 500
        $neg = $this->withToken($this->ownerToken)->postJson('/api/payment-gateway-settlements', $this->payload($secondPayment, 1, [$refund->id => 1], 0, 0, 'API-4'))->assertStatus(422);
        $this->assertContains($neg->json('error.code'), ['negative_net_unsupported', 'operation_rejected']);

        // عزل المستأجرين
        $other = $this->registerTenant('pay-h3-02b-b', 'owner@pay-h3-02b-b.test');
        $this->withToken($other['token'])->postJson('/api/payment-gateway-settlements', $this->payload($paymentId, 1000, [], 900, 100, 'X'))->assertNotFound();   // بوابة مستأجر آخر ⇒ 404 (المالك يملك الصلاحية)
    }

    #[Test]
    public function preview_accounts_for_refunds_and_flags_negative_net_and_ineligible_refunds(): void
    {
        [$attempt, $paymentId] = $this->capture();
        $refund = $this->postedRefund($attempt, 46000);
        $pending = $this->confirmedRefund($attempt, 5000);

        $ok = $this->withToken($this->ownerToken)->postJson('/api/payment-gateway-settlements/preview', $this->payload($paymentId, 115000, [$refund->id => 46000], 67400, 1600, 'PV-1'))->assertOk();
        $ok->assertJsonPath('data.refunds_total', 46000)->assertJsonPath('data.difference', 0)->assertJsonPath('data.postable', true);

        $off = $this->withToken($this->ownerToken)->postJson('/api/payment-gateway-settlements/preview', $this->payload($paymentId, 115000, [$refund->id => 46000], 66900, 1600, 'PV-2'))->assertOk();
        $off->assertJsonPath('data.difference', 500)->assertJsonPath('data.postable', false)->assertJsonPath('data.saveable_as_unreconciled', true);

        $neg = $this->withToken($this->ownerToken)->postJson('/api/payment-gateway-settlements/preview', $this->payload($paymentId, 10000, [$refund->id => 46000], 0, 0, 'PV-3'))->assertOk();
        $this->assertContains('negative_net_unsupported', collect($neg->json('data.blockers'))->pluck('code')->all());
        $this->assertFalse($neg->json('data.saveable_as_unreconciled'));

        $bad = $this->withToken($this->ownerToken)->postJson('/api/payment-gateway-settlements/preview', $this->payload($paymentId, 115000, [$pending->id => 5000], 110000, 0, 'PV-4'))->assertOk();
        $this->assertContains('invalid_refunds', collect($bad->json('data.blockers'))->pluck('code')->all());
        $this->assertFalse($bad->json('data.postable'));

        $list = $this->withToken($this->ownerToken)->getJson("/api/payment-gateways/{$this->gateway->id}/unsettled-refunds")->assertOk();
        $this->assertSame([$refund->id], collect($list->json('data'))->pluck('refund_id')->all());
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
