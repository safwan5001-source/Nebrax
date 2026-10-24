<?php

namespace Tests\Feature;

use App\Events\PaymentRefundConfirmed;
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
 * PAY-H3-02c — تعديلات المزوّد (ADR-0008 D-22، A6-7..10): احتجاز/إفراج احتياطي وتعديل مدين/دائن بموافقة مستقلة ودليل وسجل تدقيق، تُستهلك مرة واحدة
 * بتسوية مرحَّلة تولّد القيد عبر `LedgerService`. يثبت: القيود والأرصدة، المعتمِد ≠ الطالب (خدمة وقاعدة)، تسوية gross=0 بتعديل معتمد فقط، لا استهلاك مزدوج،
 * الفشل المغلق لغياب الدور، D-21 مع التعديلات، حراس القاعدة، الصلاحيات والعزل.
 */
class PaymentGatewayAdjustmentTest extends TestCase
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
        $this->tenant = Tenant::create(['name' => 'شركة D-22', 'slug' => 'pay-h3-02c', 'vat_number' => '300000000000013', 'currency' => 'SAR']);
        app(TenantContext::class)->set($this->tenant->id);
        app(ChartOfAccountsSeeder::class)->seed($this->tenant->id);
        app(CashBankAccountService::class)->bootstrapDefaults();
        Settings::put('sales', ['allow_standalone_credit_notes' => true], $this->tenant);
        $this->owner = User::create(['tenant_id' => $this->tenant->id, 'name' => 'المالك', 'email' => 'owner@pay-h3-02c.test', 'password' => 'password123', 'role' => 'owner']);
        $this->admin = User::create(['tenant_id' => $this->tenant->id, 'name' => 'المدير', 'email' => 'admin@pay-h3-02c.test', 'password' => 'password123', 'role' => 'admin']);
        $this->ownerToken = $this->owner->createToken('t')->plainTextToken;
        $this->customer = Partner::create(['name' => 'عميل', 'type' => 'customer']);
        $this->platform = PlatformAdministrator::create(['name' => 'مشغّل', 'email' => 'ops@pay-h3-02c.test', 'password' => 'platform-password-123']);
        SchedulerHeartbeat::record();
        $this->app->singleton(FakePaymentGatewayAdapter::class);
        $this->fake = app(FakePaymentGatewayAdapter::class);
        $gateway = PaymentGateway::query()->create(['provider' => 'fake', 'name' => 'Fake', 'environment' => 'sandbox']);
        DB::table('payment_gateways')->where('id', $gateway->id)->update(['status' => PaymentGateway::STATUS_ACTIVE, 'is_active' => true]);
        $this->gateway = $gateway->fresh();
        app(PaymentsRolloutControlService::class)->setTenantState($this->platform, $this->tenant->id, true, 'تفعيل للاختبار');
        $this->settlements = app(PaymentGatewaySettlementService::class);
    }

    // ───────────────────────── دورة الحياة والموافقة المستقلة ─────────────────────────

    #[Test]
    public function an_adjustment_needs_independent_approval_evidence_and_a_reason_and_keeps_an_audit_trail(): void
    {
        $svc = app(PaymentGatewayAdjustmentService::class);

        $e = $this->thrown(fn () => $svc->request($this->gateway, 'reserve_hold', 10000, 'سبب كافٍ', 'x', null, $this->owner), 'evidence', GatewayAdjustmentException::class);
        $this->assertSame('evidence_required', $e->reason);
        $e = $this->thrown(fn () => $svc->request($this->gateway, 'reserve_hold', 10000, 'abc', 'STMT-1', null, $this->owner), 'reason', GatewayAdjustmentException::class);
        $this->assertSame('reason_required', $e->reason);
        $e = $this->thrown(fn () => $svc->request($this->gateway, 'bogus', 10000, 'سبب كافٍ', 'STMT-1', null, $this->owner), 'kind', GatewayAdjustmentException::class);
        $this->assertSame('invalid_kind', $e->reason);

        $adj = $svc->request($this->gateway, 'reserve_hold', 10000, 'احتياطي متجدد 5٪', 'STMT-2026-10', 'EVT-1', $this->owner);
        $this->assertSame(PaymentGatewayAdjustment::REQUESTED, $adj->status);

        $e = $this->thrown(fn () => $svc->approve($adj, $this->owner), 'self approval', GatewayAdjustmentException::class);
        $this->assertSame('self_approval', $e->reason, 'حتى مستأجر بمستخدم واحد لا يعتمد طلبه');
        $e = $this->thrown(fn () => $svc->reject($adj, $this->owner, 'أرفض طلبي بنفسي'), 'self reject', GatewayAdjustmentException::class);
        $this->assertSame('self_approval', $e->reason);
        $e = $this->thrown(fn () => $svc->request($this->gateway, 'adjustment_debit', 500, 'سبب كافٍ', 'STMT-3', 'EVT-1', $this->owner), 'dup event', GatewayAdjustmentException::class);
        $this->assertSame('duplicate_event', $e->reason);

        // القاعدة تمنع الاعتماد الذاتي حتى بتجاوز الخدمة
        $this->thrown(fn () => DB::transaction(fn () => DB::table('payment_gateway_adjustments')->where('id', $adj->id)->update(['status' => 'approved', 'approved_by' => $this->owner->id, 'approved_at' => now()])), 'db self approval', QueryException::class);

        $approved = $svc->approve($adj, $this->admin);
        $this->assertSame(PaymentGatewayAdjustment::APPROVED, $approved->status);
        $this->assertSame($this->admin->id, $approved->approved_by);

        $actions = PaymentGatewayAdjustmentEvent::query()->where('adjustment_id', $adj->id)->orderBy('created_at')->pluck('action')->all();
        $this->assertSame(['requested', 'approved'], $actions);
        $e = $this->thrown(fn () => $svc->approve($approved, $this->admin), 'again', GatewayAdjustmentException::class);
        $this->assertSame('invalid_state', $e->reason);

        $cancelled = $svc->cancel($approved, $this->owner, 'لم يعد مطلوباً');
        $this->assertSame(PaymentGatewayAdjustment::CANCELLED, $cancelled->status);
        $this->assertSame(['requested', 'approved', 'cancelled'], PaymentGatewayAdjustmentEvent::query()->where('adjustment_id', $adj->id)->orderBy('created_at')->pluck('action')->all());
    }

    // ───────────────────────── A6-7/A6-8: الاحتياطي ─────────────────────────

    #[Test]
    public function a6_7_a_reserve_hold_debits_the_reserve_asset_and_the_adjustment_is_consumed_once(): void
    {
        [, $paymentId] = $this->capture();
        $adj = $this->approved('reserve_hold', 10000, 'STMT-H1');

        $s = $this->settlements->record($this->input($paymentId, 115000, [], net: 103400, fee: 1600, ref: 'A6-7') + ['adjustments' => [['adjustment_id' => $adj->id]]]);

        $this->assertTrue($s->isPosted());
        $this->assertSame(10000, $s->provider_deductions);
        $entry = JournalEntry::query()->with('lines.account')->findOrFail($s->journal_entry_id);
        $sum = fn (string $code, string $side) => (int) $entry->lines->filter(fn ($l) => $l->account->code === $code)->sum($side);
        $this->assertSame(103400, $sum('1120', 'debit'));
        $this->assertSame(1600, $sum('5510', 'debit'));
        $this->assertSame(10000, $sum('1171', 'debit'));
        $this->assertSame(115000, $sum('1170', 'credit'));
        $this->assertEquals($entry->lines->sum('debit'), $entry->lines->sum('credit'));
        $this->assertSame(10000, $this->balance('1171'));
        $this->assertSame(0, $this->balance('1170'));

        $adj = $adj->fresh();
        $this->assertSame(PaymentGatewayAdjustment::CONSUMED, $adj->status);
        $this->assertSame($s->id, $adj->settlement_id);
        $this->assertSame(['requested', 'approved', 'consumed'], PaymentGatewayAdjustmentEvent::query()->where('adjustment_id', $adj->id)->orderBy('created_at')->pluck('action')->all());
        $this->assertSame(10000, app(PaymentGatewayAdjustmentService::class)->reserveBalance($this->gateway->id));

        // لا استهلاك مزدوج: التعديل المستهلَك لا يدخل تسوية أخرى
        [, $other] = $this->capture();
        $e = $this->thrown(fn () => $this->settlements->record($this->input($other, 115000, [], net: 103400, fee: 1600, ref: 'A6-7b') + ['adjustments' => [['adjustment_id' => $adj->id]]]), 'reuse', DomainException::class);
        $this->assertStringStartsWith('adjustment_not_approved', $e->getMessage());
        // وتكرار التسوية نفسها آمن بلا استهلاك ثانٍ
        $again = $this->settlements->record($this->input($paymentId, 115000, [], net: 103400, fee: 1600, ref: 'A6-7') + ['adjustments' => [['adjustment_id' => $adj->id]]]);
        $this->assertSame($s->id, $again->id);
    }

    #[Test]
    public function a6_8_a_release_with_no_collection_is_allowed_only_with_an_approved_adjustment_and_never_beyond_the_reserve(): void
    {
        $svc = app(PaymentGatewayAdjustmentService::class);
        [, $paymentId] = $this->capture();
        $hold = $this->approved('reserve_hold', 10000, 'STMT-H2');
        $this->settlements->record($this->input($paymentId, 115000, [], net: 103400, fee: 1600, ref: 'A6-8a') + ['adjustments' => [['adjustment_id' => $hold->id]]]);

        // إفراج يتجاوز المحتجز يُرفض عند الطلب
        $e = $this->thrown(fn () => $svc->request($this->gateway, 'reserve_release', 10001, 'إفراج زائد', 'STMT-R0', null, $this->owner), 'over', GatewayAdjustmentException::class);
        $this->assertSame('reserve_insufficient', $e->reason);

        $release = $this->approved('reserve_release', 10000, 'STMT-R1');
        // إفراج ثانٍ بينما الأول معتمد لم يُستهلك يُرفض (الاحتياطي محجوز للأول)
        $e = $this->thrown(fn () => $svc->request($this->gateway, 'reserve_release', 1, 'إفراج آخر', 'STMT-R2', null, $this->owner), 'reserved', GatewayAdjustmentException::class);
        $this->assertSame('reserve_insufficient', $e->reason);

        // gross = 0 بلا أي تعديل يُرفض كما كان
        $none = $this->thrown(fn () => $this->settlements->record(['items' => []] + $this->input($paymentId, 1, [], net: 0, fee: 0, ref: 'EMPTY')), 'empty', DomainException::class);
        $this->assertStringContainsString('at least one matched payment', $none->getMessage());

        $bankBefore = $this->balance('1120');
        $s = $this->settlements->record(['items' => []] + $this->input($paymentId, 1, [], net: 10000, fee: 0, ref: 'A6-8b') + ['adjustments' => [['adjustment_id' => $release->id]]]);

        $this->assertTrue($s->isPosted());
        $this->assertSame(0, $s->gross_amount);
        $this->assertSame(10000, $s->provider_credits);
        $entry = JournalEntry::query()->with('lines.account')->findOrFail($s->journal_entry_id);
        $this->assertCount(2, $entry->lines, 'دائن الاحتياطي ومدين البنك فقط — لا سطر مقاصة');
        $this->assertSame(10000, (int) $entry->lines->first(fn ($l) => $l->account->code === '1171')->credit);
        $this->assertSame($bankBefore + 10000, $this->balance('1120'));
        $this->assertSame(0, $this->balance('1171'));
        $this->assertSame(0, $svc->reserveBalance($this->gateway->id));
    }

    // ───────────────────────── A6-9/A6-10: تعديل مدين/دائن ─────────────────────────

    #[Test]
    public function a6_9_and_a6_10_provider_adjustments_post_to_their_own_role_not_to_fees(): void
    {
        [, $paymentId] = $this->capture();
        $debit = $this->approved('adjustment_debit', 2500, 'STMT-D1');

        $s = $this->settlements->record($this->input($paymentId, 115000, [], net: 110900, fee: 1600, ref: 'A6-9') + ['adjustments' => [['adjustment_id' => $debit->id]]]);
        $entry = JournalEntry::query()->with('lines.account')->findOrFail($s->journal_entry_id);
        $sum = fn (string $code, string $side) => (int) $entry->lines->filter(fn ($l) => $l->account->code === $code)->sum($side);
        $this->assertSame(2500, $sum('5520', 'debit'));
        $this->assertSame(1600, $sum('5510', 'debit'), 'العمولة منفصلة عن التعديل');
        $this->assertSame(110900, $sum('1120', 'debit'));
        $this->assertSame(115000, $sum('1170', 'credit'));

        $credit = $this->approved('adjustment_credit', 700, 'STMT-C1');
        $c = $this->settlements->record(['items' => []] + $this->input($paymentId, 1, [], net: 700, fee: 0, ref: 'A6-10') + ['adjustments' => [['adjustment_id' => $credit->id]]]);
        $entry = JournalEntry::query()->with('lines.account')->findOrFail($c->journal_entry_id);
        $this->assertSame(700, (int) $entry->lines->first(fn ($l) => $l->account->code === '5520')->credit);
        $this->assertSame(2500 - 700, $this->balance('5520'), 'صافي حساب التعديلات');
    }

    // ───────────────────────── ما يُرفض ─────────────────────────

    #[Test]
    public function unapproved_cancelled_and_foreign_adjustments_cannot_be_settled_and_a_missing_role_fails_closed(): void
    {
        [, $paymentId] = $this->capture();
        $svc = app(PaymentGatewayAdjustmentService::class);
        $requested = $svc->request($this->gateway, 'adjustment_debit', 500, 'سبب كافٍ', 'STMT-X1', null, $this->owner);
        $cancelled = $svc->cancel($this->approved('adjustment_debit', 400, 'STMT-X2'), $this->owner, 'ألغيت قبل الاستهلاك');
        foreach ([$requested, $cancelled] as $i => $adj) {
            $e = $this->thrown(fn () => $this->settlements->record($this->input($paymentId, 115000, [], net: 113000, fee: 1600, ref: "BAD-{$i}") + ['adjustments' => [['adjustment_id' => $adj->id]]]), "bad {$i}", DomainException::class);
            $this->assertStringStartsWith('adjustment_not_approved', $e->getMessage());
        }
        $this->assertSame(0, PaymentGatewaySettlement::query()->count());

        // حجز وحده في تسوية بلا تحصيل ⇒ صافٍ سالب
        $hold = $this->approved('reserve_hold', 100, 'STMT-X3');
        $neg = $this->thrown(fn () => $this->settlements->record(['items' => []] + $this->input($paymentId, 1, [], net: 0, fee: 0, ref: 'NEG0') + ['adjustments' => [['adjustment_id' => $hold->id]]]), 'neg', DomainException::class);
        $this->assertStringStartsWith('negative_net_unsupported', $neg->getMessage());

        // غياب تعيين دور الاحتياطي ⇒ فشل مغلق بلا قيد ولا استهلاك
        $mapping = AccountRoleMapping::query()->where('role_key', 'gateway_reserve')->firstOrFail();
        DB::table('account_role_mappings')->where('id', $mapping->id)->delete();
        $entries = JournalEntry::query()->count();
        $this->thrown(fn () => $this->settlements->record($this->input($paymentId, 115000, [], net: 113300, fee: 1600, ref: 'ROLE') + ['adjustments' => [['adjustment_id' => $hold->id]]]), 'role', RuntimeException::class);
        $this->assertSame($entries, JournalEntry::query()->count());
        $this->assertSame(PaymentGatewayAdjustment::APPROVED, $hold->fresh()->status);
    }

    #[Test]
    public function an_unexplained_difference_with_adjustments_stays_unreconciled_and_consumes_nothing(): void
    {
        [, $paymentId] = $this->capture();
        $adj = $this->approved('reserve_hold', 10000, 'STMT-U1');
        $entries = JournalEntry::query()->count();

        $draft = $this->settlements->record($this->input($paymentId, 115000, [], net: 103000, fee: 1600, ref: 'U1') + ['adjustments' => [['adjustment_id' => $adj->id]]]);

        $this->assertTrue($draft->isUnreconciled());
        $this->assertSame(400, $draft->unreconciled_minor);
        $this->assertSame($entries, JournalEntry::query()->count());
        $this->assertSame(PaymentGatewayAdjustment::APPROVED, $adj->fresh()->status, 'المسودة لا تستهلك التعديل');
        $this->assertSame(0, app(PaymentGatewayAdjustmentService::class)->reserveBalance($this->gateway->id));

        $posted = $this->settlements->record($this->input($paymentId, 115000, [], net: 103400, fee: 1600, ref: 'U1') + ['adjustments' => [['adjustment_id' => $adj->id]]]);
        $this->assertSame($draft->id, $posted->id);
        $this->assertTrue($posted->isPosted());
        $this->assertSame(PaymentGatewayAdjustment::CONSUMED, $adj->fresh()->status);
    }

    #[Test]
    public function database_guards_protect_adjustments_their_events_and_line_eligibility(): void
    {
        $adj = $this->approved('reserve_hold', 10000, 'STMT-G1');
        $requested = app(PaymentGatewayAdjustmentService::class)->request($this->gateway, 'adjustment_debit', 500, 'سبب كافٍ', 'STMT-G2', null, $this->owner);
        $update = fn (array $row, ?string $id = null) => DB::transaction(fn () => DB::table('payment_gateway_adjustments')->where('id', $id ?? $adj->id)->update($row));

        foreach ([['amount_minor' => 1], ['kind' => 'adjustment_credit'], ['evidence_ref' => 'other'], ['requested_by' => $this->admin->id]] as $row) {
            $this->thrown(fn () => $update($row), 'immutable '.key($row), QueryException::class);
        }
        $this->thrown(fn () => $update(['status' => 'requested']), 'regress', QueryException::class);
        $this->thrown(fn () => $update(['status' => 'consumed']), 'consumed without settlement', QueryException::class);

        // سجل التدقيق append-only
        $event = PaymentGatewayAdjustmentEvent::query()->firstOrFail();
        $this->thrown(fn () => DB::transaction(fn () => DB::table('payment_gateway_adjustment_events')->where('id', $event->id)->update(['reason' => 'x'])), 'event update', QueryException::class);
        $this->thrown(fn () => DB::transaction(fn () => DB::table('payment_gateway_adjustment_events')->where('id', $event->id)->delete()), 'event delete', QueryException::class);

        // أهلية البند: مستند غير معتمد، أو نوع/مبلغ مختلف، أو الجمع بين استرداد وتعديل
        [, $paymentId] = $this->capture();
        $draft = $this->settlements->record($this->input($paymentId, 1000, [], net: 900, fee: 0, ref: 'GUARD-D'));
        $this->assertTrue($draft->isUnreconciled());
        $line = fn (array $row) => $row + ['id' => (string) Str::uuid(), 'tenant_id' => $this->tenant->id, 'settlement_id' => $draft->id, 'created_at' => now(), 'updated_at' => now()];
        $insert = fn (array $row) => DB::transaction(fn () => DB::table('payment_gateway_settlement_lines')->insert($line($row)));
        $this->thrown(fn () => $insert(['line_type' => 'adjustment_debit', 'adjustment_id' => $requested->id, 'amount_minor' => 500]), 'not approved', QueryException::class);
        $this->thrown(fn () => $insert(['line_type' => 'reserve_hold', 'adjustment_id' => $adj->id, 'amount_minor' => 9999]), 'amount differs', QueryException::class);
        $this->thrown(fn () => $insert(['line_type' => 'adjustment_credit', 'adjustment_id' => $adj->id, 'amount_minor' => 10000]), 'kind differs', QueryException::class);
        $this->thrown(fn () => $insert(['line_type' => 'reserve_hold', 'amount_minor' => 10000]), 'adjustment required', QueryException::class);
        $this->thrown(fn () => $insert(['line_type' => 'bogus', 'adjustment_id' => $adj->id, 'amount_minor' => 10000]), 'type', QueryException::class);
        $this->assertSame(0, PaymentGatewaySettlementLine::query()->where('settlement_id', $draft->id)->count());
    }

    // ───────────────────────── المستأجرون القائمون ─────────────────────────

    #[Test]
    public function the_backfill_migration_adds_the_accounts_and_mappings_idempotently_and_never_hijacks_a_foreign_account(): void
    {
        $migration = require base_path('database/migrations/2026_12_06_010000_add_gateway_reserve_and_provider_adjustment_accounts.php');
        // مستأجر قائم قبل D-22: بلا الحسابين ولا الدورين
        DB::table('account_role_mappings')->whereIn('role_key', ['gateway_reserve', 'provider_adjustment'])->delete();
        DB::table('accounts')->where('tenant_id', $this->tenant->id)->whereIn('code', ['1171', '5520'])->delete();

        $migration->up();
        $migration->up();   // idempotent

        $this->assertSame(1, \App\Models\Account::query()->where('code', '1171')->count());
        $this->assertSame(1, \App\Models\Account::query()->where('code', '5520')->count());
        foreach (['gateway_reserve' => '1171', 'provider_adjustment' => '5520'] as $role => $code) {
            $mapped = AccountRoleMapping::query()->where('role_key', $role)->firstOrFail();
            $this->assertSame($code, \App\Models\Account::query()->findOrFail($mapped->account_id)->code);
        }

        // حساب مستأجر خاص بنفس الكود (غير نظامي) ⇒ فشل صريح لا انتحال
        DB::table('account_role_mappings')->where('role_key', 'gateway_reserve')->delete();
        DB::table('accounts')->where('tenant_id', $this->tenant->id)->where('code', '1171')->update(['is_system' => false]);
        $this->thrown(fn () => $migration->up(), 'foreign account', RuntimeException::class);
        $this->assertSame(0, AccountRoleMapping::query()->where('role_key', 'gateway_reserve')->count());
    }

    // ───────────────────────── API ─────────────────────────

    #[Test]
    public function the_adjustment_api_enforces_permissions_independent_approval_and_isolation(): void
    {
        $admin = $this->admin->createToken('t')->plainTextToken;
        $accountant = $this->tokenForRole($this->tenant->id, 'accountant', 'acc@pay-h3-02c.test');
        $body = ['payment_gateway_id' => $this->gateway->id, 'kind' => 'reserve_hold', 'amount_minor' => 10000, 'reason' => 'احتياطي متجدد', 'evidence_ref' => 'STMT-API-1'];

        $this->postJson('/api/payment-gateway-adjustments', $body)->assertUnauthorized();
        $this->withToken($accountant)->postJson('/api/payment-gateway-adjustments', $body)->assertForbidden();
        $this->withToken($this->ownerToken)->postJson('/api/payment-gateway-adjustments', ['kind' => 'bogus'] + $body)->assertUnprocessable();

        $id = $this->withToken($this->ownerToken)->postJson('/api/payment-gateway-adjustments', $body)->assertCreated()->assertJsonPath('data.status', 'requested')->json('data.id');
        $this->withToken($this->ownerToken)->postJson("/api/payment-gateway-adjustments/{$id}/approve")->assertStatus(409)->assertJsonPath('error.code', 'self_approval');
        $this->withToken($accountant)->postJson("/api/payment-gateway-adjustments/{$id}/approve")->assertForbidden();
        $this->withToken($admin)->postJson("/api/payment-gateway-adjustments/{$id}/approve")->assertOk()->assertJsonPath('data.status', 'approved')
            ->assertJsonPath('data.approved_by.name', 'المدير')->assertJsonPath('data.timeline.1.action', 'approved');
        // المحاسب يقرأ ولا يلغي ما لم يطلبه
        $this->withToken($accountant)->getJson("/api/payment-gateway-adjustments/{$id}")->assertOk()->assertJsonPath('data.evidence_ref', 'STMT-API-1');
        $this->withToken($accountant)->postJson("/api/payment-gateway-adjustments/{$id}/cancel", ['reason' => 'محاولة إلغاء'])->assertForbidden();
        $this->withToken($this->ownerToken)->getJson("/api/payment-gateways/{$this->gateway->id}/reserve-balance")->assertOk()->assertJsonPath('data.held_minor', 0);

        // العزل بين المستأجرين
        $other = $this->registerTenant('pay-h3-02c-b', 'owner@pay-h3-02c-b.test');
        $this->withToken($other['token'])->getJson("/api/payment-gateway-adjustments/{$id}")->assertNotFound();
        $this->withToken($other['token'])->postJson("/api/payment-gateway-adjustments/{$id}/approve")->assertNotFound();
        $this->withToken($other['token'])->postJson('/api/payment-gateway-adjustments', $body)->assertNotFound();
        $this->withToken($other['token'])->getJson('/api/payment-gateway-adjustments')->assertOk()->assertJsonPath('meta.total', 0);
    }

    private function approved(string $kind, int $amount, string $evidence): PaymentGatewayAdjustment
    {
        $svc = app(PaymentGatewayAdjustmentService::class);

        return $svc->approve($svc->request($this->gateway, $kind, $amount, 'تعديل موثّق من كشف المزوّد', $evidence, null, $this->owner), $this->admin);
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
