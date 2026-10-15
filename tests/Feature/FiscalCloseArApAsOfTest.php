<?php

namespace Tests\Feature;

use App\Models\Account;
use App\Models\AccountBalance;
use App\Models\AccountRoleMapping;
use App\Models\AccountRoleMappingEvent;
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
use App\Services\Accounting\ArApControlBalanceService;
use App\Services\Accounting\CashBankAccountService;
use App\Services\Accounting\ChartOfAccountsSeeder;
use App\Services\Accounting\CustomerRefundService;
use App\Services\Accounting\FiscalCloseService;
use App\Services\Accounting\FiscalYearClosedException;
use App\Services\Accounting\FiscalYearService;
use App\Services\Accounting\InvoiceService;
use App\Services\Accounting\LedgerService;
use App\Services\Accounting\PartnerService;
use App\Services\Accounting\PaymentService;
use App\Services\Accounting\PurchaseService;
use App\Services\Accounting\ReturnService;
use App\Services\Accounting\SupplierRefundService;
use App\Services\Reporting\ReportService;
use App\Services\TenantApplicationService;
use App\Tenancy\BranchContext;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/**
 * FC-4 — سطر `open_ar_ap` في جاهزية الإقفال المالي: رصيد **حسابات الأستاذ** للعملاء والموردين كما في
 * `fiscal_years.end_date` (`journal_entries.entry_date <= end_date`)، تراكمي، كل الفروع، قيود `posted` و`reversed`،
 * على مجموعة حسابات الدور (التعيين الحالي ∪ النظامي 1130/2110 ∪ سجلّ التعيينات). عملاء = مدين − دائن، موردون = دائن − مدين.
 *
 * ليس رصيد دفاتر الأطراف ولا المستندات غير المسدَّدة ولا «مركز ذمم مطابَقاً»؛ والمطابقة بالميزانية فحصُ اتساق دفتريّ
 * داخلي فقط (`assertBalanceSheet`). أرقام الاختبارات بالهللات (115000 = 1,150.00 ر.س).
 *
 * خريطة T1–T21 من تحليل FC-4 المعتمد (اختبارات t22+ إضافات: نوع الحساب، دور آخر، قراءة فقط، S8، الإقفال رغم التحذير).
 * تشغيل: php artisan test --filter=FiscalCloseArApAsOfTest
 */
class FiscalCloseArApAsOfTest extends TestCase
{
    use RefreshDatabase;

    protected Tenant $tenant;
    protected User $user;
    protected Partner $customer;
    protected Partner $supplier;
    protected Product $service;
    protected FiscalYear $y26;
    protected FiscalYear $y27;

    protected function setUp(): void
    {
        parent::setUp();
        $this->travelTo(Carbon::parse('2027-03-15 10:00:00'));

        $this->tenant = Tenant::create([
            'name' => 'نبراس الطموح', 'slug' => 'nibras-fc4',
            'vat_number' => '300000000000003', 'currency' => 'SAR',
        ]);
        app(TenantContext::class)->set($this->tenant->id);
        app(ChartOfAccountsSeeder::class)->seed($this->tenant->id);
        app(CashBankAccountService::class)->bootstrapDefaults();
        app(TenantApplicationService::class)->enable('purchases.cycle', null);

        $this->customer = Partner::create(['name' => 'عميل', 'type' => 'customer']);
        $this->supplier = Partner::create(['name' => 'مورد', 'type' => 'supplier']);
        $this->service = Product::create(['name' => 'خدمة', 'type' => 'service', 'track_inventory' => false]);

        $this->user = User::create([
            'tenant_id' => $this->tenant->id, 'name' => 'مدير',
            'email' => 'admin@fc4.sa', 'password' => bcrypt('secret1234'), 'role' => 'owner',
        ]);
        Sanctum::actingAs($this->user);

        $this->y26 = $this->year('2026');
        $this->y27 = $this->year('2027');
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

    private function year(string $y): FiscalYear
    {
        return FiscalYear::findOrFail(app(FiscalYearService::class)->create(
            ['name' => $y, 'start_date' => "{$y}-01-01", 'end_date' => "{$y}-12-31"], null
        )['id']);
    }

    private function byCode(string $code): Account
    {
        return Account::where('code', $code)->firstOrFail();
    }

    private function account(string $code, string $type, string $name = 'حساب'): Account
    {
        return Account::create([
            'tenant_id' => app(TenantContext::class)->id(), 'code' => $code, 'name' => "{$name} {$code}",
            'type' => $type, 'normal_balance' => in_array($type, ['asset', 'expense'], true) ? 'debit' : 'credit',
            'is_group' => false, 'is_active' => true,
        ]);
    }

    private function remap(string $role, Account $account): void
    {
        app(AccountRoutingService::class)->setMapping($role, $account->id, null);
    }

    /** @param list<array{0:string,1?:int,2?:int,3?:?string}> $lines [كود، مدين، دائن، معرّف الطرف؟] */
    private function entry(string $date, array $lines, string|null|false $branch = false): JournalEntry
    {
        $meta = ['entry_date' => $date];
        if ($branch !== false) {
            $meta['branch_id'] = $branch;
        }

        return app(LedgerService::class)->post(array_map(fn (array $l) => [
            'account_id' => $this->byCode($l[0])->id, 'debit' => $l[1] ?? 0, 'credit' => $l[2] ?? 0,
            'partner_type' => ($l[3] ?? null) ? Partner::class : null, 'partner_id' => $l[3] ?? null,
        ], $lines), $meta);
    }

    private function sale(string $date, int $unitPrice = 100000, int $quantity = 1, ?Partner $who = null): Invoice
    {
        $svc = app(InvoiceService::class);

        return $svc->post($svc->create(
            ['partner_id' => ($who ?? $this->customer)->id, 'payment_type' => 'credit', 'invoice_date' => $date],
            [['product_id' => $this->service->id, 'quantity' => $quantity, 'unit_price' => $unitPrice, 'tax_rate' => 15]],
        ));
    }

    private function buy(string $date, int $unitPrice = 100000, int $quantity = 1): Purchase
    {
        $svc = app(PurchaseService::class);

        return $svc->post($svc->create(
            ['partner_id' => $this->supplier->id, 'payment_type' => 'credit', 'purchase_date' => $date],
            [['product_id' => $this->service->id, 'quantity' => $quantity, 'unit_price' => $unitPrice, 'tax_rate' => 15]],
        ));
    }

    private function salesReturn(Invoice $invoice, string $date): ReturnDocument
    {
        $line = $invoice->lines->first();
        $svc = app(ReturnService::class);

        return $svc->post($svc->create([
            'type' => 'sales', 'partner_id' => $invoice->partner_id, 'payment_type' => 'credit',
            'original_id' => $invoice->id, 'return_date' => $date,
        ], [[
            'product_id' => $line->product_id, 'source_line_id' => $line->id,
            'quantity' => (int) $line->quantity, 'unit_price' => (int) $line->unit_price, 'tax_rate' => 15,
        ]]));
    }

    private function close(FiscalYear $year): void
    {
        app(FiscalCloseService::class)->close($year->id, null);
    }

    private function reopen(FiscalYear $year): void
    {
        app(FiscalCloseService::class)->reopen($year->id, 'تصحيح', null);
    }

    /** @return array{bucket:string, severity:string, message:string, details:array<string,mixed>} */
    private function item(FiscalYear $year): array
    {
        $r = app(FiscalCloseService::class)->readiness($year->fresh());
        foreach (['blockers', 'warnings', 'info'] as $bucket) {
            $found = collect($r[$bucket])->firstWhere('code', 'open_ar_ap');
            if ($found !== null) {
                return [...$found, 'bucket' => $bucket];
            }
        }
        $this->fail('open_ar_ap غير موجود في الجاهزية.');
    }

    /** @return array<string,mixed> */
    private function svc(string $asOf, ?FiscalYear $year = null): array
    {
        return app(ArApControlBalanceService::class)->balancesAsOf($asOf, $year);
    }

    /** مرجع مستقل: صفوف الميزانية حتى التاريخ للحسابات المعطاة (أصول للعملاء، خصوم للموردين). */
    private function assertBalanceSheet(string $asOf, int $ar, int $ap, array $arCodes = ['1130'], array $apCodes = ['2110']): void
    {
        $bs = app(ReportService::class)->balanceSheet(['to' => $asOf]);
        $assets = collect($bs['assets'])->keyBy('code');
        $liabilities = collect($bs['liabilities'])->keyBy('code');

        $this->assertSame($ar, (int) collect($arCodes)->sum(fn ($c) => $assets[$c]['amount'] ?? 0), 'العملاء مقابل الميزانية');
        $this->assertSame($ap, (int) collect($apCodes)->sum(fn ($c) => $liabilities[$c]['amount'] ?? 0), 'الموردون مقابل الميزانية');
    }

    private function codes(array $accounts, bool $countedOnly = false): array
    {
        $rows = $countedOnly ? array_filter($accounts, fn ($a) => $a['counted']) : $accounts;

        return array_values(array_map(fn ($a) => $a['code'], $rows));
    }

    private function byAccountCode(array $accounts, string $code): array
    {
        return collect($accounts)->firstWhere('code', $code) ?? $this->fail("الحساب {$code} غير موجود في التفصيل.");
    }

    private function warningCodes(array $data): array
    {
        return array_values(array_unique(array_column($data['warnings'], 'code')));
    }

    // ═════════════ T1. أرصدة نهاية السنة من مستندات حقيقية + مطابقة الميزانية ═════════════

    /** @test */
    public function t01_year_end_balances_from_real_documents_match_the_balance_sheet(): void
    {
        $this->sale('2026-03-01');   // مدين 1130 = 115000
        $this->buy('2026-04-01');    // دائن 2110 = 115000

        $item = $this->item($this->y26);
        $d = $item['details'];

        $this->assertSame('info', $item['bucket']);
        $this->assertSame(115000, $d['receivable']);
        $this->assertSame(115000, $d['payable']);
        $this->assertSame('role_account_set_as_of_end_date', $d['basis']);
        $this->assertSame('2026-12-31', $d['as_of']);
        $this->assertSame('verified', $d['verification']['status']);
        $this->assertTrue($d['verification']['verified']);
        $this->assertBalanceSheet('2026-12-31', 115000, 115000);
        $this->assertStringContainsString('حسابات الأستاذ كما في 2026-12-31', $item['message']);
        $this->assertTrue(app(FiscalCloseService::class)->readiness($this->y26->fresh())['can_close']);
    }

    // ═════════════ T2. تسوية بعد نهاية السنة ═════════════

    /** @test */
    public function t02_settlement_after_year_end_does_not_change_the_year_end_figure(): void
    {
        $invoice = $this->sale('2026-03-01');
        $purchase = $this->buy('2026-04-01');
        $pay = app(PaymentService::class);
        $pay->post($pay->create(['partner_id' => $this->customer->id, 'amount' => 115000, 'payment_date' => '2027-01-15'],
            [['invoice_id' => $invoice->id, 'amount' => 115000]]));
        $pay->post($pay->create(['partner_id' => $this->supplier->id, 'direction' => 'paid', 'method' => 'cash', 'amount' => 115000, 'payment_date' => '2027-02-10'],
            [['purchase_id' => $purchase->id, 'amount' => 115000]]));

        $d = $this->item($this->y26)['details'];
        $this->assertSame(115000, $d['receivable']);   // كان الأساس القديم (كل الزمن) يعرض 0
        $this->assertSame(115000, $d['payable']);

        $later = $this->svc('2027-12-31');
        $this->assertSame(0, $later['roles']['accounts_receivable']['balance']);
        $this->assertSame(0, $later['roles']['accounts_payable']['balance']);
        $this->assertBalanceSheet('2026-12-31', 115000, 115000);
        $this->assertBalanceSheet('2027-12-31', 0, 0);
    }

    // ═════════════ T3. إعادة تعيين + مسارات تكتب على 1130 مباشرة + رصيد افتتاحي + تسوية بعد السنة ═════════════

    /** @test */
    public function t03_remap_sums_the_whole_role_set_including_hard_coded_posting_paths(): void
    {
        $other = Partner::create(['name' => 'عميل افتتاحي', 'type' => 'customer']);
        app(PartnerService::class)->recordOpeningBalance($other, 50000, '2026-01-01');   // يكتب على 1130 مباشرة
        $i1 = $this->sale('2026-03-01');                                                  // 1130 += 115000
        $new = $this->account('1131', 'asset', 'عملاء جديد');
        $this->remap('accounts_receivable', $new);
        $i2 = $this->sale('2026-07-01');                                                  // 1131 += 115000 (يحلّ الدور)
        $this->salesReturn($i1, '2026-08-01');                                            // 1130 -= 115000 (مسار مرمَّز)
        $pay = app(PaymentService::class);
        $pay->post($pay->create(['partner_id' => $this->customer->id, 'amount' => 115000, 'payment_date' => '2027-01-15'],
            [['invoice_id' => $i2->id, 'amount' => 115000]]));                            // بعد نهاية السنة

        $item = $this->item($this->y26);
        $this->assertSame(165000, $item['details']['receivable']);   // 1130: 50000 + 1131: 115000
        $this->assertSame('info', $item['bucket']);

        $accounts = $item['details']['accounts']['receivable'];
        $this->assertSame(50000, $this->byAccountCode($accounts, '1130')['balance']);
        $this->assertSame(115000, $this->byAccountCode($accounts, '1131')['balance']);
        $this->assertEqualsCanonicalizing(['system_default', 'history'], $this->byAccountCode($accounts, '1130')['sources']);
        $this->assertEqualsCanonicalizing(['current', 'history'], $this->byAccountCode($accounts, '1131')['sources']);
        $this->assertSame('1131', $item['details']['current_account']['receivable']['code']);
        $this->assertSame(115000, $item['details']['current_account']['receivable']['balance']);   // الأساس القديم (الحالي وحده) = 115000 ≠ 165000
        $this->assertSame('resolved', $item['details']['mapping_state']['receivable']);
        $this->assertBalanceSheet('2026-12-31', 165000, 0, ['1130', '1131']);
        $this->assertSame(50000, $this->svc('2027-12-31')['roles']['accounts_receivable']['balance']);
    }

    // ═════════════ T4. إعادات تعيين متعددة ثم إعادة ضبط ═════════════

    /** @test */
    public function t04_multiple_remaps_and_a_reset_keep_every_account_in_the_set(): void
    {
        $this->sale('2026-02-01');                                       // 1130
        $this->remap('accounts_receivable', $this->account('1131', 'asset'));
        $this->sale('2026-04-01');                                       // 1131
        $this->remap('accounts_receivable', $this->account('1132', 'asset'));
        $this->sale('2026-06-01');                                       // 1132
        app(AccountRoutingService::class)->reset('accounts_receivable', null);
        $this->sale('2026-08-01');                                       // 1130 مجدداً

        $d = $this->item($this->y26)['details'];
        $this->assertSame(460000, $d['receivable']);
        $accounts = $d['accounts']['receivable'];
        $this->assertSame(['1130', '1131', '1132'], $this->codes($accounts));   // مرتبة بالكود
        $this->assertSame(230000, $this->byAccountCode($accounts, '1130')['balance']);
        $this->assertSame(115000, $this->byAccountCode($accounts, '1131')['balance']);
        $this->assertSame(115000, $this->byAccountCode($accounts, '1132')['balance']);
        $this->assertEqualsCanonicalizing(['current', 'system_default', 'history'], $this->byAccountCode($accounts, '1130')['sources']);
        $this->assertSame('1130', $d['current_account']['receivable']['code']);
        $this->assertSame(230000, $d['current_account']['receivable']['balance']);
        $this->assertSame('verified', $d['verification']['status']);
        $this->assertBalanceSheet('2026-12-31', 460000, 0, ['1130', '1131', '1132']);
    }

    // ═════════════ T5. حماية السنة المقفلة (FC-3) ═════════════

    /** @test */
    public function t05_a_closed_year_rejects_backdated_entries_so_its_figure_cannot_drift(): void
    {
        $this->sale('2026-03-01');
        $this->close($this->y26);
        $this->assertSame(115000, $this->item($this->y26)['details']['receivable']);   // قيد الإقفال لا يمسّ العملاء

        try {
            $this->entry('2026-12-20', [['1130', 10000, 0], ['4110', 0, 10000]]);
            $this->fail('كان يجب رفض الترحيل داخل سنة مقفلة.');
        } catch (FiscalYearClosedException) {
            // المتوقَّع
        }
        $this->assertSame(115000, $this->item($this->y26)['details']['receivable']);

        $this->reopen($this->y26);
        $this->entry('2026-12-20', [['1130', 10000, 0], ['4110', 0, 10000]]);
        $this->assertSame(125000, $this->item($this->y26)['details']['receivable']);
        $this->close($this->y26);
        $this->assertSame(125000, $this->item($this->y26)['details']['receivable']);
    }

    // ═════════════ T6. عكس في السنة نفسها وعبر السنوات ═════════════

    /** @test */
    public function t06_same_year_and_cross_year_reversals(): void
    {
        $a = $this->entry('2026-03-01', [['1130', 20000, 0, $this->customer->id], ['4110', 0, 20000]]);
        $b = $this->entry('2026-06-01', [['1130', 30000, 0, $this->customer->id], ['4110', 0, 30000]]);
        app(LedgerService::class)->reverse($a, '2026-05-01', 'عكس نفس السنة');
        app(LedgerService::class)->reverse($b, '2027-01-10', 'عكس السنة التالية');

        $this->assertSame('reversed', $a->fresh()->status);
        $this->assertSame('reversed', $b->fresh()->status);

        $this->assertSame(30000, $this->item($this->y26)['details']['receivable']);   // الأصل داخل، وعاكس 2027 خارج
        $this->assertSame(0, $this->svc('2027-12-31')['roles']['accounts_receivable']['balance']);
        $this->assertBalanceSheet('2026-12-31', 30000, 0);
    }

    // ═════════════ T7. إشعارات دائن/مدين جزئية بعد إعادة التعيين ═════════════

    /** @test */
    public function t07_credit_and_debit_notes_posting_to_the_system_account_after_a_remap(): void
    {
        $invoice = $this->sale('2026-03-01', 50000, 2);   // 115000
        $purchase = $this->buy('2026-03-05', 50000, 2);   // 115000
        $this->remap('accounts_receivable', $this->account('1131', 'asset'));
        $this->remap('accounts_payable', $this->account('2111', 'liability'));

        $noteId = $this->postJson('/api/credit-notes', [
            'partner_id' => $invoice->partner_id, 'original_invoice_id' => $invoice->id, 'note_date' => '2026-06-10',
            'items' => [['source_line_id' => $invoice->lines->first()->id, 'quantity' => 1]],
        ])->assertCreated()->json('data.id');
        $this->postJson("/api/credit-notes/{$noteId}/post")->assertOk();
        $debitId = $this->postJson('/api/credit-notes', [
            'partner_id' => $purchase->partner_id, 'original_purchase_id' => $purchase->id, 'note_date' => '2026-06-11',
            'items' => [['description' => 'خصم مورد', 'quantity' => 1, 'unit_price' => 50000, 'tax_rate' => 15]],
        ])->assertCreated()->json('data.id');
        $this->postJson("/api/credit-notes/{$debitId}/post")->assertOk();

        $this->assertSame(2, CreditNote::count());
        $d = $this->item($this->y26)['details'];
        $this->assertSame(57500, $d['receivable']);   // 115000 − إشعار دائن 57500 (على 1130 المرمَّز)
        $this->assertSame(57500, $d['payable']);      // 115000 − إشعار مدين 57500 (على 2110 المرمَّز)
        $this->assertSame(0, $d['current_account']['receivable']['balance']);   // الحساب الحالي وحده يُخفي الرصيد كله
        $this->assertSame(0, $d['current_account']['payable']['balance']);
        $this->assertBalanceSheet('2026-12-31', 57500, 57500, ['1130', '1131'], ['2110', '2111']);
    }

    // ═════════════ T8. عميل دائن (عكس الطبيعة) ثم استرداده ═════════════

    /** @test */
    public function t08_customer_credit_balance_is_disclosed_not_reclassified_until_refunded(): void
    {
        $product = Product::create(['name' => 'خدمة ب', 'type' => 'service', 'track_inventory' => false]);
        $returns = app(ReturnService::class);
        $return = $returns->post($returns->create(
            ['type' => 'sales', 'partner_id' => $this->customer->id, 'payment_type' => 'credit', 'return_date' => '2026-05-10'],
            [['product_id' => $product->id, 'quantity' => 2, 'unit_price' => 10000, 'tax_rate' => 15]]
        ));   // دائن 1130 = 23000 بلا فاتورة

        $item = $this->item($this->y26);
        $this->assertSame(-23000, $item['details']['receivable']);                                    // بلا إعادة تصنيف
        $this->assertSame([['account_id' => $this->byCode('1130')->id, 'code' => '1130', 'balance' => -23000]],
            $item['details']['opposite_sign']['receivable']['accounts']);
        $this->assertSame(['count' => 1, 'amount' => 23000], $item['details']['opposite_sign']['receivable']['partners']);
        $this->assertSame('info', $item['bucket']);                                                   // إفصاح لا تحذير
        $this->assertSame('verified', $item['details']['verification']['status']);
        $this->assertStringContainsString('بعكس طبيعة الدور', $item['message']);

        $refunds = app(CustomerRefundService::class);
        $refund = $refunds->create(
            ['partner_id' => $this->customer->id, 'amount' => 23000, 'method' => 'cash', 'refund_date' => '2026-06-01'],
            [['source_type' => CustomerRefundService::SOURCE_SALES_RETURN, 'source_id' => $return->id, 'amount' => 23000]],
        );
        $refunds->post($refund);

        $after = $this->item($this->y26)['details'];
        $this->assertSame(0, $after['receivable']);
        $this->assertSame([], $after['opposite_sign']['receivable']['accounts']);
        $this->assertSame(0, $after['opposite_sign']['receivable']['partners']['count']);
    }

    // ═════════════ T9. مورد مدين (عكس الطبيعة) ثم استرداده ═════════════

    /** @test */
    public function t09_supplier_debit_balance_is_disclosed_not_reclassified_until_refunded(): void
    {
        $stocked = Product::create(['name' => 'بضاعة', 'track_inventory' => true, 'quantity_on_hand' => 100, 'avg_cost' => 10000]);
        $returns = app(ReturnService::class);
        $return = $returns->post($returns->create(
            ['type' => 'purchase', 'partner_id' => $this->supplier->id, 'return_date' => '2026-05-10'],
            [['product_id' => $stocked->id, 'quantity' => 2, 'unit_price' => 10000, 'tax_rate' => 15]]
        ));   // مدين 2110 = 23000 بلا فاتورة

        $item = $this->item($this->y26);
        $this->assertSame(-23000, $item['details']['payable']);
        $this->assertSame(23000, $item['details']['opposite_sign']['payable']['partners']['amount']);
        $this->assertSame('info', $item['bucket']);

        $refunds = app(SupplierRefundService::class);
        $refunds->post($refunds->create(
            ['partner_id' => $this->supplier->id, 'amount' => 23000, 'method' => 'cash', 'refund_date' => '2026-06-01'],
            [['purchase_return_id' => $return->id, 'amount' => 23000]],
        ));

        $after = $this->item($this->y26)['details'];
        $this->assertSame(0, $after['payable']);
        $this->assertSame([], $after['opposite_sign']['payable']['accounts']);
    }

    // ═════════════ T10. سطور بلا طرف: إفصاح منفصل لا خطأ ═════════════

    /** @test */
    public function t10_untagged_lines_are_disclosed_separately_without_changing_verification(): void
    {
        $this->sale('2026-03-01');                                                         // موسوم بالعميل
        $this->entry('2026-04-01', [['1130', 20000, 0], ['4110', 0, 20000]]);              // قيد يدوي بلا طرف
        $this->entry('2026-05-01', [['2110', 0, 7000], ['5130', 7000, 0]]);                // على الموردين بلا طرف

        $item = $this->item($this->y26);
        $this->assertSame(['lines' => 1, 'debit' => 20000, 'credit' => 0, 'net' => 20000], $item['details']['untagged']['receivable']);
        $this->assertSame(['lines' => 1, 'debit' => 0, 'credit' => 7000, 'net' => 7000], $item['details']['untagged']['payable']);
        $this->assertSame('info', $item['bucket']);                                          // لا تحذير كاذب
        $this->assertSame('verified', $item['details']['verification']['status']);
        $checks = collect($item['details']['verification']['checks'])->keyBy('code');
        $this->assertSame('info', $checks['ar_ap_untagged_lines']['result']);
        $this->assertStringContainsString('بلا معرّف طرف', $item['message']);
    }

    /** @test */
    public function t10b_partner_opening_balances_are_tagged_and_not_reported_as_untagged(): void
    {
        $c = Partner::create(['name' => 'افتتاحي', 'type' => 'customer']);
        $s = Partner::create(['name' => 'مورد افتتاحي', 'type' => 'supplier']);
        app(PartnerService::class)->recordOpeningBalance($c, 40000, '2026-01-01');
        app(PartnerService::class)->recordOpeningBalance($s, 30000, '2026-01-01');

        $d = $this->item($this->y26)['details'];
        $this->assertSame(40000, $d['receivable']);
        $this->assertSame(30000, $d['payable']);
        $this->assertSame(0, $d['untagged']['receivable']['lines']);
        $this->assertSame(0, $d['untagged']['payable']['lines']);
        $this->assertSame('passed', collect($d['verification']['checks'])->firstWhere('code', 'ar_ap_untagged_lines')['result']);
    }

    // ═════════════ T11. حساب نقد/بنك داخل المجموعة ═════════════

    /** @test */
    public function t11_a_cash_account_in_the_set_with_movement_is_unverified_and_never_blocks_closing(): void
    {
        $this->remap('accounts_receivable', $this->byCode('1110'));
        $this->entry('2026-03-01', [['1110', 30000, 0], ['4110', 0, 30000]]);

        $item = $this->item($this->y26);
        $this->assertSame('warnings', $item['bucket']);
        $this->assertSame('unverified', $item['details']['verification']['status']);
        $this->assertContains('ar_ap_account_cash_bank', $this->warningCodes($item['details']));
        $w = collect($item['details']['warnings'])->firstWhere('code', 'ar_ap_account_cash_bank');
        $this->assertSame('1110', $w['account_code']);
        $this->assertTrue($w['affects_totals']);
        $this->assertSame(30000, $item['details']['receivable']);                      // يُعرض كما هو، موسوماً غير موثَّق
        $this->assertStringContainsString('تحذير', $item['message']);

        $readiness = app(FiscalCloseService::class)->readiness($this->y26->fresh());
        $this->assertTrue($readiness['can_close']);                                    // لا مانع
        $this->close($this->y26);
        $this->assertSame(FiscalYear::STATUS_CLOSED, $this->y26->fresh()->status);
    }

    /** @test */
    public function t11b_a_bank_account_without_movement_is_only_a_notice(): void
    {
        $this->sale('2026-03-01');                                  // يقع على 1130 قبل التعيين
        $this->remap('accounts_receivable', $this->byCode('1120'));   // بنك بلا أي حركة

        $item = $this->item($this->y26);
        $this->assertSame('info', $item['bucket']);
        $this->assertSame('verified_with_notices', $item['details']['verification']['status']);
        $w = collect($item['details']['warnings'])->firstWhere('code', 'ar_ap_account_cash_bank');
        $this->assertFalse($w['affects_totals']);
    }

    // ═════════════ T12. تداخل العملاء والموردين ═════════════

    /** @test */
    public function t12_an_overlapping_account_is_attributed_by_type_but_always_unverified_even_at_zero(): void
    {
        $this->remap('accounts_payable', $this->byCode('1130'));   // حساب العملاء النظامي (أصل) يصير ضمن الموردين أيضاً
        $this->buy('2026-03-01');                                    // دائن دور الموردين = 1130 الآن ⇒ دائن 1130 = 115000

        $data = $this->svc('2026-12-31');
        $overlap = collect($data['warnings'])->firstWhere('code', 'ar_ap_role_accounts_overlap');
        $this->assertNotNull($overlap);
        $this->assertSame('1130', $overlap['account_code']);
        $this->assertTrue($overlap['affects_totals']);
        $this->assertSame('unverified', $data['verification']['status']);
        // أصل ⇒ يُنسب للعملاء وحدهم، ويُستبعد من الموردين فلا عدّ مزدوج.
        $this->assertSame(-115000, $data['roles']['accounts_receivable']['balance']);
        $this->assertFalse($this->byAccountCode($data['roles']['accounts_payable']['accounts'], '1130')['counted']);
        $this->assertSame(0, $data['roles']['accounts_payable']['balance']);

        // الجاهزية: تحذير، ويبقى الإقفال ممكناً.
        $item = $this->item($this->y26);
        $this->assertSame('warnings', $item['bucket']);
        $this->assertTrue(app(FiscalCloseService::class)->readiness($this->y26->fresh())['can_close']);
    }

    /** @test */
    public function t12b_overlap_is_unverified_even_with_no_movement_at_all(): void
    {
        $this->remap('accounts_payable', $this->byCode('1130'));

        $data = $this->svc('2026-12-31');
        $this->assertSame(0, $data['roles']['accounts_receivable']['balance']);
        $this->assertSame('unverified', $data['verification']['status']);
        $this->assertSame(1, $data['verification']['issues']);
    }

    /** @test */
    public function t12c_an_overlapping_account_whose_type_allows_no_attribution_is_excluded_from_both(): void
    {
        $capital = $this->byCode('3110');
        $this->remap('accounts_receivable', $capital);
        $this->remap('accounts_payable', $capital);
        $this->entry('2026-02-01', [['1110', 500000, 0], ['3110', 0, 500000]]);

        $data = $this->svc('2026-12-31');
        $this->assertSame(0, $data['roles']['accounts_receivable']['balance']);
        $this->assertSame(0, $data['roles']['accounts_payable']['balance']);
        $this->assertFalse($this->byAccountCode($data['roles']['accounts_receivable']['accounts'], '3110')['counted']);
        $this->assertFalse($this->byAccountCode($data['roles']['accounts_payable']['accounts'], '3110')['counted']);
        $this->assertSame('unverified', $data['verification']['status']);
        $this->assertContains('ar_ap_account_type_mismatch', $this->warningCodes($data));
    }

    // ═════════════ T13. عزل المستأجر ═════════════

    /** @test */
    public function t13_another_tenants_entries_and_remaps_never_enter_this_tenants_figure(): void
    {
        $this->sale('2026-03-01');   // أ: 115000

        $b = Tenant::create(['name' => 'ب', 'slug' => 'tenant-b-fc4', 'vat_number' => '300000000000004', 'currency' => 'SAR']);
        app(TenantContext::class)->set($b->id);
        app(ChartOfAccountsSeeder::class)->seed($b->id);
        $this->remap('accounts_receivable', $this->account('1131', 'asset'));
        $this->entry('2026-03-02', [['1131', 777000, 0], ['4110', 0, 777000]]);
        $this->entry('2026-03-03', [['1130', 11000, 0], ['4110', 0, 11000]]);

        $forB = $this->svc('2026-12-31');
        $this->assertSame(788000, $forB['roles']['accounts_receivable']['balance']);
        $this->assertSame(['1130', '1131'], $this->codes($forB['roles']['accounts_receivable']['accounts']));

        app(TenantContext::class)->set($this->tenant->id);
        $forA = $this->svc('2026-12-31');
        $this->assertSame(115000, $forA['roles']['accounts_receivable']['balance']);
        $this->assertSame(['1130'], $this->codes($forA['roles']['accounts_receivable']['accounts']));   // 1131 لـ(ب) لا تظهر
        $this->assertSame('verified', $forA['verification']['status']);
    }

    // ═════════════ T14. الفروع ═════════════

    /** @test */
    public function t14_all_branches_and_branchless_entries_count_regardless_of_the_active_branch(): void
    {
        $branch = Branch::create(['code' => '00002', 'name' => 'فرع أ', 'is_main' => false]);
        $this->entry('2026-02-01', [['1130', 10000, 0], ['4110', 0, 10000]], $branch->id);
        $this->entry('2026-02-02', [['1130', 20000, 0], ['4110', 0, 20000]], null);
        $this->entry('2026-02-03', [['1130', 30000, 0], ['4110', 0, 30000]]);

        $this->assertSame(60000, $this->svc('2026-12-31')['roles']['accounts_receivable']['balance']);

        app(BranchContext::class)->set($branch->id);
        try {
            $this->assertSame(60000, $this->item($this->y26)['details']['receivable']);
        } finally {
            app(BranchContext::class)->forget();
        }
    }

    // ═════════════ T15. أرصدة افتتاحية وتواريخ قبل أول سنة (S8) ═════════════

    /** @test */
    public function t15_opening_balances_before_the_first_year_are_included_and_disclosed_as_unprotected(): void
    {
        $c1 = Partner::create(['name' => 'افتتاحي 1', 'type' => 'customer']);
        $c2 = Partner::create(['name' => 'افتتاحي 2', 'type' => 'customer']);
        app(PartnerService::class)->recordOpeningBalance($c1, 50000, '2026-01-01');
        app(PartnerService::class)->recordOpeningBalance($c2, 20000, '2025-12-31');   // قبل أول سنة معرَّفة

        $item = $this->item($this->y26);
        $this->assertSame(70000, $item['details']['receivable']);
        $h = $item['details']['history'];
        $this->assertSame([], $h['prior_open_years']);
        $this->assertTrue($h['uncovered_prior_activity']);
        $this->assertTrue($h['balances_can_still_change']);
        $this->assertStringContainsString('لا تحميها سنة مقفلة', $item['message']);
    }

    /** @test */
    public function t15b_prior_open_years_are_disclosed_until_they_are_closed(): void
    {
        $c = Partner::create(['name' => 'افتتاحي', 'type' => 'customer']);
        app(PartnerService::class)->recordOpeningBalance($c, 20000, '2025-12-31');
        $y25 = $this->year('2025');

        $h = $this->item($this->y26)['details']['history'];
        $this->assertSame(['2025'], array_column($h['prior_open_years'], 'name'));
        $this->assertSame('open', $h['prior_open_years'][0]['status']);
        $this->assertTrue($h['balances_can_still_change']);
        $this->assertStringContainsString('سنوات سابقة غير مقفلة', $this->item($this->y26)['message']);

        $this->close($y25);
        $stable = $this->item($this->y26)['details']['history'];
        $this->assertSame([], $stable['prior_open_years']);
        $this->assertFalse($stable['uncovered_prior_activity']);
        $this->assertFalse($stable['balances_can_still_change']);
        $this->assertStringNotContainsString('سنوات سابقة غير مقفلة', $this->item($this->y26)['message']);
    }

    /** @test */
    public function t15c_a_first_year_with_nothing_before_it_has_no_history_disclosure(): void
    {
        $this->sale('2026-03-01');

        $h = $this->item($this->y26)['details']['history'];
        $this->assertSame('open', $h['year_status']);
        $this->assertFalse($h['balances_can_still_change']);
    }

    // ═════════════ T16. اتساق الميزانية على حسابات المجموعة ═════════════

    /** @test */
    public function t16_every_per_account_breakdown_row_equals_its_balance_sheet_row(): void
    {
        $this->sale('2026-03-01');
        $this->buy('2026-03-02');
        $this->remap('accounts_receivable', $this->account('1131', 'asset'));
        $this->remap('accounts_payable', $this->account('2111', 'liability'));
        $this->sale('2026-09-01', 40000);
        $this->buy('2026-09-02', 60000);

        $data = $this->svc('2026-12-31');
        $bs = app(ReportService::class)->balanceSheet(['to' => '2026-12-31']);
        $assets = collect($bs['assets'])->keyBy('code');
        $liabilities = collect($bs['liabilities'])->keyBy('code');

        foreach ($data['roles']['accounts_receivable']['accounts'] as $a) {
            $this->assertSame($a['balance'], $assets[$a['code']]['amount'] ?? 0, "عملاء {$a['code']}");
        }
        foreach ($data['roles']['accounts_payable']['accounts'] as $a) {
            $this->assertSame($a['balance'], $liabilities[$a['code']]['amount'] ?? 0, "موردون {$a['code']}");
        }
        $this->assertSame(161000, $data['roles']['accounts_receivable']['balance']);   // 115000 + 46000
        $this->assertSame(184000, $data['roles']['accounts_payable']['balance']);      // 115000 + 69000
        $this->assertTrue($bs['balanced']);
    }

    // ═════════════ T17. حدود المطابقة: ما لا يُدّعى ═════════════

    /** @test */
    public function t17_the_figure_is_a_ledger_control_balance_and_states_what_it_does_not_reconcile(): void
    {
        // سطر موسوم بالعميل على حساب خارج مجموعة الدور (بيع نقدي على الصندوق): دفتر الطرف ≠ رصيد حساب العملاء.
        $this->entry('2026-09-01', [['1110', 115000, 0, $this->customer->id], ['4110', 0, 115000]]);

        $item = $this->item($this->y26);
        $this->assertSame(0, $item['details']['receivable']);
        $this->assertSame(115000, app(ReportService::class)->partnerStatement($this->customer->id, ['to' => '2026-12-31'])['closing_balance']);

        $notChecked = $item['details']['not_checked'];
        $this->assertContains('partner_subledger_reconciliation', $notChecked);
        $this->assertContains('open_documents_reconciliation', $notChecked);
        $this->assertContains('aging_report_agreement', $notChecked);
        $this->assertSame($notChecked, $item['details']['verification']['not_checked']);
        $this->assertStringContainsString('ليست رصيد دفاتر العملاء والموردين', $item['message']);
        $this->assertStringContainsString('لا يجعلها مركز ذمم مطابَقاً', $item['message']);
        $this->assertSame('ar_ap_role_account_integrity', $item['details']['verification']['basis']);
    }

    // ═════════════ T18. توافق الـAPI ═════════════

    /** @test */
    public function t18_the_api_keeps_the_item_code_integer_fields_and_response_structure(): void
    {
        $this->sale('2026-03-01');
        $this->buy('2026-04-01');

        $res = $this->getJson("/api/accounting-settings/fiscal-years/{$this->y26->id}/readiness")->assertOk();
        $readiness = $res->json('data.readiness');
        $this->assertSame(['blockers', 'warnings', 'info', 'can_close'], array_keys($readiness));
        $this->assertTrue($readiness['can_close']);

        $item = collect($readiness['info'])->firstWhere('code', 'open_ar_ap');
        $this->assertSame(['severity', 'code', 'message', 'details'], array_keys($item));
        $this->assertSame('info', $item['severity']);
        $this->assertIsInt($item['details']['receivable']);
        $this->assertIsInt($item['details']['payable']);
        $this->assertSame(115000, $item['details']['receivable']);
        $this->assertSame(115000, $item['details']['payable']);
        foreach (['basis', 'as_of', 'accounts', 'current_account', 'mapping_state', 'verification', 'warnings', 'untagged', 'not_checked'] as $key) {
            $this->assertArrayHasKey($key, $item['details'], $key);
        }
        $this->assertSame('role_account_set_as_of_end_date', $item['details']['basis']);
        $this->assertSame(['receivable', 'payable'], array_keys($item['details']['accounts']));
        $this->assertSame('verified', $item['details']['verification']['status']);

        // سطر الضريبة المجاور لم يتأثر.
        $this->assertNotNull(collect($readiness['info'])->firstWhere('code', 'vat_balances'));
    }

    // ═════════════ T19. إقفال / فتح / إعادة إقفال ═════════════

    /** @test */
    public function t19_close_reopen_reclose_keep_the_figures_and_the_close_entry_never_touches_ar_ap(): void
    {
        $this->sale('2026-03-01');
        $this->buy('2026-04-01');
        $before = $this->item($this->y26)['details'];

        $this->close($this->y26);
        $closed = $this->item($this->y26)['details'];

        $this->reopen($this->y26);
        $reopened = $this->item($this->y26)['details'];

        $this->close($this->y26);
        $reclosed = $this->item($this->y26)['details'];

        foreach ([$closed, $reopened, $reclosed] as $d) {
            $this->assertSame($before['receivable'], $d['receivable']);
            $this->assertSame($before['payable'], $d['payable']);
            $this->assertSame('verified', $d['verification']['status']);
        }
        $closeCodes = JournalLine::query()
            ->whereHas('entry', fn ($q) => $q->where('description', 'like', 'إقفال السنة المالية%'))
            ->with('account')->get()->map(fn ($l) => $l->account->code)->unique()->values()->all();
        $this->assertNotContains('1130', $closeCodes);
        $this->assertNotContains('2110', $closeCodes);
    }

    // ═════════════ T20. تعيين غير قابل للحل ═════════════

    /** @test */
    public function t20_an_inactive_current_account_shows_the_historical_balance_with_a_warning(): void
    {
        $new = $this->account('1131', 'asset');
        $this->remap('accounts_receivable', $new);
        $this->sale('2026-03-01');
        Account::query()->whereKey($new->id)->update(['is_active' => false]);

        $item = $this->item($this->y26);
        $this->assertSame('warnings', $item['bucket']);
        $this->assertSame('inactive', $item['details']['mapping_state']['receivable']);
        $this->assertSame('resolved', $item['details']['mapping_state']['payable']);
        $this->assertSame(115000, $item['details']['receivable']);            // الرصيد التاريخي لا يُخفى
        $this->assertStringContainsString('غير قابل للحلّ', $item['message']);
        $this->assertTrue(app(FiscalCloseService::class)->readiness($this->y26->fresh())['can_close']);
    }

    /** @test */
    public function t20b_a_missing_mapping_still_shows_the_system_default_account_with_a_warning(): void
    {
        $this->sale('2026-03-01');
        AccountRoleMapping::query()->where('role_key', 'accounts_receivable')->delete();

        $item = $this->item($this->y26);
        $this->assertSame('warnings', $item['bucket']);
        $this->assertSame('unmapped', $item['details']['mapping_state']['receivable']);
        $this->assertNull($item['details']['current_account']['receivable']);
        $this->assertSame(115000, $item['details']['receivable']);            // 1130 النظامي ضمن المجموعة
    }

    // ═════════════ T21. الحالات: المسودات خارج الدفتر ═════════════

    /** @test */
    public function t21_drafts_are_excluded_and_posted_and_reversed_are_included(): void
    {
        $svc = app(InvoiceService::class);
        $svc->create(
            ['partner_id' => $this->customer->id, 'payment_type' => 'credit', 'invoice_date' => '2026-03-01'],
            [['product_id' => $this->service->id, 'quantity' => 1, 'unit_price' => 100000, 'tax_rate' => 15]],
        );   // مسودة
        $this->assertSame(0, $this->item($this->y26)['details']['receivable']);

        $entry = $this->entry('2026-03-02', [['1130', 8000, 0, $this->customer->id], ['4110', 0, 8000]]);
        app(LedgerService::class)->reverse($entry, '2026-03-03', 'عكس');
        $this->entry('2026-03-04', [['1130', 5000, 0, $this->customer->id], ['4110', 0, 5000]]);

        $this->assertSame(5000, $this->item($this->y26)['details']['receivable']);   // 8000 + (−8000) + 5000
    }

    // ═════════════ إضافات ═════════════

    /** @test */
    public function t22_an_incompatible_account_type_is_flagged_and_the_sign_follows_the_role(): void
    {
        $this->remap('accounts_receivable', $this->account('1190', 'liability', 'التزام'));
        $this->entry('2026-03-01', [['1110', 40000, 0], ['1190', 0, 40000]]);   // دائن على التزام

        $item = $this->item($this->y26);
        $this->assertSame('warnings', $item['bucket']);
        $this->assertContains('ar_ap_account_type_mismatch', $this->warningCodes($item['details']));
        $this->assertSame(-40000, $item['details']['receivable']);               // مدين − دائن بإشارة الدور
        $this->assertSame('unverified', $item['details']['verification']['status']);
    }

    /** @test */
    public function t23_an_account_serving_another_role_is_flagged(): void
    {
        $this->remap('accounts_receivable', $this->byCode('4110'));   // 4110 هو حساب دور sales_revenue
        $this->entry('2026-03-01', [['1110', 9000, 0], ['4110', 0, 9000]]);

        $data = $this->svc('2026-12-31');
        $w = collect($data['warnings'])->firstWhere('code', 'ar_ap_account_in_other_role');
        $this->assertNotNull($w);
        $this->assertSame('4110', $w['account_code']);
        $this->assertStringContainsString('إيرادات المبيعات', $w['message']);
        $this->assertTrue($w['affects_totals']);
        $this->assertSame('unverified', $data['verification']['status']);
    }

    /** @test */
    public function t24_the_service_is_read_only(): void
    {
        $this->sale('2026-03-01');
        $this->remap('accounts_receivable', $this->account('1131', 'asset'));
        $counts = fn () => [
            JournalEntry::count(), JournalLine::count(), AccountBalance::count(),
            AccountRoleMappingEvent::count(), AccountRoleMapping::count(), Account::count(), FiscalYear::count(),
        ];

        $before = $counts();
        $this->svc('2026-12-31', $this->y26);
        $this->item($this->y26);

        $this->assertSame($before, $counts());
    }

    /** @test */
    public function t25_an_unverified_figure_never_prevents_the_close(): void
    {
        $this->remap('accounts_receivable', $this->byCode('1110'));
        $this->entry('2026-03-01', [['1110', 30000, 0], ['4110', 0, 30000]]);
        $this->assertSame('warnings', $this->item($this->y26)['bucket']);

        $this->close($this->y26);

        $this->assertSame(FiscalYear::STATUS_CLOSED, $this->y26->fresh()->status);
    }

    /** @test */
    public function t26_a_tenant_without_any_ar_ap_account_gets_no_item(): void
    {
        $bare = Tenant::create(['name' => 'بلا دليل', 'slug' => 'bare-fc4', 'vat_number' => '300000000000005', 'currency' => 'SAR']);
        app(TenantContext::class)->set($bare->id);
        $year = $this->year('2026');

        $r = app(FiscalCloseService::class)->readiness($year->fresh());
        foreach (['blockers', 'warnings', 'info'] as $bucket) {
            $this->assertNull(collect($r[$bucket])->firstWhere('code', 'open_ar_ap'));
        }
    }
}
