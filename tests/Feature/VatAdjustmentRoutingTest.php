<?php

namespace Tests\Feature;

use App\Models\Account;
use App\Models\AccountRoleMapping;
use App\Models\Branch;
use App\Models\CreditNote;
use App\Models\FiscalYear;
use App\Models\Invoice;
use App\Models\JournalEntry;
use App\Models\JournalLine;
use App\Models\Partner;
use App\Models\Product;
use App\Models\Purchase;
use App\Models\ReturnDocument;
use App\Models\Tenant;
use App\Models\User;
use App\Services\Accounting\AccountRoutingService;
use App\Services\Accounting\ChartOfAccountsSeeder;
use App\Services\Accounting\FiscalCloseService;
use App\Services\Accounting\FiscalYearService;
use App\Services\Accounting\InvoiceService;
use App\Services\Accounting\LedgerService;
use App\Services\Accounting\PurchaseService;
use App\Services\Accounting\ReturnService;
use App\Services\Reporting\ReportService;
use App\Services\TenantApplicationService;
use App\Support\Settings;
use App\Tenancy\BranchContext;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use RuntimeException;
use Tests\TestCase;

/**
 * REM-06 / ACC-02 (R6-1, R6-2 — Option A): مستندات التسوية التجارية الجديدة (مرتجع مبيعات، إشعار دائن،
 * إشعار مدين) تحلّ دور الضريبة **الحالي** وقت الترحيل، لا حساب المستند الأصلي. العكس المحاسبي الحقيقي
 * (`LedgerService::reverse`) يعكس الحسابات الأصلية. مرتجع المشتريات (ACC-4) بلا تغيير.
 *
 * فاتورة 1,000.00 + 15% ثم إرجاعها كاملةً بعد إعادة تعيين `tax_output` من 2120 إلى 2125 (SAR):
 *   | الحساب            | مدين     | دائن     |
 *   | 4110 المبيعات     | 100000   |          |
 *   | 2125 tax_output   |  15000   |          |   ← كان 2120 دائماً
 *   | 1130 العملاء      |          | 115000   |
 *
 * تشغيل: php artisan test --filter=VatAdjustmentRoutingTest
 */
class VatAdjustmentRoutingTest extends TestCase
{
    use RefreshDatabase;

    protected Tenant $tenant;
    protected User $user;
    protected Partner $customer;
    protected Partner $supplier;
    protected Product $service;

    protected function setUp(): void
    {
        parent::setUp();

        $this->tenant = Tenant::create([
            'name' => 'نبراس الطموح', 'slug' => 'nibras-vat-adj',
            'vat_number' => '300000000000003', 'currency' => 'SAR',
        ]);
        app(TenantContext::class)->set($this->tenant->id);
        app(ChartOfAccountsSeeder::class)->seed($this->tenant->id);
        app(TenantApplicationService::class)->enable('purchases.cycle', null);

        $this->customer = Partner::create(['name' => 'عميل', 'type' => 'customer']);
        $this->supplier = Partner::create(['name' => 'مورد', 'type' => 'supplier']);
        $this->service = Product::create(['name' => 'خدمة', 'track_inventory' => false]);

        $this->user = User::create([
            'tenant_id' => $this->tenant->id, 'name' => 'مدير',
            'email' => 'admin@vat-adj.sa', 'password' => bcrypt('secret1234'), 'role' => 'owner',
        ]);
        Sanctum::actingAs($this->user);
    }

    /** `SetTenant` ينسى المستأجر بعد كل طلب؛ فيُعاد سياق التهيئة ليتابع الاختبار بالخدمات مباشرة. */
    public function call($method, $uri, $parameters = [], $cookies = [], $files = [], $server = [], $content = null)
    {
        $tenant = app(TenantContext::class);
        $setup = $tenant->id();

        try {
            return parent::call($method, $uri, $parameters, $cookies, $files, $server, $content);
        } finally {
            $setup === null ? $tenant->forget() : $tenant->set($setup);
        }
    }

    // ───────────────────────────── مساعدات ─────────────────────────────

    private function byCode(string $code): Account
    {
        return Account::where('code', $code)->firstOrFail();
    }

    private function vatAccount(string $code, string $type, ?string $tenantId = null): Account
    {
        return Account::create([
            'tenant_id' => $tenantId ?? $this->tenant->id, 'code' => $code, 'name' => "ضريبة {$code}",
            'type' => $type, 'normal_balance' => $type === 'asset' ? 'debit' : 'credit', 'is_group' => false, 'is_active' => true,
        ]);
    }

    private function remap(string $role, Account $account): void
    {
        app(AccountRoutingService::class)->setMapping($role, $account->id, null);
    }

    private function reset(string $role): void
    {
        app(AccountRoutingService::class)->reset($role, null);
    }

    private function sale(int $unitPrice = 100000, int $rate = 15, string $date = '2026-01-10'): Invoice
    {
        $svc = app(InvoiceService::class);
        $invoice = $svc->create(
            ['partner_id' => $this->customer->id, 'payment_type' => 'credit', 'invoice_date' => $date],
            [['product_id' => $this->service->id, 'quantity' => 1, 'unit_price' => $unitPrice, 'tax_rate' => $rate]],
        );

        return $svc->post($invoice);
    }

    private function purchaseDoc(int $unitPrice = 100000, string $date = '2026-01-10'): Purchase
    {
        $svc = app(PurchaseService::class);
        $purchase = $svc->create(
            ['partner_id' => $this->supplier->id, 'payment_type' => 'credit', 'purchase_date' => $date],
            [['product_id' => $this->service->id, 'quantity' => 1, 'unit_price' => $unitPrice, 'tax_rate' => 15]],
        );

        return $svc->post($purchase);
    }

    private function salesReturn(Invoice $invoice, string $date = '2026-02-15', bool $post = true): ReturnDocument
    {
        $line = $invoice->lines->first();
        $svc = app(ReturnService::class);
        $return = $svc->create([
            'type' => 'sales', 'partner_id' => $invoice->partner_id, 'payment_type' => 'credit',
            'original_id' => $invoice->id, 'return_date' => $date,
        ], [[
            'product_id' => $line->product_id, 'source_line_id' => $line->id,
            'quantity' => (int) $line->quantity, 'unit_price' => (int) $line->unit_price, 'tax_rate' => 15,
        ]]);

        return $post ? $svc->post($return) : $return;
    }

    private function purchaseReturn(Purchase $purchase, string $date = '2026-02-15'): ReturnDocument
    {
        $line = $purchase->lines->first();
        $svc = app(ReturnService::class);
        $return = $svc->create([
            'type' => 'purchase', 'partner_id' => $purchase->partner_id, 'payment_type' => 'credit',
            'original_id' => $purchase->id, 'return_date' => $date,
        ], [[
            'product_id' => $line->product_id, 'source_line_id' => $line->id,
            'quantity' => (int) $line->quantity, 'unit_price' => (int) $line->unit_price, 'tax_rate' => 15,
        ]]);

        return $svc->post($return);
    }

    /** إشعار دائن مرتبط بفاتورة (API — مسار الشاشة). */
    private function salesNote(Invoice $invoice, bool $post = true, ?string $date = '2026-02-16'): CreditNote
    {
        $id = $this->postJson('/api/credit-notes', [
            'partner_id' => $invoice->partner_id, 'original_invoice_id' => $invoice->id, 'note_date' => $date,
            'items' => [['source_line_id' => $invoice->lines->first()->id, 'quantity' => 1]],
        ])->assertCreated()->json('data.id');
        if ($post) {
            $this->postJson("/api/credit-notes/{$id}/post")->assertOk();
        }

        return CreditNote::findOrFail($id);
    }

    private function standaloneSalesNote(bool $post = true): CreditNote
    {
        Settings::put('sales', ['allow_standalone_credit_notes' => true]);
        $id = $this->postJson('/api/credit-notes', [
            'partner_id' => $this->customer->id, 'type' => 'sales', 'note_date' => '2026-02-17',
            'items' => [['description' => 'تسوية', 'quantity' => 1, 'unit_price' => 100000, 'tax_rate' => 15]],
        ])->assertCreated()->json('data.id');
        if ($post) {
            $this->postJson("/api/credit-notes/{$id}/post")->assertOk();
        }

        return CreditNote::findOrFail($id);
    }

    /** إشعار مدين مرتبط بفاتورة مشتريات. */
    private function purchaseNote(Purchase $purchase, bool $post = true): CreditNote
    {
        $id = $this->postJson('/api/credit-notes', [
            'partner_id' => $purchase->partner_id, 'original_purchase_id' => $purchase->id, 'note_date' => '2026-02-16',
            'items' => [['description' => 'خصم مورد', 'quantity' => 1, 'unit_price' => 100000, 'tax_rate' => 15]],
        ])->assertCreated()->json('data.id');
        if ($post) {
            $this->postJson("/api/credit-notes/{$id}/post")->assertOk();
        }

        return CreditNote::findOrFail($id);
    }

    /** @return array<string, array{0:int,1:int}> كود الحساب => [مدين، دائن] (مع التحقق من التوازن) */
    private function journal(string $sourceType, string $sourceId): array
    {
        $entry = JournalEntry::with('lines.account')->where('source_type', $sourceType)->where('source_id', $sourceId)->sole();
        $this->assertSame((int) $entry->lines->sum('debit'), (int) $entry->lines->sum('credit'), 'قيد غير متوازن');

        $out = [];
        foreach ($entry->lines as $l) {
            $code = $l->account->code;
            $out[$code] = [($out[$code][0] ?? 0) + (int) $l->debit, ($out[$code][1] ?? 0) + (int) $l->credit];
        }

        return $this->canonical($out);
    }

    /**
     * ترتيبٌ قانونيّ بالرمز: علاقة `lines` بلا ORDER BY، فترتيب السطور غير مضمون على PostgreSQL،
     * و`assertSame` يقارن ترتيب المفاتيح. القيم (مدين/دائن لكل حساب) تبقى مقارَنةً حرفياً.
     *
     * @param  array<string, array{0: int, 1: int}>  $journal
     * @return array<string, array{0: int, 1: int}>
     */
    private function canonical(array $journal): array
    {
        ksort($journal, SORT_STRING);

        return $journal;
    }

    private function balanceOf(string $code): int
    {
        $a = $this->byCode($code);

        return (int) JournalLine::where('account_id', $a->id)->sum('debit') - (int) JournalLine::where('account_id', $a->id)->sum('credit');
    }

    private function assertBooksBalanced(): void
    {
        $this->assertSame((int) JournalLine::sum('debit'), (int) JournalLine::sum('credit'), 'الدفتر كله يجب أن يتوازن');
    }

    private function tax(array $filters = []): array
    {
        return app(ReportService::class)->taxReport($filters);
    }

    // ───────────────── 1) مرتجع المبيعات: قبل/بعد إعادة التعيين ─────────────────

    /** @test */
    public function a_sales_return_with_default_mappings_is_byte_identical_to_before(): void
    {
        $return = $this->salesReturn($this->sale());

        $this->assertSame(
            $this->canonical(['4110' => [100000, 0], '2120' => [15000, 0], '1130' => [0, 115000]]),
            $this->journal(ReturnDocument::class, $return->id)
        );
        $this->assertSame([15000, 115000], [(int) $return->fresh()->tax_amount, (int) $return->fresh()->total]);
        $this->assertSame(0, $this->tax()['output_vat']);
        $this->assertSame('verified', $this->tax()['verification']['status']);
    }

    /** @test */
    public function a_sales_return_after_a_remap_debits_the_current_role_and_leaves_the_original_invoice_untouched(): void
    {
        $invoice = $this->sale();                                    // VAT 150.00 دائن 2120
        $invoiceJournalBefore = $this->journal(Invoice::class, $invoice->id);
        $custom = $this->vatAccount('2125', 'liability');
        $this->remap('tax_output', $custom);

        $return = $this->salesReturn($invoice);

        $this->assertSame(
            $this->canonical(['4110' => [100000, 0], '2125' => [15000, 0], '1130' => [0, 115000]]),
            $this->journal(ReturnDocument::class, $return->id)
        );
        $this->assertSame($invoiceJournalBefore, $this->journal(Invoice::class, $invoice->id));   // لم يُمَسّ

        // أرصدة الحسابات (مدين − دائن): 2120 دائن 150.00 متبقٍّ، 2125 مدين 150.00.
        $this->assertSame(-15000, $this->balanceOf('2120'));
        $this->assertSame(15000, $this->balanceOf('2125'));

        // تقرير REM-05: مجموع حسابات الدور = صفر (فاتورة − مرتجع)، موثَّق.
        $report = $this->tax();
        $this->assertSame(0, $report['output_vat']);
        $this->assertSame('verified', $report['verification']['status']);
        // ACC-02-FC: كان هذا الاختبار يثبّت الإفصاح {−15000، 0، 15000} لأن سطر الإقفال كان يقرأ 2125 وحده. صار الإقفال
        // يقرأ مجموعة الحسابات حتى نهاية السنة فيطابق التقرير (0) ويُسحب الإفصاح؛ ويبقى −15000 مرجعاً للحساب الحالي.
        $this->assertSame([], $report['disclosures']);
        $year = FiscalYear::findOrFail(app(FiscalYearService::class)->create(
            ['name' => '2026', 'start_date' => '2026-01-01', 'end_date' => '2026-12-31'], null
        )['id']);
        $vat = collect(app(FiscalCloseService::class)->readiness($year)['info'])->firstWhere('code', 'vat_balances');
        $this->assertSame($report['output_vat'], $vat['details']['tax_output']);
        $this->assertSame(['2125', -15000], [
            $vat['details']['current_account']['tax_output']['code'],
            $vat['details']['current_account']['tax_output']['balance'],
        ]);
        $this->assertBooksBalanced();
    }

    /** @test */
    public function multiple_remaps_route_each_adjustment_to_the_role_in_force_and_never_rewrite_earlier_ones(): void
    {
        $a = $this->vatAccount('2125', 'liability');
        $b = $this->vatAccount('2126', 'liability');
        $s1 = $this->sale(date: '2026-01-10');
        $s2 = $this->sale(date: '2026-01-11');
        $s3 = $this->sale(date: '2026-01-12');
        $s4 = $this->sale(date: '2026-01-13');

        $r1 = $this->salesReturn($s1, '2026-02-01');            // 2120
        $this->remap('tax_output', $a);
        $r2 = $this->salesReturn($s2, '2026-02-02');            // 2125
        $this->remap('tax_output', $b);
        $r3 = $this->salesReturn($s3, '2026-02-03');            // 2126
        $this->reset('tax_output');
        $r4 = $this->salesReturn($s4, '2026-02-04');            // 2120 مجدداً

        foreach ([[$r1, '2120'], [$r2, '2125'], [$r3, '2126'], [$r4, '2120']] as [$r, $code]) {
            $j = $this->journal(ReturnDocument::class, $r->id);
            $this->assertSame([15000, 0], $j[$code], "VAT of {$r->number}");
            $this->assertCount(3, $j);
        }
        $this->assertSame(0, $this->tax()['output_vat']);       // 4 فواتير − 4 مرتجعات
        $this->assertBooksBalanced();
    }

    /** @test */
    public function vat_amounts_and_rounding_are_unchanged_by_routing(): void
    {
        $this->remap('tax_output', $this->vatAccount('2125', 'liability'));

        // 333.33 × 15% = 49.9995 ⇒ 50.00 (نفس دالة الاشتقاق من سطر المصدر).
        $invoice = $this->sale(unitPrice: 33333);
        $return = $this->salesReturn($invoice);

        $this->assertSame(
            $this->canonical(['4110' => [33333, 0], '2125' => [5000, 0], '1130' => [0, 38333]]),
            $this->journal(ReturnDocument::class, $return->id)
        );

        // معدل صفري: لا سطر ضريبة، ولا حاجة لدور مُعيَّن.
        AccountRoleMapping::where('role_key', 'tax_output')->delete();
        $zero = $this->salesReturn($this->sale(rate: 0), '2026-02-20');
        $this->assertSame($this->canonical(['4110' => [100000, 0], '1130' => [0, 100000]]), $this->journal(ReturnDocument::class, $zero->id));
    }

    // ───────────────── 2) الإشعارات الدائنة والمدينة ─────────────────

    /** @test */
    public function a_source_linked_sales_credit_note_uses_the_current_role_default_and_remapped(): void
    {
        $invoice = $this->sale();
        $default = $this->salesNote($invoice, date: '2026-02-01');
        $this->assertSame(
            $this->canonical(['4110' => [100000, 0], '2120' => [15000, 0], '1130' => [0, 115000]]),
            $this->journal(CreditNote::class, $default->id)
        );

        $this->remap('tax_output', $this->vatAccount('2125', 'liability'));
        $invoice2 = $this->sale(date: '2026-03-01');
        $remapped = $this->salesNote($invoice2);
        $this->assertSame(
            $this->canonical(['4110' => [100000, 0], '2125' => [15000, 0], '1130' => [0, 115000]]),
            $this->journal(CreditNote::class, $remapped->id)
        );
        $this->assertSame([15000, 115000], [(int) $remapped->fresh()->tax_amount, (int) $remapped->fresh()->total]);
        $this->assertBooksBalanced();
    }

    /** @test */
    public function a_standalone_sales_credit_note_uses_the_current_role(): void
    {
        $this->remap('tax_output', $this->vatAccount('2125', 'liability'));

        $note = $this->standaloneSalesNote();

        $this->assertSame(
            $this->canonical(['4110' => [100000, 0], '2125' => [15000, 0], '1130' => [0, 115000]]),
            $this->journal(CreditNote::class, $note->id)
        );
    }

    /** @test */
    public function a_purchase_debit_note_credits_the_current_tax_input_role(): void
    {
        $purchase = $this->purchaseDoc();                            // VAT 150.00 مدين 1150
        $default = $this->purchaseNote($purchase);
        $this->assertSame(
            $this->canonical(['2110' => [115000, 0], '5115' => [0, 100000], '1150' => [0, 15000]]),
            $this->journal(CreditNote::class, $default->id)
        );

        $this->remap('tax_input', $this->vatAccount('1158', 'asset'));
        $purchase2 = $this->purchaseDoc(date: '2026-03-01');
        $remapped = $this->purchaseNote($purchase2);
        $this->assertSame(
            $this->canonical(['2110' => [115000, 0], '5115' => [0, 100000], '1158' => [0, 15000]]),
            $this->journal(CreditNote::class, $remapped->id)
        );
        $this->assertBooksBalanced();
    }

    /** @test */
    public function the_acc4_purchase_return_still_credits_the_current_tax_input_role(): void
    {
        $purchase = $this->purchaseDoc();
        $this->remap('tax_input', $this->vatAccount('1158', 'asset'));

        $return = $this->purchaseReturn($purchase);

        $j = $this->journal(ReturnDocument::class, $return->id);
        $this->assertSame([0, 15000], $j['1158']);
        $this->assertArrayNotHasKey('1150', $j);
        $this->assertSame(0, $this->tax()['input_vat']);
    }

    // ───────────────── 3) العكس المحاسبي الحقيقي يحفظ الحسابات الأصلية ─────────────────

    /** @test */
    public function a_true_ledger_reversal_mirrors_the_original_concrete_accounts_not_the_current_role(): void
    {
        $invoice = $this->sale();
        $return = $this->salesReturn($invoice);                       // VAT على 2120
        $entry = JournalEntry::findOrFail($return->fresh()->journal_entry_id);

        $this->remap('tax_output', $this->vatAccount('2125', 'liability'));
        $reversal = app(LedgerService::class)->reverse($entry, '2026-03-01', 'عكس المرتجع');

        $reversal->load('lines.account');
        $vat = $reversal->lines->first(fn ($l) => (int) $l->credit === 15000);
        $this->assertSame('2120', $vat->account->code);               // الحساب الأصلي، لا 2125
        $this->assertSame(0, (int) JournalLine::where('journal_entry_id', $reversal->id)->whereHas('account', fn ($q) => $q->where('code', '2125'))->count());
        $this->assertSame((int) $reversal->lines->sum('debit'), (int) $reversal->lines->sum('credit'));

        // صافي 2120 بعد فاتورة + مرتجع + عكس المرتجع = دائن 150.00 كما كانت الفاتورة.
        $this->assertSame(-15000, $this->balanceOf('2120'));
        $this->assertSame(0, $this->balanceOf('2125'));
    }

    /** @test */
    public function reversing_a_credit_note_entry_after_a_remap_also_keeps_its_original_accounts(): void
    {
        $note = $this->salesNote($this->sale());                      // VAT على 2120
        $this->remap('tax_output', $this->vatAccount('2125', 'liability'));

        $reversal = app(LedgerService::class)->reverse(JournalEntry::findOrFail($note->fresh()->journal_entry_id), '2026-03-02', 'عكس');

        $vat = $reversal->lines()->with('account')->get()->first(fn ($l) => (int) $l->credit === 15000);
        $this->assertSame('2120', $vat->account->code);
        $this->assertSame(0, $this->balanceOf('2125'));
    }

    // ───────────────── 4) تعيين غير صالح/معطَّل/مفقود: فشل مغلق ─────────────────

    /** @test */
    public function an_inactive_tax_output_mapping_blocks_the_sales_return_atomically(): void
    {
        $invoice = $this->sale();
        $custom = $this->vatAccount('2125', 'liability');
        $this->remap('tax_output', $custom);
        $custom->update(['is_active' => false]);
        $draft = $this->salesReturn($invoice, post: false);
        $entries = JournalEntry::count();

        try {
            app(ReturnService::class)->post($draft);
            $this->fail('كان يجب رفض الترحيل');
        } catch (RuntimeException $e) {
            $this->assertStringContainsString('tax_output', $e->getMessage());
        }

        $this->assertSame($entries, JournalEntry::count());
        $this->assertSame('draft', $draft->fresh()->status);
        $this->assertNull($draft->fresh()->journal_entry_id);
        $this->assertSame(-15000, $this->balanceOf('2120'));         // لا رجوع صامت إلى 2120
    }

    /** @test */
    public function an_unmapped_role_blocks_returns_and_notes_without_a_silent_fallback(): void
    {
        $invoice = $this->sale();
        $purchase = $this->purchaseDoc();
        AccountRoleMapping::whereIn('role_key', ['tax_output', 'tax_input'])->delete();
        $entries = JournalEntry::count();

        $draftReturn = $this->salesReturn($invoice, post: false);
        $noteId = $this->postJson('/api/credit-notes', [
            'partner_id' => $invoice->partner_id, 'original_invoice_id' => $invoice->id,
            'items' => [['source_line_id' => $invoice->lines->first()->id, 'quantity' => 1]],
        ])->assertCreated()->json('data.id');
        $purchaseNoteId = $this->postJson('/api/credit-notes', [
            'partner_id' => $purchase->partner_id, 'original_purchase_id' => $purchase->id,
            'items' => [['description' => 'خصم', 'quantity' => 1, 'unit_price' => 100000, 'tax_rate' => 15]],
        ])->assertCreated()->json('data.id');

        $this->assertThrows(fn () => app(ReturnService::class)->post($draftReturn), RuntimeException::class);
        $this->postJson("/api/credit-notes/{$noteId}/post")->assertStatus(422);
        $this->postJson("/api/credit-notes/{$purchaseNoteId}/post")->assertStatus(422);

        $this->assertSame($entries, JournalEntry::count());
        $this->assertSame('draft', $draftReturn->fresh()->status);
        $this->assertSame('draft', CreditNote::findOrFail($noteId)->status);
        $this->assertSame('draft', CreditNote::findOrFail($purchaseNoteId)->status);
        $this->assertBooksBalanced();
    }

    /** @test */
    public function a_posted_document_cannot_post_twice_so_no_duplicate_entries_exist(): void
    {
        $return = $this->salesReturn($this->sale());
        $note = $this->salesNote($this->sale(date: '2026-01-20'));

        $this->assertThrows(fn () => app(ReturnService::class)->post($return->fresh()), RuntimeException::class);
        $this->postJson("/api/credit-notes/{$note->id}/post")->assertStatus(422);

        $this->assertSame(1, JournalEntry::where('source_type', ReturnDocument::class)->where('source_id', $return->id)->count());
        $this->assertSame(1, JournalEntry::where('source_type', CreditNote::class)->where('source_id', $note->id)->count());
    }

    // ───────────────── 5) العزل: المستأجر والفرع ─────────────────

    /** @test */
    public function one_tenants_vat_mapping_never_routes_another_tenants_adjustments(): void
    {
        $this->remap('tax_output', $this->vatAccount('2125', 'liability'));

        $other = Tenant::create([
            'name' => 'مستأجر ب', 'slug' => 'nibras-vat-adj-b', 'vat_number' => '300000000000011', 'currency' => 'SAR',
        ]);
        app(TenantContext::class)->set($other->id);
        app(ChartOfAccountsSeeder::class)->seed($other->id);
        $customerB = Partner::create(['name' => 'عميل ب', 'type' => 'customer']);
        $productB = Product::create(['name' => 'خدمة ب', 'track_inventory' => false]);
        $svc = app(InvoiceService::class);
        $invoiceB = $svc->post($svc->create(
            ['partner_id' => $customerB->id, 'payment_type' => 'credit', 'invoice_date' => '2026-01-10'],
            [['product_id' => $productB->id, 'quantity' => 1, 'unit_price' => 100000, 'tax_rate' => 15]],
        ));

        $returnB = $this->salesReturn($invoiceB);
        $journalB = $this->journal(ReturnDocument::class, $returnB->id);

        $this->assertSame($this->canonical(['4110' => [100000, 0], '2120' => [15000, 0], '1130' => [0, 115000]]), $journalB);   // الافتراضي، لا 2125 لمستأجر أ
        $this->assertSame(0, Account::where('code', '2125')->count());                                          // حساب أ غير مرئي لـ ب
        $this->assertSame(0, $this->tax()['output_vat']);

        app(TenantContext::class)->set($this->tenant->id);
        $this->assertSame(0, ReturnDocument::count());                                                          // لا مرتجعات لأ
    }

    /** @test */
    public function the_vat_role_is_company_wide_while_the_entry_keeps_its_branch_tag(): void
    {
        $branch = Branch::create(['code' => '00002', 'name' => 'فرع أ', 'is_main' => false]);
        app(BranchContext::class)->set($branch->id);
        $invoice = $this->sale();
        $custom = $this->vatAccount('2125', 'liability');
        $this->remap('tax_output', $custom);

        $return = $this->salesReturn($invoice);

        $line = JournalLine::where('journal_entry_id', $return->fresh()->journal_entry_id)->where('account_id', $custom->id)->sole();
        $this->assertSame($branch->id, $line->branch_id);              // الحساب مؤسسي، والقيد يبقى بفرعه
        $this->assertSame($branch->id, $return->fresh()->branch_id);

        // تقرير بمرشّح فرع آخر لا يرى الحركة ولا يحمل تلوّثاً.
        $other = Branch::create(['code' => '00003', 'name' => 'فرع ب', 'is_main' => false]);
        $this->assertSame(0, $this->tax(['branch_id' => [$other->id]])['output_vat']);
        $this->assertSame(0, $this->tax(['branch_id' => [$branch->id]])['output_vat']);
    }
}
