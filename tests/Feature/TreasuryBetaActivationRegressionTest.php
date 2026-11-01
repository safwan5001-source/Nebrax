<?php

namespace Tests\Feature;

use App\Models\CashBankAccount;
use App\Models\Invoice;
use App\Models\JournalEntry;
use App\Models\PaymentMethod;
use App\Models\Product;
use App\Models\User;
use App\Services\Accounting\CashBankAccountService;
use App\Services\Accounting\LedgerService;
use App\Support\Settings;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * ═══════════════════════════════════════════════════════════════
 *  TREASURY — انحدار شامل من طرف إلى طرف عبر الـAPI بعد تفعيل توجيه النقد (T4+T5+T6)
 * ═══════════════════════════════════════════════════════════════
 *  يثبّت ما أُثبت يدوياً عند تفعيل Beta: التفعيل كما يجري فعلاً (بوابة مفتوحة + `PUT /sales-settings` سياسة `main`)
 *  ثم المسارات النقدية الأربعة عبر HTTP لا عبر الخدمات مباشرةً:
 *   • البيع النقدي ⇒ مدين الخزينة الرئيسية (1110 كمستأجر Beta، أو 1111 حين تتحرك الرئيسية).
 *   • المرتجع النقدي والإشعار الدائن المرتبطان بالفاتورة ⇒ دائن الخزينة التي حصّلت البيع.
 *   • المرتجع/الإشعار المستقل أو بلا مصدر صالح ⇒ 422 برسالة مقروءة وبلا قيد.
 *   • POS: بيع نقدي ثم مرتجع نقدي ⇒ خزينة الجلسة؛ وإعادة الـcheckout بالمفتاح نفسه لا تكرّر الترحيل.
 *   • لا ترحيل مكرر، الدفتر متوازن، الصلاحيات (403)، عزل المستأجر (404/422)، وتنظيف بالعكس المحاسبي وحده.
 *
 *  هذا الملف يكمّل لا يكرّر: اختبارات الخدمات التفصيلية (T3–T6) تبقى في `Treasury*Test`؛ هنا طبقة HTTP/الإعدادات والمنظومة كاملة.
 *  يعمل على قاعدة الاختبار المعزولة (SQLite وPostgreSQL في CI) ولا يمسّ أي قاعدة خارجية.
 */
class TreasuryBetaActivationRegressionTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    private const NET = 40000;      // 4 × 100.00
    private const TAX = 6000;       // 15%
    private const TOTAL = 46000;
    private const UNIT_REFUND = 11500; // 1 × 100.00 + 15%

    // ───────────────────────── مساعدات ─────────────────────────

    /** مستأجر جديد كامل التهيئة (عنوان الشركة لـZATCA، الخزائن الافتراضية، عميل ومنتج خدمي). */
    private function tenant(string $slug): array
    {
        $auth = $this->registerTenant($slug, "owner@{$slug}.test");
        app(TenantContext::class)->set($auth['tenant_id']);
        Settings::put('company', [
            'building_no' => '2322', 'street' => 'Synthetic Street', 'additional_no' => '1234',
            'district' => 'Synthetic District', 'city' => 'Dammam', 'postal_code' => '32241',
        ]);
        app(CashBankAccountService::class)->bootstrapDefaults();
        $auth['partner'] = $this->withToken($auth['token'])->postJson('/api/partners', ['name' => 'عميل انحدار', 'type' => 'customer'])->assertCreated()['data']['id'];
        $auth['product'] = Product::create(['name' => 'خدمة', 'type' => 'service', 'track_inventory' => false, 'sale_price' => 10000])->id;

        return $auth;
    }

    /** التفعيل كما جرى على Beta: بوابة النشر مفتوحة + السياسة `main` عبر نقطة الإعدادات نفسها (لا كتابة مباشرة). */
    private function activate(array $auth): void
    {
        config(['treasury.cash_sale_routing_enabled' => true]);
        $this->withToken($auth['token'])->putJson('/api/sales-settings', ['cash_sale_treasury_policy' => 'main'])
            ->assertOk()
            ->assertJsonPath('data.cash_sale_treasury_policy_effective', 'main');
    }

    /** يجعل خزينة جديدة (1111) هي الرئيسية وطريقة الدفع النقدية مربوطة بها، كمستأجر حرّك رئيسيته. */
    private function moveMainTo1111(array $auth): CashBankAccount
    {
        $svc = app(CashBankAccountService::class);
        $owner = User::where('tenant_id', $auth['tenant_id'])->where('role', 'owner')->firstOrFail();
        $created = $svc->create(['type' => 'cash', 'name' => 'خزينة 1111', 'currency' => 'SAR', 'deposit_scope' => 'all', 'withdraw_scope' => 'all'], $owner);
        $entity = CashBankAccount::with('account')->findOrFail($created->id);
        $svc->makeMain($entity);
        PaymentMethod::where('settlement_type', 'cash')->orderByDesc('is_default')->firstOrFail()->update(['cash_bank_account_id' => $entity->id]);
        $this->assertSame('1111', $entity->account->code, 'الخزينة المضافة تأخذ 1111');

        return $entity;
    }

    private function cashSale(array $auth, int $quantity = 4): array
    {
        $draft = $this->withToken($auth['token'])->postJson('/api/invoices', [
            'partner_id' => $auth['partner'], 'payment_type' => 'cash', 'zatca_document_type' => 'simplified',
            'items' => [['product_id' => $auth['product'], 'description' => 'خدمة', 'quantity' => $quantity, 'unit_price' => 10000, 'tax_rate' => 15]],
        ])->assertCreated()['data'];

        return $this->withToken($auth['token'])->postJson("/api/invoices/{$draft['id']}/post")->assertOk()['data'];
    }

    /** @return array{0:array,1:\Illuminate\Testing\TestResponse} */
    private function linkedReturn(array $auth, array $sale): array
    {
        $return = $this->withToken($auth['token'])->postJson('/api/returns', [
            'type' => 'sales', 'partner_id' => $auth['partner'], 'payment_type' => 'cash', 'original_id' => $sale['id'],
            'items' => [['source_line_id' => $sale['lines'][0]['id'], 'product_id' => $auth['product'], 'quantity' => 1, 'unit_price' => 10000, 'tax_rate' => 15]],
        ])->assertCreated()['data'];

        return [$return, $this->withToken($auth['token'])->postJson("/api/returns/{$return['id']}/post")];
    }

    /** @return array{0:array,1:\Illuminate\Testing\TestResponse} */
    private function linkedCreditNote(array $auth, array $sale): array
    {
        $note = $this->withToken($auth['token'])->postJson('/api/credit-notes', [
            'partner_id' => $sale['partner_id'], 'original_invoice_id' => $sale['id'], 'refund_type' => 'cash',
            'items' => [['source_line_id' => $sale['lines'][0]['id'], 'quantity' => 1]],
        ])->assertCreated()['data'];

        return [$note, $this->withToken($auth['token'])->postJson("/api/credit-notes/{$note['id']}/post")];
    }

    private function openPosSession(array $auth): string
    {
        $n = Str::random(5);
        $wh = $this->withToken($auth['token'])->postJson('/api/warehouses', ['name' => "مخزن {$n}", 'code' => "RG-W-{$n}", 'is_active' => true])->assertCreated()['data']['id'];
        $dev = $this->withToken($auth['token'])->postJson('/api/pos-devices', ['name' => "كاشير {$n}", 'code' => "RG-D-{$n}", 'warehouse_id' => $wh, 'is_active' => true])->assertCreated()['data']['id'];

        return $this->withToken($auth['token'])->postJson('/api/pos-sessions/open', ['opening_balance' => 0, 'pos_device_id' => $dev])->assertCreated()['data']['id'];
    }

    /** @return array{0:array,1:\Illuminate\Testing\TestResponse,2:array} بيع POS نقدي، إعادته بالمفتاح نفسه، ثم مرتجعه النقدي */
    private function posCashSaleReplayAndReturn(array $auth, string $session): array
    {
        $product = Product::create(['name' => 'صنف pos '.Str::random(4), 'sale_price' => 10000, 'track_inventory' => false, 'quantity_on_hand' => 0, 'avg_cost' => 0])->id;
        $body = [
            'idempotency_key' => (string) Str::uuid(), 'partner_id' => $auth['partner'], 'pos_session_id' => $session,
            'items' => [['product_id' => $product, 'quantity' => 1, 'unit_price' => 10000, 'tax_rate' => 15, 'discount' => 0]],
            'tenders' => ['cash' => 11500],
        ];
        $sale = $this->withToken($auth['token'])->postJson('/api/pos/checkout', $body)->assertCreated()['data'];
        $replay = $this->withToken($auth['token'])->postJson('/api/pos/checkout', $body);
        $invoice = Invoice::with('lines')->findOrFail($sale['id']);
        $return = $this->withToken($auth['token'])->postJson('/api/pos/returns', [
            'idempotency_key' => (string) Str::uuid(), 'pos_session_id' => $session, 'original_invoice_id' => $invoice->id, 'payment_type' => 'cash',
            'items' => [['source_line_id' => $invoice->lines->firstOrFail()->id, 'quantity' => 1]],
        ])->assertCreated()['data'];

        return [$sale, $replay, $return];
    }

    /** أسطر القيد الوحيد للمستند، مرتّبة "CODE Dr|Cr amount"؛ يفشل إن لم يكن قيداً واحداً متوازناً. */
    private function entryLines(string $sourceId): array
    {
        $entries = JournalEntry::with('lines.account')->where('source_id', $sourceId)->get();
        $this->assertCount(1, $entries, 'قيد واحد بالضبط للمستند (لا ترحيل مكرر)');
        $lines = $entries->first()->lines;
        $this->assertSame((int) $lines->sum('debit'), (int) $lines->sum('credit'), 'القيد متوازن');
        $out = $lines->map(fn ($l) => $l->account->code.($l->debit ? ' Dr '.$l->debit : ' Cr '.$l->credit))->all();
        sort($out);

        return $out;
    }

    /** أسطر كل قيود مستند (قد يحمل المستند أكثر من قيد، كفاتورة POS وسند قبضها) */
    private function allLines(string $sourceId): array
    {
        return DB::table('journal_lines as l')->join('journal_entries as e', 'e.id', '=', 'l.journal_entry_id')->join('accounts as a', 'a.id', '=', 'l.account_id')
            ->where('e.source_id', $sourceId)->orderBy('a.code')->get(['a.code', 'l.debit', 'l.credit'])
            ->map(fn ($r) => $r->code.($r->debit ? ' Dr '.$r->debit : ' Cr '.$r->credit))->all();
    }

    private function refundShape(string $treasuryCode): array
    {
        return ["{$treasuryCode} Cr ".self::UNIT_REFUND, '2120 Dr 1500', '4110 Dr 10000'];
    }

    private function treasuryBalance(string $code): int
    {
        return (int) DB::table('journal_lines as l')->join('accounts as a', 'a.id', '=', 'l.account_id')
            ->where('a.code', $code)->selectRaw('coalesce(sum(l.debit - l.credit), 0) as b')->value('b');
    }

    private function assertLedgerBalanced(): void
    {
        $this->assertSame((int) DB::table('journal_lines')->sum('debit'), (int) DB::table('journal_lines')->sum('credit'), 'Σمدين = Σدائن للدفتر كله');
        $this->assertSame(0, DB::table('journal_lines')->select('journal_entry_id')->groupBy('journal_entry_id')->havingRaw('sum(debit) <> sum(credit)')->get()->count(), 'لا قيد غير متوازن');
    }

    // ───────────────────────── البيع النقدي والتفعيل ─────────────────────────

    /** @test */
    public function activation_through_the_settings_endpoint_routes_a_cash_sale_to_the_main_treasury_1110_and_refuses_a_second_posting(): void
    {
        $a = $this->tenant('treasury-reg-a');
        $this->activate($a);

        $sale = $this->cashSale($a);

        $this->assertSame(['1110 Dr '.self::TOTAL, '2120 Cr '.self::TAX, '4110 Cr '.self::NET], $this->entryLines($sale['id']));
        $this->withToken($a['token'])->postJson("/api/invoices/{$sale['id']}/post")->assertStatus(422);
        $this->assertCount(1, JournalEntry::where('source_id', $sale['id'])->get(), 'المحاولة الثانية لا تضيف قيداً');
        $this->assertLedgerBalanced();
    }

    // ───────────────────────── المرتجع والإشعار الدائن المرتبطان ─────────────────────────

    /** @test */
    public function a_linked_cash_return_and_a_linked_credit_note_credit_the_treasury_that_collected_the_sale_and_cannot_be_posted_twice(): void
    {
        $a = $this->tenant('treasury-reg-b');
        $this->activate($a);
        $sale = $this->cashSale($a);

        [$return, $returnPost] = $this->linkedReturn($a, $sale);
        $returnPost->assertOk();
        [$note, $notePost] = $this->linkedCreditNote($a, $sale);
        $notePost->assertOk();

        $this->assertSame($this->refundShape('1110'), $this->entryLines($return['id']));
        $this->assertSame($this->refundShape('1110'), $this->entryLines($note['id']));
        $this->withToken($a['token'])->postJson("/api/returns/{$return['id']}/post")->assertStatus(422);
        $this->withToken($a['token'])->postJson("/api/credit-notes/{$note['id']}/post")->assertStatus(422);
        $this->assertSame(1, JournalEntry::where('source_id', $return['id'])->count());
        $this->assertSame(1, JournalEntry::where('source_id', $note['id'])->count());
        $this->assertLedgerBalanced();
    }

    /** @test */
    public function a_standalone_cash_return_is_refused_with_a_readable_reason_and_leaves_no_entry(): void
    {
        $a = $this->tenant('treasury-reg-c');
        $this->activate($a);
        $standalone = $this->withToken($a['token'])->postJson('/api/returns', [
            'type' => 'sales', 'partner_id' => $a['partner'], 'payment_type' => 'cash',
            'items' => [['product_id' => $a['product'], 'quantity' => 1, 'unit_price' => 10000, 'tax_rate' => 15]],
        ])->assertCreated()['data'];
        $entries = JournalEntry::count();

        $rejected = $this->withToken($a['token'])->postJson("/api/returns/{$standalone['id']}/post")->assertStatus(422);

        $this->assertNotSame('', trim((string) $rejected->json('message')), 'رفض الخزينة يحمل رسالة مقروءة');
        $this->assertSame($entries, JournalEntry::count(), 'لا قيد');
        $this->assertSame('draft', \App\Models\ReturnDocument::findOrFail($standalone['id'])->status, 'تبقى مسودة قابلة للتحويل إلى مسار آجل');
    }

    // ───────────────────────── POS ─────────────────────────

    /** @test */
    public function a_pos_cash_return_credits_the_session_treasury_and_a_checkout_replay_with_the_same_key_does_not_double_post(): void
    {
        $a = $this->tenant('treasury-reg-d');
        $this->activate($a);
        $session = $this->openPosSession($a);

        [$sale, $replay, $return] = $this->posCashSaleReplayAndReturn($a, $session);

        $this->assertSame($sale['id'], $replay->json('data.id'), 'إعادة الـcheckout بالمفتاح نفسه تعيد الفاتورة نفسها');
        $this->assertSame(1, Invoice::where('id', $sale['id'])->count());
        $this->assertSame(1, JournalEntry::where('source_id', $sale['id'])->count(), 'بلا ترحيل مكرر للفاتورة');
        $this->assertContains('1110 Cr '.self::UNIT_REFUND, $this->allLines($return['id']));
        $this->assertLedgerBalanced();
    }

    // ───────────────────────── رئيسية على 1111 بدل 1110 ─────────────────────────

    /** @test */
    public function with_the_main_treasury_on_1111_the_sale_return_note_and_pos_all_route_there_and_1110_stays_untouched(): void
    {
        $a = $this->tenant('treasury-reg-e');
        $this->moveMainTo1111($a);
        $this->activate($a);

        $sale = $this->cashSale($a);
        $this->assertSame(['1111 Dr '.self::TOTAL, '2120 Cr '.self::TAX, '4110 Cr '.self::NET], $this->entryLines($sale['id']));

        [$return, $returnPost] = $this->linkedReturn($a, $sale);
        $returnPost->assertOk();
        [$note, $notePost] = $this->linkedCreditNote($a, $sale);
        $notePost->assertOk();
        $this->assertSame($this->refundShape('1111'), $this->entryLines($return['id']));
        $this->assertSame($this->refundShape('1111'), $this->entryLines($note['id']));

        $session = $this->openPosSession($a);
        [, , $posReturn] = $this->posCashSaleReplayAndReturn($a, $session);
        $this->assertContains('1111 Cr '.self::UNIT_REFUND, $this->allLines($posReturn['id']));

        // بيع 46000 − مرتجع 11500 − إشعار 11500 + قبض POS 11500 − مرتجع POS 11500
        $this->assertSame(23000, $this->treasuryBalance('1111'));
        $this->assertSame(0, $this->treasuryBalance('1110'), '1110 القديمة لم تُمسّ');
        $this->assertLedgerBalanced();
    }

    // ───────────────────────── التنظيف بالعكس المحاسبي ─────────────────────────

    /** @test */
    public function reversing_every_posted_entry_through_the_ledger_nets_the_treasuries_to_zero_without_deleting_anything(): void
    {
        $a = $this->tenant('treasury-reg-f');
        $this->moveMainTo1111($a);
        $this->activate($a);
        $sale = $this->cashSale($a);
        $this->linkedReturn($a, $sale)[1]->assertOk();
        $this->linkedCreditNote($a, $sale)[1]->assertOk();
        $this->posCashSaleReplayAndReturn($a, $this->openPosSession($a));
        $posted = JournalEntry::where('status', 'posted')->get();
        $this->assertGreaterThanOrEqual(5, $posted->count());

        foreach ($posted as $entry) {
            app(LedgerService::class)->reverse($entry, null, 'treasury regression cleanup');
        }

        $this->assertSame(0, $this->treasuryBalance('1111'));
        $this->assertSame(0, $this->treasuryBalance('1110'));
        $this->assertGreaterThanOrEqual($posted->count() * 2, JournalEntry::count(), 'العكس يضيف قيوداً ولا يحذف الأصلية');
        $this->assertLedgerBalanced();
    }

    // ───────────────────────── الصلاحيات وعزل المستأجر ─────────────────────────

    /** @test */
    public function the_policy_endpoint_and_invoice_posting_are_permission_gated_and_a_denied_post_leaves_the_draft_untouched(): void
    {
        $a = $this->tenant('treasury-reg-g');
        $this->activate($a);
        $accountant = $this->tokenForRole($a['tenant_id'], 'accountant', 'acct@treasury-reg-g.test');
        $staff = $this->tokenForRole($a['tenant_id'], 'staff', 'staff@treasury-reg-g.test');
        $draft = $this->withToken($a['token'])->postJson('/api/invoices', [
            'partner_id' => $a['partner'], 'payment_type' => 'cash', 'zatca_document_type' => 'simplified',
            'items' => [['product_id' => $a['product'], 'description' => 'خدمة', 'quantity' => 1, 'unit_price' => 1000, 'tax_rate' => 15]],
        ])->assertCreated()['data'];

        $this->withToken($accountant)->putJson('/api/sales-settings', ['cash_sale_treasury_policy' => 'legacy'])->assertForbidden();
        $this->withToken($staff)->postJson("/api/invoices/{$draft['id']}/post")->assertForbidden();

        $this->assertSame('draft', Invoice::findOrFail($draft['id'])->status);
        $this->assertSame('main', Settings::get('sales', 'cash_sale_treasury_policy'), 'السياسة لم تتغيّر');
        $this->assertSame(0, JournalEntry::count());
    }

    /** @test */
    public function another_tenant_can_neither_read_post_nor_refund_a_foreign_sale_nor_pick_a_foreign_treasury(): void
    {
        $a = $this->tenant('treasury-reg-h1');
        $b = $this->tenant('treasury-reg-h2');
        $this->activate($a);
        $this->activate($b);
        $sale = $this->cashSale($a);

        app(TenantContext::class)->set($b['tenant_id']);
        $foreignTreasury = CashBankAccount::where('type', 'cash')->where('is_main', true)->firstOrFail()->account_id;
        app(TenantContext::class)->set($a['tenant_id']);
        $entries = JournalEntry::count();

        $this->withToken($b['token'])->getJson("/api/invoices/{$sale['id']}")->assertNotFound();
        $this->withToken($b['token'])->postJson("/api/invoices/{$sale['id']}/post")->assertNotFound();
        $this->withToken($b['token'])->postJson('/api/returns', [
            'type' => 'sales', 'partner_id' => $b['partner'], 'payment_type' => 'cash', 'original_id' => $sale['id'],
            'items' => [['product_id' => $b['product'], 'quantity' => 1, 'unit_price' => 10000, 'tax_rate' => 15]],
        ])->assertStatus(422);
        $this->withToken($a['token'])->postJson('/api/invoices', [
            'partner_id' => $a['partner'], 'payment_type' => 'cash', 'cash_account_id' => $foreignTreasury,
            'items' => [['product_id' => $a['product'], 'description' => 'خدمة', 'quantity' => 1, 'unit_price' => 1000, 'tax_rate' => 15]],
        ])->assertStatus(422);

        $this->assertSame($entries, JournalEntry::count(), 'محاولات العبور لم تُنتج أي قيد');
    }

    /** @test */
    public function a_cash_return_is_refused_without_an_entry_when_the_actor_may_not_withdraw_from_the_collecting_treasury(): void
    {
        $a = $this->tenant('treasury-reg-i');
        $this->activate($a);
        $sale = $this->cashSale($a);
        $other = User::create(['tenant_id' => $a['tenant_id'], 'name' => 'مدير آخر', 'email' => 'other@treasury-reg-i.test', 'password' => 'password123', 'role' => 'admin']);
        $main = CashBankAccount::where('type', 'cash')->where('is_main', true)->firstOrFail();
        DB::table('cash_bank_accounts')->where('id', $main->id)->update(['withdraw_scope' => 'user', 'withdraw_scope_subject' => $other->id]);
        $entries = JournalEntry::count();

        [$return, $post] = $this->linkedReturn($a, $sale);

        $post->assertStatus(422);
        $this->assertSame($entries, JournalEntry::count(), 'لا قيد عند رفض السحب');
        $this->assertSame('draft', \App\Models\ReturnDocument::findOrFail($return['id'])->status);

        DB::table('cash_bank_accounts')->where('id', $main->id)->update(['withdraw_scope' => 'all', 'withdraw_scope_subject' => null]);
        $this->withToken($a['token'])->postJson("/api/returns/{$return['id']}/post")->assertOk();
        $this->assertSame($this->refundShape('1110'), $this->entryLines($return['id']));
    }
}
