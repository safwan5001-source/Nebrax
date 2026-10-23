<?php

namespace Tests\Feature;

use App\Models\Account;
use App\Models\CashBankAccount;
use App\Models\Invoice;
use App\Models\JournalEntry;
use App\Models\PaymentMethod;
use App\Models\PosExchange;
use App\Models\Product;
use App\Models\ReturnDocument;
use App\Models\Tenant;
use App\Models\User;
use App\Services\Accounting\CashBankAccountService;
use App\Services\Accounting\ChartOfAccountsSeeder;
use App\Services\Accounting\InvoiceService;
use App\Services\Accounting\PosCashRefundTreasuryResolver;
use App\Services\Accounting\ReturnService;
use App\Support\Settings;
use App\Support\TreasurySelectionException;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * ═══════════════════════════════════════════════════════════════
 *  TREASURY-T6 — توجيه الردّ النقدي لمرتجعات المبيعات ومرتجع/استبدال POS (مغلق خلف بوابة T4)
 * ═══════════════════════════════════════════════════════════════
 *  • المرتجع العام (/returns): مصدر = فاتورة نقدية مرحَّلة ⇒ خزينة التحصيل من قيد البيع (قاعدة T5)؛ المستقل والآجل ⇒ مرفوض.
 *  • مرتجع POS وفائض استبدال POS النقدي: خزينة الجلسة المثبَّتة (`pos_sessions.cash_account_id`) + `withdraw` + العملة، ويُرفض الصرف
 *    إن حُصِّل النقد الأصلي في خزينة غير خزينة الجلسة. legacy/البوابة المغلقة: 1110 حرفياً كما كان.
 */
class TreasuryReturnRefundRoutingTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;
    use CapturesThrowable;

    private array $auth;
    private string $tenantId;
    private string $partnerId;
    private string $productId;
    private User $owner;
    private int $seq = 0;

    protected function setUp(): void
    {
        parent::setUp();
        $this->auth = $this->registerTenant('t6-main', 'owner@t6-main.test');
        $this->tenantId = $this->auth['tenant_id'];
        app(TenantContext::class)->set($this->tenantId);
        Settings::put('company', [
            'building_no' => '2322', 'street' => 'Synthetic Street', 'additional_no' => '1234',
            'district' => 'Synthetic District', 'city' => 'Dammam', 'postal_code' => '32241',
        ]);
        $this->owner = User::where('tenant_id', $this->tenantId)->where('email', 'owner@t6-main.test')->sole();
        app(CashBankAccountService::class)->bootstrapDefaults();
        $this->partnerId = $this->withToken($this->auth['token'])->postJson('/api/partners', ['name' => 'عميل ست', 'type' => 'customer'])->assertCreated()['data']['id'];
        $this->productId = Product::create(['name' => 'خدمة', 'type' => 'service', 'track_inventory' => false, 'sale_price' => 10000])->id;
    }

    // ───────────────────────── مساعدات ─────────────────────────

    private function gate(bool $open): void
    {
        config(['treasury.cash_sale_routing_enabled' => $open]);
    }

    private function activate(string $policy = 'main'): void
    {
        $this->gate(true);
        Settings::put('sales', ['cash_sale_treasury_policy' => $policy]);
    }

    private function newTreasury(string $name = 'خزينة إضافية'): CashBankAccount
    {
        $svc = app(CashBankAccountService::class);

        return CashBankAccount::with('account')->findOrFail($svc->create(
            ['type' => 'cash', 'name' => $name, 'currency' => 'SAR', 'deposit_scope' => 'all', 'withdraw_scope' => 'all'], $this->owner
        )->id);
    }

    private function entity(string $code): CashBankAccount
    {
        return CashBankAccount::with('account')->whereHas('account', fn ($q) => $q->where('code', $code))->firstOrFail();
    }

    private function makeMain(CashBankAccount $e): void
    {
        app(CashBankAccountService::class)->makeMain($e);
    }

    private function user(string $role): User
    {
        return User::create(['tenant_id' => $this->tenantId, 'name' => 'م '.$role, 'email' => Str::random(8).'@t6.test', 'password' => 'password123', 'role' => $role]);
    }

    private function saleOf(string $paymentType = 'cash', int $quantity = 3): Invoice
    {
        $svc = app(InvoiceService::class);
        $draft = $svc->create(
            ['partner_id' => $this->partnerId, 'payment_type' => $paymentType, 'zatca_document_type' => 'simplified'],
            [['product_id' => $this->productId, 'description' => 'خدمة', 'quantity' => $quantity, 'unit_price' => 100000, 'tax_rate' => 15]]
        );

        return $svc->post($draft, null, $this->owner);
    }

    private function returnFor(?Invoice $source, string $paymentType = 'cash'): ReturnDocument
    {
        $payload = ['type' => 'sales', 'partner_id' => $this->partnerId, 'payment_type' => $paymentType];
        if ($source) {
            $payload += ['original_type' => Invoice::class, 'original_id' => $source->id];
        }

        return app(ReturnService::class)->create($payload, [[
            'source_line_id' => $source?->lines()->first()->id, 'product_id' => $this->productId, 'quantity' => 1, 'unit_price' => 100000, 'tax_rate' => 15,
        ]]);
    }

    private function postReturn(ReturnDocument $r, ?User $actor = null): ReturnDocument
    {
        return app(ReturnService::class)->post(ReturnDocument::findOrFail($r->id), $actor);
    }

    /** @return array<int,string> */
    private function lines(string $sourceId): array
    {
        $entry = JournalEntry::with('lines.account')->where('source_id', $sourceId)->orderBy('created_at')->firstOrFail();
        $out = $entry->lines->map(fn ($l) => $l->account->code.($l->debit ? ' Dr '.$l->debit : ' Cr '.$l->credit))->all();
        sort($out);

        return $out;
    }

    private function refunded(array $creditLine, int $net = 100000, int $tax = 15000): array
    {
        $rows = array_merge(["2120 Dr {$tax}", "4110 Dr {$net}"], $creditLine);
        sort($rows);

        return $rows;
    }

    private function snapshot(): array
    {
        return [
            'entries' => JournalEntry::count(),
            'chain' => DB::table('zatca_chain_entries')->count(),
            'icv' => (int) (DB::table('zatca_chains')->where('tenant_id', $this->tenantId)->value('last_icv') ?? 0),
            'returns_posted' => ReturnDocument::where('status', 'posted')->count(),
        ];
    }

    private function reason(callable $fn): string
    {
        $e = $this->thrown($fn, 'يجب أن يُرفض', TreasurySelectionException::class);

        return $e->reason;
    }

    // ───────────────────────── POS ─────────────────────────

    /** يربط طريقة الدفع النقدية الافتراضية بخزينة معيّنة (كما يفعل المستأجر من إعدادات طرق الدفع). */
    private function linkCashMethodTo(CashBankAccount $e): void
    {
        PaymentMethod::where('settlement_type', 'cash')->orderByDesc('is_default')->firstOrFail()->update(['cash_bank_account_id' => $e->id]);
    }

    /** @return array{session_id:string,warehouse_id:string} */
    private function openSession(?array $auth = null): array
    {
        $n = ++$this->seq;
        $t = ($auth ?? $this->auth)['token'];
        $wh = $this->withToken($t)->postJson('/api/warehouses', ['name' => "مخزن ست {$n}", 'code' => "T6-W-{$n}", 'is_active' => true])->assertCreated()['data']['id'];
        $dev = $this->withToken($t)->postJson('/api/pos-devices', ['name' => "كاشير ست {$n}", 'code' => "T6-D-{$n}", 'warehouse_id' => $wh, 'is_active' => true])->assertCreated()['data']['id'];
        $sid = $this->withToken($t)->postJson('/api/pos-sessions/open', ['opening_balance' => 0, 'pos_device_id' => $dev])->assertCreated()['data']['id'];

        return ['session_id' => $sid, 'warehouse_id' => $wh];
    }

    private function posProduct(int $price = 10000): Product
    {
        return Product::create(['name' => 'صنف pos '.(++$this->seq), 'sale_price' => $price, 'track_inventory' => false, 'quantity_on_hand' => 0, 'avg_cost' => 0]);
    }

    private function posCheckout(string $sessionId, array $tenders = ['cash' => 11500]): Invoice
    {
        $r = $this->withToken($this->auth['token'])->postJson('/api/pos/checkout', [
            'idempotency_key' => (string) Str::uuid(), 'partner_id' => $this->partnerId, 'pos_session_id' => $sessionId,
            'items' => [['product_id' => $this->posProduct()->id, 'quantity' => 1, 'unit_price' => 10000, 'tax_rate' => 15, 'discount' => 0]],
            'tenders' => $tenders,
        ])->assertCreated();

        return Invoice::with('lines')->findOrFail($r['data']['id']);
    }

    private function posReturn(string $sessionId, Invoice $invoice, ?string $token = null, string $paymentType = 'cash')
    {
        return $this->withToken($token ?? $this->auth['token'])->postJson('/api/pos/returns', [
            'idempotency_key' => (string) Str::uuid(), 'pos_session_id' => $sessionId, 'original_invoice_id' => $invoice->id, 'payment_type' => $paymentType,
            'items' => [['source_line_id' => $invoice->lines->firstOrFail()->id, 'quantity' => 1]],
        ]);
    }

    private function allowCashSurplus(): void
    {
        $this->withToken($this->auth['token'])->putJson('/api/sales-config/pos', ['data' => ['exchange_surplus_policy' => 'allow_cash_refund']])->assertOk();
    }

    private function posExchange(string $sessionId, Invoice $original, int $replacementPrice = 5000, string $surplus = 'cash')
    {
        return $this->withToken($this->auth['token'])->postJson('/api/pos/exchanges', [
            'idempotency_key' => (string) Str::uuid(), 'pos_session_id' => $sessionId, 'original_invoice_id' => $original->id,
            'return_items' => [['source_line_id' => $original->lines->firstOrFail()->id, 'quantity' => 1]],
            'surplus_refund_method' => $surplus,
            'replacement' => ['items' => [['product_id' => $this->posProduct($replacementPrice)->id, 'quantity' => 1, 'unit_price' => $replacementPrice, 'tax_rate' => 15]], 'tenders' => ['cash' => 0]],
        ]);
    }

    /** أكواد الحسابات الدائنة بخزائن (111x) في قيد مرتجع/استبدال */
    private function creditedCodes(string $sourceId): array
    {
        return DB::table('journal_lines as l')->join('journal_entries as e', 'e.id', '=', 'l.journal_entry_id')->join('accounts as a', 'a.id', '=', 'l.account_id')
            ->where('e.source_id', $sourceId)->where('l.credit', '>', 0)->where('a.code', 'like', '111%')->pluck('a.code')->unique()->values()->all();
    }

    // ───────────────────────── legacy / بوابة مغلقة ─────────────────────────

    /** @test */
    public function with_the_gate_closed_general_cash_returns_credit_1110_exactly_as_before_without_any_withdraw_check(): void
    {
        $sale = $this->saleOf('cash');
        $standalone = $this->postReturn($this->returnFor(null), $this->owner);
        $linked = $this->postReturn($this->returnFor($sale));            // بلا فاعل أيضاً
        $onCredit = $this->postReturn($this->returnFor($this->saleOf('credit')), $this->owner);

        foreach ([$standalone, $linked, $onCredit] as $r) {
            $this->assertSame('posted', $r->status);
            $this->assertSame($this->refunded(['1110 Cr 115000']), $this->lines($r->id));
        }
    }

    /** @test */
    public function a_stored_routed_policy_is_ignored_while_the_gate_is_closed_for_returns(): void
    {
        $this->gate(false);
        Settings::put('sales', ['cash_sale_treasury_policy' => 'main']);
        $r = $this->postReturn($this->returnFor($this->saleOf('credit')), $this->owner);

        $this->assertSame($this->refunded(['1110 Cr 115000']), $this->lines($r->id));
    }

    /** @test */
    public function with_the_gate_closed_pos_cash_return_and_exchange_surplus_credit_1110_even_when_the_session_treasury_is_another(): void
    {
        $t1111 = $this->newTreasury('خزينة 1111');
        $this->linkCashMethodTo($t1111);
        $session = $this->openSession();
        $this->allowCashSurplus();
        $invoice = $this->posCheckout($session['session_id']);

        $return = $this->posReturn($session['session_id'], $invoice)->assertCreated();
        $this->assertSame(['1110'], $this->creditedCodes($return['data']['id']), 'السلوك القديم حرفياً: 1110 مرمَّزاً');
        $original2 = $this->posCheckout($session['session_id']);
        $exchange = $this->posExchange($session['session_id'], $original2)->assertCreated();
        $this->assertSame(['1110'], $this->creditedCodes($exchange['data']['id']));
    }

    // ───────────────────────── المرتجع العام الموجَّه ─────────────────────────

    /** @test */
    public function a_routed_sale_in_1111_is_returned_from_1111_even_after_the_main_moves_and_an_old_1110_sale_stays_1110(): void
    {
        $old = $this->saleOf('cash');                                   // legacy: Dr 1110
        $t1111 = $this->newTreasury('خزينة 1111');
        $this->makeMain($t1111);
        $this->activate('main');
        $routed = $this->saleOf('cash');                                // Dr 1111
        $other = $this->newTreasury('خزينة 1112');
        $this->makeMain($other);                                        // الرئيسية تتحرك مجدداً

        $a = $this->postReturn($this->returnFor($routed), $this->owner);
        $b = $this->postReturn($this->returnFor($old), $this->owner);

        $this->assertSame($this->refunded(['1111 Cr 115000']), $this->lines($a->id));
        $this->assertSame($this->refunded(['1110 Cr 115000']), $this->lines($b->id), 'قيد مطابق للقديم، مشتقّ من البيع لا من الرئيسية');
    }

    /** @test */
    public function standalone_and_credit_sourced_cash_returns_are_rejected_under_both_policies_credit_returns_unchanged(): void
    {
        foreach (['main', 'explicit_required'] as $policy) {
            $this->activate($policy);
            $standalone = $this->returnFor(null);
            $credit = $this->returnFor($this->saleOf('credit'));
            $before = $this->snapshot();

            $this->assertSame(TreasurySelectionException::REFUND_SOURCE_REQUIRED, $this->reason(fn () => $this->postReturn($standalone, $this->owner)), $policy);
            $this->assertSame(TreasurySelectionException::REFUND_SOURCE_REQUIRED, $this->reason(fn () => $this->postReturn($credit, $this->owner)), $policy);
            $this->assertSame($before, $this->snapshot(), 'بلا أي أثر');
            $this->assertSame('draft', $standalone->fresh()->status);
        }

        $creditReturn = $this->postReturn($this->returnFor($this->saleOf('credit'), 'credit'), $this->owner);
        $this->assertSame($this->refunded(['1130 Cr 115000']), $this->lines($creditReturn->id));
    }

    /** @test */
    public function the_general_return_enforces_withdraw_currency_and_inactive_source_treasury_without_fallback(): void
    {
        $t1111 = $this->newTreasury('خزينة 1111');
        $this->makeMain($t1111);
        $this->activate('main');
        $sale = $this->saleOf('cash', 4);
        $admin = $this->user('admin');
        $before = $this->snapshot();

        DB::table('cash_bank_accounts')->where('id', $t1111->id)->update(['deposit_scope' => 'all', 'withdraw_scope' => 'user', 'withdraw_scope_subject' => $admin->id]);
        $this->assertSame(TreasurySelectionException::NOT_PERMITTED, $this->reason(fn () => $this->postReturn($this->returnFor($sale), $this->owner)));
        $this->assertSame(TreasurySelectionException::NOT_PERMITTED, $this->reason(fn () => $this->postReturn($this->returnFor($sale))), 'بلا فاعل: فشل مغلق');
        $this->assertSame($before, $this->snapshot());
        $this->assertSame($this->refunded(['1111 Cr 115000']), $this->lines($this->postReturn($this->returnFor($sale), $admin)->id));

        DB::table('cash_bank_accounts')->where('id', $t1111->id)->update(['withdraw_scope' => 'all', 'withdraw_scope_subject' => null, 'currency' => 'USD']);
        $this->assertSame(TreasurySelectionException::CURRENCY_MISMATCH, $this->reason(fn () => $this->postReturn($this->returnFor($sale), $this->owner)));

        DB::table('cash_bank_accounts')->where('id', $t1111->id)->update(['currency' => 'SAR', 'is_active' => false]);
        $pending = $this->returnFor($sale);
        $this->assertSame(TreasurySelectionException::INACTIVE, $this->reason(fn () => $this->postReturn($pending, $this->owner)));
        $this->assertSame('draft', $pending->fresh()->status);
        $this->assertSame(0, DB::table('journal_entries')->where('source_id', $pending->id)->count(), 'لا سقوط إلى 1110');
    }

    // ───────────────────────── POS الموجَّه ─────────────────────────

    /** @test */
    public function a_routed_pos_cash_return_credits_the_session_treasury_not_1110_and_matches_the_drawer(): void
    {
        $t1111 = $this->newTreasury('خزينة 1111');
        $this->linkCashMethodTo($t1111);
        $session = $this->openSession();
        $this->activate('main');
        $invoice = $this->posCheckout($session['session_id']);

        $r = $this->posReturn($session['session_id'], $invoice)->assertCreated();
        $this->assertSame($this->refunded(['1111 Cr 11500'], 10000, 1500), $this->lines($r['data']['id']), 'الرصيد يخرج من خزينة الجلسة المحصَّل فيها');
        $this->assertSame(0, (int) (Account::where('code', '1110')->first()?->balance?->balance ?? 0), '1110 لم يُمَسّ');
        $this->assertSame(0, (int) $t1111->account->fresh()->balance->balance, 'الاسترداد الكامل يعيد 1111 إلى صفر');
    }

    /** @test */
    public function a_routed_pos_exchange_cash_surplus_credits_the_session_treasury(): void
    {
        $t1111 = $this->newTreasury('خزينة 1111');
        $this->linkCashMethodTo($t1111);
        $session = $this->openSession();
        $this->allowCashSurplus();
        $this->activate('main');
        $original = $this->posCheckout($session['session_id']);

        $e = $this->posExchange($session['session_id'], $original)->assertCreated();
        $exchange = PosExchange::findOrFail($e['data']['id']);
        $this->assertSame(5750, (int) $exchange->cash_refund_amount);
        $this->assertSame(['1111'], $this->creditedCodes($exchange->id));
        $this->assertSame(0, DB::table('journal_lines as l')->join('accounts as a', 'a.id', '=', 'l.account_id')->join('journal_entries as e', 'e.id', '=', 'l.journal_entry_id')
            ->where('e.source_id', $exchange->id)->where('a.code', '1110')->count());
    }

    /** @test */
    public function a_pos_card_sale_cash_refund_allowed_by_policy_goes_out_of_the_session_treasury(): void
    {
        $t1111 = $this->newTreasury('خزينة 1111');
        $this->linkCashMethodTo($t1111);
        $session = $this->openSession();
        $this->activate('main');
        $this->withToken($this->auth['token'])->putJson('/api/sales-config/pos', ['data' => ['cash_refund_policy' => 'allow_any_pos_sale']])->assertOk();
        // رصيد الدرج لا يكفي للرد: السياسة الصريحة لـPOS تُطبَّق قبل الخزينة
        $card = $this->posCheckout($session['session_id'], ['card' => 11500]);
        $this->posReturn($session['session_id'], $card)->assertStatus(422);
        $this->assertSame(0, ReturnDocument::where('status', 'posted')->count());
    }

    /** @test */
    public function a_pos_cash_return_is_rejected_when_the_original_cash_was_collected_in_another_treasury_than_the_session_treasury(): void
    {
        $session = $this->openSession();                           // مثبَّتة على الخزينة الرئيسية (1110)
        $t1111 = $this->newTreasury('خزينة 1111');
        $this->linkCashMethodTo($t1111);                           // ثم تُنقل طريقة الدفع إلى 1111
        $this->allowCashSurplus();
        $this->activate('main');
        $invoice = $this->posCheckout($session['session_id']);     // التحصيل في 1111، والجلسة على 1110
        $before = $this->snapshot();

        $res = $this->posReturn($session['session_id'], $invoice)->assertStatus(422);
        $this->assertStringContainsString('خزينة مختلفة', (string) $res->json('message'));
        $this->assertSame($before, $this->snapshot());
        $this->assertSame(0, ReturnDocument::where('status', 'posted')->count(), 'المعاملة كلها تراجعت');

        $orig2 = $this->posCheckout($session['session_id']);
        $beforeExchange = $this->snapshot();
        $invoicesBefore = Invoice::count();
        $this->posExchange($session['session_id'], $orig2)->assertStatus(422);
        $this->assertSame($beforeExchange, $this->snapshot(), 'لا قيد ولا ICV ولا مدخل سلسلة (الفاتورة البديلة تراجعت)');
        $this->assertSame($invoicesBefore, Invoice::count(), 'فاتورة الاستبدال البديلة لم تبقَ');
        $this->assertSame(0, PosExchange::count());
        $this->assertSame(0, ReturnDocument::where('status', 'posted')->count());
    }

    /** @test */
    public function a_legacy_session_without_a_pinned_treasury_is_rejected_when_routed_and_unchanged_when_legacy(): void
    {
        $session = $this->openSession();
        $invoice = $this->posCheckout($session['session_id'], ['cash' => 23000]);   // سطر بكميتين؟ لا: فاتورة واحدة 115.00 + رصيد
        DB::table('pos_sessions')->where('id', $session['session_id'])->update(['cash_account_id' => null]);

        $this->posReturn($session['session_id'], $invoice)->assertCreated();   // legacy: 1110 كما كان
        $this->activate('main');
        $second = $this->posCheckout($session['session_id']);
        $before = $this->snapshot();
        $res = $this->posReturn($session['session_id'], $second)->assertStatus(422);
        $this->assertStringContainsString('لا تحمل خزينة مثبتة', (string) $res->json('message'));
        $this->assertSame($before, $this->snapshot());
    }

    /** @test */
    public function pos_withdraw_permission_is_enforced_on_the_session_treasury(): void
    {
        $t1111 = $this->newTreasury('خزينة 1111');
        $this->linkCashMethodTo($t1111);
        $session = $this->openSession();
        $this->activate('main');
        $invoice = $this->posCheckout($session['session_id']);
        $before = $this->snapshot();

        DB::table('cash_bank_accounts')->where('id', $t1111->id)->update(['deposit_scope' => 'all', 'withdraw_scope' => 'user', 'withdraw_scope_subject' => $this->user('admin')->id]);
        $res = $this->posReturn($session['session_id'], $invoice)->assertStatus(422);
        $this->assertStringContainsString('لا تملك صلاحية', (string) $res->json('message'));
        $this->assertSame($before, $this->snapshot());

        DB::table('cash_bank_accounts')->where('id', $t1111->id)->update(['withdraw_scope' => 'user', 'withdraw_scope_subject' => $this->owner->id]);
        $this->posReturn($session['session_id'], $invoice)->assertCreated();
    }

    /** @test */
    public function pos_refund_is_rejected_for_an_inactive_or_foreign_currency_session_treasury(): void
    {
        $t1111 = $this->newTreasury('خزينة 1111');
        $this->linkCashMethodTo($t1111);
        $session = $this->openSession();
        $this->activate('main');
        $invoice = $this->posCheckout($session['session_id']);
        $before = $this->snapshot();

        DB::table('cash_bank_accounts')->where('id', $t1111->id)->update(['currency' => 'USD']);
        $this->assertStringContainsString('عملة', (string) $this->posReturn($session['session_id'], $invoice)->assertStatus(422)->json('message'));

        DB::table('cash_bank_accounts')->where('id', $t1111->id)->update(['currency' => 'SAR', 'is_active' => false]);
        $this->assertStringContainsString('معطّل', (string) $this->posReturn($session['session_id'], $invoice)->assertStatus(422)->json('message'));
        $this->assertSame($before, $this->snapshot(), 'لا سقوط إلى 1110');
    }

    // ───────────────────────── عزل المستأجرين ─────────────────────────

    /** @test */
    public function another_tenants_session_and_treasury_never_resolve_for_a_pos_refund(): void
    {
        // مستأجر آخر بجلسته وخزينته
        $other = $this->registerTenant('t6-other', 'owner@t6-other.test');
        app(TenantContext::class)->set($other['tenant_id']);
        app(CashBankAccountService::class)->bootstrapDefaults();
        $foreignAccount = (string) DB::table('cash_bank_accounts')->where('tenant_id', $other['tenant_id'])->where('type', 'cash')->value('account_id');
        $this->assertNotSame('', $foreignAccount);
        app(TenantContext::class)->set($this->tenantId);

        $session = $this->openSession();
        $this->activate('main');
        $invoice = $this->posCheckout($session['session_id']);
        $before = $this->snapshot();

        // جلستنا تشير (SQL خام) إلى خزينة مستأجر آخر ⇒ لا تُحلّ ولا يُصرف منها
        DB::table('pos_sessions')->where('id', $session['session_id'])->update(['cash_account_id' => $foreignAccount]);
        $this->posReturn($session['session_id'], $invoice)->assertStatus(422);
        $this->assertSame($before, $this->snapshot());
        $this->assertSame(0, DB::table('journal_lines')->where('account_id', $foreignAccount)->where('tenant_id', $this->tenantId)->count(), 'لم يُكتب شيء على حساب أجنبي');

        // المحلِّل نفسه: جلسة مستأجر آخر لا تُرى (قراءة مقيَّدة) ⇒ فشل مغلق
        $foreignSession = $this->openSession($other)['session_id'];
        app(TenantContext::class)->set($this->tenantId);
        $e = $this->thrown(fn () => app(PosCashRefundTreasuryResolver::class)->resolve(\App\Models\PosSession::query()->find($foreignSession), $invoice, $this->owner), 'يجب أن يُرفض', TreasurySelectionException::class);
        $this->assertSame(TreasurySelectionException::SESSION_TREASURY_REQUIRED, $e->reason);
    }

    /** @test */
    public function the_general_return_derives_only_from_tenant_scoped_reads_a_foreign_entry_resolves_nothing(): void
    {
        $this->activate('main');
        $sale = $this->saleOf('cash');
        $other = $this->registerTenant('t6-other2', 'owner@t6-other2.test');
        app(TenantContext::class)->set($other['tenant_id']);
        $otherOwner = User::where('tenant_id', $other['tenant_id'])->firstOrFail();
        Settings::put('company', ['building_no' => '2322', 'street' => 'S', 'additional_no' => '1234', 'district' => 'D', 'city' => 'Dammam', 'postal_code' => '32241']);
        $p = \App\Models\Partner::create(['name' => 'عميل آخر', 'type' => 'customer'])->id;
        $prod = Product::create(['name' => 'خدمة', 'type' => 'service', 'track_inventory' => false]);
        $svc = app(InvoiceService::class);
        $foreign = $svc->post($svc->create(['partner_id' => $p, 'payment_type' => 'cash', 'zatca_document_type' => 'simplified'],
            [['product_id' => $prod->id, 'description' => 'x', 'quantity' => 1, 'unit_price' => 100000, 'tax_rate' => 15]]), null, $otherOwner);
        app(TenantContext::class)->set($this->tenantId);

        $return = $this->returnFor($sale);
        DB::table('invoices')->where('id', $sale->id)->update(['journal_entry_id' => $foreign->journal_entry_id]);
        $this->assertSame(TreasurySelectionException::SOURCE_TREASURY_UNRESOLVED, $this->reason(fn () => $this->postReturn($return, $this->owner)));
        $this->assertSame('draft', $return->fresh()->status);
    }

    // ───────────────────────── حرّاس ثابتة ─────────────────────────

    /** @test */
    public function every_treasury_rejection_reason_carries_a_readable_message(): void
    {
        $reasons = (new \ReflectionClass(TreasurySelectionException::class))->getConstants();
        $this->assertNotEmpty($reasons);
        foreach ($reasons as $name => $reason) {
            $this->assertNotSame('', TreasurySelectionException::for($reason)->getMessage(), "الرسالة فارغة للسبب {$name}");
            $this->assertSame($reason, TreasurySelectionException::for($reason)->reason);
        }
    }

    /** @test */
    public function the_pos_resolver_has_no_hard_coded_cash_code_no_catch_and_no_unscoped_reads(): void
    {
        $src = (string) file_get_contents(app_path('Services/Accounting/PosCashRefundTreasuryResolver.php'));
        $code = preg_replace('#/\*.*?\*/#s', '', $src);
        $this->assertDoesNotMatchRegularExpression("/'1110'|\"1110\"|catch\\s*\\(/", $code);
        foreach (['withoutGlobalScope', 'DB::table', 'DB::select', 'toBase()'] as $needle) {
            $this->assertStringNotContainsString($needle, $src);
        }
        $this->assertStringContainsString("'withdraw'", $src, 'اتجاه الصرف سحب لا إيداع');
    }

    /** @test */
    public function routed_branches_resolve_before_the_ledger_and_the_legacy_fallback_exists_only_on_the_legacy_branch(): void
    {
        $returns = (string) file_get_contents(app_path('Services/Accounting/ReturnService.php'));
        $this->assertStringContainsString('($cashAccountId ?? $this->accountId(self::ACC_CASH))', $returns);
        $this->assertLessThan(strpos($returns, 'postSalesReturn($return, $cashAccountId)'), strpos($returns, 'PosCashRefundTreasuryResolver::class)'), 'الحلّ قبل الترحيل');

        $exchange = (string) file_get_contents(app_path('Services/Accounting/PosExchangeService.php'));
        $this->assertStringContainsString('$treasuryAccountId ?? $this->accountId(self::ACC_CASH)', $exchange);
        $this->assertLessThan(strpos($exchange, '$this->postCashSurplus('), strpos($exchange, 'PosCashRefundTreasuryResolver::class)'), 'الحلّ قبل القيد');
    }
}
