<?php

namespace Tests\Feature;

use App\Models\Account;
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
use App\Services\Accounting\AccountingPeriodLockedException;
use App\Services\Accounting\AccountingPeriodLockService;
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
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/**
 * ACC-02-FC — سطر «ضريبة القيمة المضافة» في جاهزية الإقفال المالي: أرصدة **حتى نهاية السنة المالية**
 * (`journal_entries.entry_date <= fiscal_years.end_date`) على مجموعة حسابات REM-05 كلها
 * (التعيين الحالي ∪ النظامي ∪ سجلّ التعيينات)، تراكمية، مؤسسياً بلا مرشّح فروع، قيود `posted` و`reversed`.
 * مخرجات = دائن − مدين، مدخلات = مدين − دائن (كتقرير الضريبة).
 *
 * كل سيناريو يقارن الرقم بـ**مرجعين مستقلين** عبر `assertOracles()`:
 *   1) `ReportService::taxReport(['to' => end_date])` (مستخدم غير مقيَّد، بلا فروع).
 *   2) صفوف `ReportService::balanceSheet(['to' => end_date])` لحسابات المجموعة: الخصوم (−صافي) للمخرجات والأصول (+صافي) للمدخلات.
 * الاستثناء المعلن الوحيد: تعيين قديم بنوع حساب مخالف (T19) — الميزانية تعرض الحساب بإشارة نوعه، والتقرير والإقفال بإشارة الدور.
 *
 * أرقام الاختبارات بالهللات (15000 = 150.00 ر.س). تشغيل: php artisan test --filter=FiscalCloseVatAsOfTest
 */
class FiscalCloseVatAsOfTest extends TestCase
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

        $this->tenant = Tenant::create([
            'name' => 'نبراس الطموح', 'slug' => 'nibras-fc-vat',
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
            'email' => 'admin@fc-vat.sa', 'password' => bcrypt('secret1234'), 'role' => 'owner',
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
        $described = app(FiscalYearService::class)->create(
            ['name' => $y, 'start_date' => "{$y}-01-01", 'end_date' => "{$y}-12-31"], null
        );

        return FiscalYear::findOrFail($described['id']);
    }

    private function byCode(string $code): Account
    {
        return Account::where('code', $code)->firstOrFail();
    }

    private function vatAccount(string $code, string $type): Account
    {
        return Account::create([
            'tenant_id' => app(TenantContext::class)->id(), 'code' => $code, 'name' => "ضريبة {$code}",
            'type' => $type, 'normal_balance' => in_array($type, ['asset', 'expense'], true) ? 'debit' : 'credit',
            'is_group' => false, 'is_active' => true,
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

    /** تعيين قديم مخالف للأهلية (سابق للإنفاذ) مع أثر تدقيق بتاريخ ارتباط محدَّد. */
    private function legacyMap(string $role, Account $account, ?Carbon $eventAt = null): void
    {
        $previous = AccountRoleMapping::where('role_key', $role)->first();
        AccountRoleMapping::where('role_key', $role)->update(['account_id' => $account->id]);
        $event = AccountRoleMappingEvent::create([
            'role_key' => $role, 'action' => 'mapping_changed', 'actor_user_id' => null,
            'previous_account_id' => $previous?->account_id, 'previous_account_code' => null,
            'new_account_id' => $account->id, 'new_account_code' => $account->code,
        ]);
        if ($eventAt !== null) {
            AccountRoleMappingEvent::query()->whereKey($event->id)->toBase()
                ->update(['created_at' => $eventAt->toDateTimeString(), 'updated_at' => $eventAt->toDateTimeString()]);
        }
    }

    /** @param list<array{0:string,1?:int,2?:int}> $lines [كود، مدين، دائن] */
    private function entry(string $date, array $lines, string|null|false $branch = false): JournalEntry
    {
        $meta = ['entry_date' => $date];
        if ($branch !== false) {
            $meta['branch_id'] = $branch;
        }

        return app(LedgerService::class)->post(array_map(fn (array $l) => [
            'account_id' => $this->byCode($l[0])->id, 'debit' => $l[1] ?? 0, 'credit' => $l[2] ?? 0,
        ], $lines), $meta);
    }

    /** دائن على حساب مخرجات (مقابل العملاء 1130). */
    private function out(string $code, int $amount, string $date, string|null|false $branch = false): JournalEntry
    {
        return $this->entry($date, [['1130', $amount, 0], [$code, 0, $amount]], $branch);
    }

    /** مدين على حساب مخرجات (تخفيض: مرتجع/إشعار) مقابل العملاء. */
    private function outDr(string $code, int $amount, string $date): JournalEntry
    {
        return $this->entry($date, [[$code, $amount, 0], ['1130', 0, $amount]]);
    }

    /** مدين على حساب مدخلات مقابل الموردين 2110. */
    private function inDr(string $code, int $amount, string $date): JournalEntry
    {
        return $this->entry($date, [[$code, $amount, 0], ['2110', 0, $amount]]);
    }

    private function sale(string $date, int $unitPrice = 100000): Invoice
    {
        $svc = app(InvoiceService::class);
        $invoice = $svc->create(
            ['partner_id' => $this->customer->id, 'payment_type' => 'credit', 'invoice_date' => $date],
            [['product_id' => $this->service->id, 'quantity' => 1, 'unit_price' => $unitPrice, 'tax_rate' => 15]],
        );

        return $svc->post($invoice);
    }

    private function purchaseDoc(string $date, int $unitPrice = 100000): Purchase
    {
        $svc = app(PurchaseService::class);
        $purchase = $svc->create(
            ['partner_id' => $this->supplier->id, 'payment_type' => 'credit', 'purchase_date' => $date],
            [['product_id' => $this->service->id, 'quantity' => 1, 'unit_price' => $unitPrice, 'tax_rate' => 15]],
        );

        return $svc->post($purchase);
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

    private function salesNote(Invoice $invoice, string $date): CreditNote
    {
        $id = $this->postJson('/api/credit-notes', [
            'partner_id' => $invoice->partner_id, 'original_invoice_id' => $invoice->id, 'note_date' => $date,
            'items' => [['source_line_id' => $invoice->lines->first()->id, 'quantity' => 1]],
        ])->assertCreated()->json('data.id');
        $this->postJson("/api/credit-notes/{$id}/post")->assertOk();

        return CreditNote::findOrFail($id);
    }

    private function purchaseNote(Purchase $purchase, string $date): CreditNote
    {
        $id = $this->postJson('/api/credit-notes', [
            'partner_id' => $purchase->partner_id, 'original_purchase_id' => $purchase->id, 'note_date' => $date,
            'items' => [['description' => 'خصم مورد', 'quantity' => 1, 'unit_price' => 100000, 'tax_rate' => 15]],
        ])->assertCreated()->json('data.id');
        $this->postJson("/api/credit-notes/{$id}/post")->assertOk();

        return CreditNote::findOrFail($id);
    }

    /** بند `vat_balances` من الجاهزية (+ الدلو الذي وقع فيه و`can_close`). */
    private function vat(FiscalYear $year): array
    {
        $readiness = app(FiscalCloseService::class)->readiness($year->fresh());
        foreach (['info', 'warnings', 'blockers'] as $bucket) {
            $item = collect($readiness[$bucket])->firstWhere('code', 'vat_balances');
            if ($item !== null) {
                return $item + ['bucket' => $bucket, 'can_close' => $readiness['can_close']];
            }
        }
        $this->fail('البند vat_balances غير موجود في الجاهزية');
    }

    /**
     * المرجعان المستقلان (FC-1b): تقرير الضريبة غير المقيَّد حتى نهاية السنة، وصفوف الميزانية حتى نهاية السنة
     * لحسابات المجموعة. الفروق في الإشارة/العرض لا تُخفى: تُختبر صراحةً في T19.
     */
    private function assertOracles(FiscalYear $year): array
    {
        $end = $year->end_date->toDateString();
        $d = $this->vat($year)['details'];

        $report = app(ReportService::class)->taxReport(['to' => $end]);
        $this->assertSame($report['output_vat'], $d['tax_output'], "المرجع 1: مخرجات الإقفال ≠ تقرير الضريبة حتى {$end}");
        $this->assertSame($report['input_vat'], $d['tax_input'], "المرجع 1: مدخلات الإقفال ≠ تقرير الضريبة حتى {$end}");
        $this->assertSame([], $report['disclosures']);

        $sheet = app(ReportService::class)->balanceSheet(['to' => $end]);
        $outIds = array_column($d['accounts']['tax_output'], 'account_id');
        $inIds = array_column($d['accounts']['tax_input'], 'account_id');
        $this->assertSame((int) collect($sheet['liabilities'])->whereIn('account_id', $outIds)->sum('amount'), $d['tax_output'], 'المرجع 2: الخصوم في الميزانية');
        $this->assertSame((int) collect($sheet['assets'])->whereIn('account_id', $inIds)->sum('amount'), $d['tax_input'], 'المرجع 2: الأصول في الميزانية');

        // التفصيل يجمع إلى إجمالي الدور تماماً (لا حساب مفقود ولا مُعدّ مرتين).
        foreach (['tax_output', 'tax_input'] as $role) {
            $this->assertSame($d[$role], (int) array_sum(array_column($d['accounts'][$role], 'balance')), "تفصيل {$role}");
            $ids = array_column($d['accounts'][$role], 'account_id');
            $this->assertSame($ids, array_values(array_unique($ids)), "حساب مكرر في {$role}");
        }

        return $d;
    }

    private function balances(array $details, string $role): array
    {
        $out = [];
        foreach ($details['accounts'][$role] as $a) {
            $out[$a['code']] = $a['balance'];
        }
        ksort($out);

        return $out;
    }

    private function assertBooksBalanced(): void
    {
        $this->assertSame((int) JournalLine::sum('debit'), (int) JournalLine::sum('credit'), 'الدفتر كله يجب أن يتوازن');
    }

    private function ledgerSnapshot(): array
    {
        return [
            'entries' => JournalEntry::query()->orderBy('id')->get(['id', 'number', 'status', 'entry_date'])->toArray(),
            'lines' => JournalLine::query()->orderBy('id')->get(['id', 'journal_entry_id', 'account_id', 'debit', 'credit'])->toArray(),
        ];
    }

    // ───────────── T1. الافتراضي: لا فرق عن السلوك السابق ─────────────

    /** @test */
    public function t01_default_mappings_report_the_system_accounts_balance_and_stay_informational(): void
    {
        $this->out('2120', 15000, '2026-05-01');
        $this->inDr('1150', 7500, '2026-05-02');

        $vat = $this->vat($this->y26);
        $d = $this->assertOracles($this->y26);

        $this->assertSame('info', $vat['bucket']);
        $this->assertTrue($vat['can_close']);
        $this->assertSame([15000, 7500], [$d['tax_output'], $d['tax_input']]);
        $this->assertSame(['2120' => 15000], $this->balances($d, 'tax_output'));
        $this->assertSame(['1150' => 7500], $this->balances($d, 'tax_input'));
        $this->assertSame('verified', $d['verification']['status']);
        $this->assertSame(['resolved', 'resolved'], [$d['mapping_state']['tax_output'], $d['mapping_state']['tax_input']]);
        $this->assertSame('2120', $d['current_account']['tax_output']['code']);
        $this->assertStringContainsString('ليست حالة إقرار', $vat['message']);   // لا يدّعي حالة إقرار/تقديم
        $this->assertStringContainsString('2026-12-31', $vat['message']);
    }

    // ───────────── T2/T4. إعادة التعيين: واحدة ومتعددة ─────────────

    /** @test */
    public function t02_a_single_remap_sums_the_old_and_new_accounts_not_only_the_current_one(): void
    {
        $this->out('2120', 15000, '2026-11-10');
        $this->remap('tax_output', $this->vatAccount('2125', 'liability'));
        $this->out('2125', 30000, '2026-12-15');

        $d = $this->assertOracles($this->y26);

        $this->assertSame(45000, $d['tax_output']);                                        // القديم كان 30000 (2125 وحده)
        $this->assertSame(['2120' => 15000, '2125' => 30000], $this->balances($d, 'tax_output'));
        $this->assertSame(['2125', 30000], [$d['current_account']['tax_output']['code'], $d['current_account']['tax_output']['balance']]);
        $this->assertSame('verified', $d['verification']['status']);
        $this->assertSame('info', $this->vat($this->y26)['bucket']);
        $this->assertBooksBalanced();
    }

    /** @test */
    public function t04_multiple_remaps_back_to_the_original_account_count_each_account_once(): void
    {
        $this->out('2120', 10000, '2026-03-01');
        $this->remap('tax_output', $this->vatAccount('2125', 'liability'));
        $this->out('2125', 20000, '2026-05-01');
        $this->reset('tax_output');                                                         // العودة إلى 2120
        $this->out('2120', 5000, '2026-10-01');

        $d = $this->assertOracles($this->y26);

        $this->assertSame(35000, $d['tax_output']);                                        // 2120: 15000 + 2125: 20000
        $this->assertSame(['2120' => 15000, '2125' => 20000], $this->balances($d, 'tax_output'));
        $this->assertSame(['2120', 15000], [$d['current_account']['tax_output']['code'], $d['current_account']['tax_output']['balance']]);
        $this->assertSame('verified', $d['verification']['status']);
    }

    // ───────────── T3/T13/T14. مرتجعات وإشعارات تعبر حدود السنة ─────────────

    /** @test */
    public function t03_a_sales_return_in_the_next_year_reduces_only_the_later_year_end_balance(): void
    {
        $nov = $this->sale('2026-11-10');                                                   // دائن 2120: 15000
        $this->remap('tax_output', $this->vatAccount('2125', 'liability'));
        $this->sale('2026-12-15');                                                          // دائن 2125: 15000
        $this->salesReturn($nov, '2027-02-10');                                             // REM-06: مدين 2125: 15000

        $d26 = $this->assertOracles($this->y26);
        $d27 = $this->assertOracles($this->y27);

        $this->assertSame(30000, $d26['tax_output']);
        $this->assertSame(['2120' => 15000, '2125' => 15000], $this->balances($d26, 'tax_output'));
        $this->assertSame(15000, $d27['tax_output']);                                       // 2120: 15000 + 2125: 15000 − 15000
        $this->assertSame(['2120' => 15000, '2125' => 0], $this->balances($d27, 'tax_output'));
        $this->assertBooksBalanced();
    }

    /** @test */
    public function t13_a_credit_note_in_the_next_year_after_a_remap_nets_to_zero_at_the_later_year_end(): void
    {
        $invoice = $this->sale('2026-10-01');                                               // دائن 2120: 15000
        $this->remap('tax_output', $this->vatAccount('2125', 'liability'));
        $this->salesNote($invoice, '2027-01-15');                                           // REM-06: مدين 2125: 15000

        $d26 = $this->assertOracles($this->y26);
        $d27 = $this->assertOracles($this->y27);

        $this->assertSame(15000, $d26['tax_output']);
        $this->assertSame(0, $d27['tax_output']);
        // الحساب الحالي وحده (الرقم القديم) يعطي −15000 في 2027: هذا ما يُصحَّح.
        $this->assertSame(-15000, $d27['current_account']['tax_output']['balance']);
        $this->assertSame('verified', $d27['verification']['status']);
    }

    /** @test */
    public function t14_the_input_side_follows_the_same_contract_with_a_debit_note_in_the_next_year(): void
    {
        $purchase = $this->purchaseDoc('2026-04-10');                                       // مدين 1150: 15000
        $this->remap('tax_input', $this->vatAccount('1158', 'asset'));
        $this->purchaseNote($purchase, '2027-02-16');                                       // REM-06 R6-2: دائن 1158: 15000

        $d26 = $this->assertOracles($this->y26);
        $d27 = $this->assertOracles($this->y27);

        $this->assertSame(15000, $d26['tax_input']);
        $this->assertSame(0, $d27['tax_input']);
        $this->assertSame(['1150' => 15000, '1158' => -15000], $this->balances($d27, 'tax_input'));
        $this->assertSame(-15000, $d27['current_account']['tax_input']['balance']);
    }

    // ───────────── T5. تداخل الأدوار ─────────────

    /** @test */
    public function t05_overlapping_role_accounts_are_attributed_by_type_never_double_counted_and_raise_a_warning(): void
    {
        $this->out('2120', 15000, '2026-03-01');
        $this->inDr('1150', 7500, '2026-03-02');
        $this->legacyMap('tax_input', $this->byCode('2120'));                              // مدخلات ← حساب المخرجات النظامي

        $vat = $this->vat($this->y26);
        $d = $this->assertOracles($this->y26);

        $this->assertSame(15000, $d['tax_output']);
        $this->assertSame(7500, $d['tax_input']);                                           // 2120 (التزام) لا يدخل المدخلات
        $this->assertSame(['1150' => 7500], $this->balances($d, 'tax_input'));
        $this->assertContains('vat_role_accounts_overlap', array_column($d['warnings'], 'code'));
        $this->assertSame('unverified', $d['verification']['status']);
        $this->assertSame('warnings', $vat['bucket']);
        $this->assertTrue($vat['can_close']);                                               // تحذير لا مانع
    }

    // ───────────── T6/T7/T8. التلوّث ─────────────

    /** @test */
    public function t06_activity_before_the_mapping_is_included_but_marks_the_balance_unverified_and_still_allows_close(): void
    {
        $dirty = $this->vatAccount('2126', 'liability');
        $this->entry('2026-02-01', [['1130', 100000, 0], ['2126', 0, 100000]]);              // ذمة غير ضريبية سابقة للارتباط
        $this->legacyMap('tax_output', $dirty, Carbon::now()->addMinutes(5));
        $this->out('2126', 15000, '2026-07-01');

        $vat = $this->vat($this->y26);
        $d = $this->assertOracles($this->y26);

        $this->assertSame(115000, $d['tax_output']);
        $warning = collect($d['warnings'])->firstWhere('code', 'vat_account_pre_mapping_activity');
        $this->assertNotNull($warning);
        $this->assertTrue($warning['affects_totals']);
        $this->assertSame('unverified', $d['verification']['status']);
        $this->assertSame('warnings', $vat['bucket']);
        $this->assertStringContainsString('غير مثبتة', $vat['message']);
        $this->assertTrue($vat['can_close']);

        // FC-1a: التحذير يتطلب إقراراً في الواجهة لكنه لا يمنع الإقفال في الخلفية.
        $closed = app(FiscalCloseService::class)->close($this->y26->id, null);
        $this->assertSame(FiscalYear::STATUS_CLOSED, $closed['status']);
    }

    /** @test */
    public function t07_contamination_dated_after_the_year_end_only_notices_the_earlier_year(): void
    {
        $this->out('2120', 15000, '2026-05-01');
        $dirty = $this->vatAccount('2126', 'liability');
        $this->entry('2027-03-01', [['1130', 100000, 0], ['2126', 0, 100000]]);              // ذمة غير ضريبية مؤرَّخة 2027
        $this->legacyMap('tax_output', $dirty, Carbon::now()->addMinutes(5));              // ارتباط لاحق لها
        $this->out('2126', 15000, '2027-06-01');

        $v26 = $this->vat($this->y26);
        $v27 = $this->vat($this->y27);

        // 2026: الحساب الملوَّث بلا أي سطر حتى نهاية السنة ⇒ ملاحظة لا تمسّ الرقم.
        $this->assertSame(15000, $v26['details']['tax_output']);
        $this->assertSame('verified_with_notices', $v26['details']['verification']['status']);
        $this->assertSame('info', $v26['bucket']);
        $notice = collect($v26['details']['warnings'])->firstWhere('code', 'vat_account_pre_mapping_activity');
        $this->assertFalse($notice['affects_totals']);

        // 2027: له حركة في النطاق ⇒ غير موثَّق ⇒ تحذير.
        $this->assertSame(130000, $v27['details']['tax_output']);                           // 2120: 15000 + 2126: 115000
        $this->assertSame('unverified', $v27['details']['verification']['status']);
        $this->assertSame('warnings', $v27['bucket']);
        $this->assertOracles($this->y26);
        $this->assertOracles($this->y27);
    }

    /** @test */
    public function t08_a_manual_journal_on_a_clean_vat_account_is_counted_and_the_not_checked_limit_is_disclosed(): void
    {
        $this->out('2120', 15000, '2026-11-10');
        $this->remap('tax_output', $this->vatAccount('2125', 'liability'));
        $this->out('2125', 30000, '2026-12-15');
        $this->out('2125', 50000, '2026-12-20');                                            // قيد يدوي غير ضريبي يُرى كضريبة

        $vat = $this->vat($this->y26);
        $d = $this->assertOracles($this->y26);

        $this->assertSame(95000, $d['tax_output']);
        $this->assertSame('verified', $d['verification']['status']);                        // سلامة الهيكل لا محتوى القيود
        $this->assertContains('manual_journal_content', $d['not_checked']);
        $this->assertSame($d['verification']['not_checked'], $d['not_checked']);
        $this->assertContains('vat_return_filing', $d['not_checked']);
        $this->assertSame('info', $vat['bucket']);
        $this->assertStringContainsString('لا مطابقة للفواتير', $vat['message']);
    }

    // ───────────── T9/T10. قطع نهاية السنة والقيود المؤرَّخة رجعياً ─────────────

    /** @test */
    public function t09_entries_dated_after_the_year_end_are_excluded_and_the_next_year_is_cumulative(): void
    {
        $this->out('2120', 15000, '2026-05-01');
        $this->out('2120', 15000, '2027-01-03');

        $d26 = $this->assertOracles($this->y26);
        $d27 = $this->assertOracles($this->y27);

        $this->assertSame(15000, $d26['tax_output']);                                       // القديم (كل الزمن) كان 30000
        $this->assertSame(30000, $d27['tax_output']);                                       // تراكمي لا حركة السنة وحدها
    }

    /** @test */
    public function t10_backdated_entries_follow_entry_date_not_the_posting_timestamp_and_period_locks_still_apply(): void
    {
        $this->out('2120', 15000, '2026-05-01');
        $backdated = $this->out('2120', 6000, '2026-12-20');
        JournalEntry::query()->whereKey($backdated->id)->toBase()->update(['created_at' => '2027-01-05 10:00:00']);   // رُحِّل بعد النهاية
        $this->out('2120', 4000, '2027-01-02');                                             // رُحِّل الآن لكن تاريخه بعد النهاية

        $d = $this->assertOracles($this->y26);
        $this->assertSame(21000, $d['tax_output']);                                         // 15000 + 6000 المؤرَّخ رجعياً، دون 4000

        // قفل فترة يغطي 2026 يمنع القيد الرجعي الجديد فلا يتغير الرقم.
        app(AccountingPeriodLockService::class)->create('2026-01-01', '2026-12-31', 'إقفال المراجعة', null);
        $before = $this->ledgerSnapshot();
        try {
            $this->out('2120', 9000, '2026-12-21');
            $this->fail('كان يجب أن يُرفض القيد الرجعي داخل فترة مقفلة');
        } catch (AccountingPeriodLockedException) {
            // المتوقَّع
        }
        $this->assertSame($before, $this->ledgerSnapshot());
        $this->assertSame(21000, $this->vat($this->y26)['details']['tax_output']);
    }

    // ───────────── T11/T12. العكس داخل السنة وبعدها ─────────────

    /** @test */
    public function t11_a_reversal_in_the_same_year_nets_to_zero(): void
    {
        $entry = $this->out('2120', 15000, '2026-06-01');
        app(LedgerService::class)->reverse($entry, '2026-06-20');

        $d = $this->assertOracles($this->y26);
        $this->assertSame(0, $d['tax_output']);
        $this->assertSame(['2120' => 0], $this->balances($d, 'tax_output'));
    }

    /** @test */
    public function t12_a_reversal_dated_in_the_next_year_leaves_the_original_in_the_earlier_year(): void
    {
        $entry = $this->out('2120', 15000, '2026-12-20');
        app(LedgerService::class)->reverse($entry, '2027-01-05');

        $this->assertSame(15000, $this->assertOracles($this->y26)['tax_output']);          // الأصل 'reversed' يبقى محسوباً
        $this->assertSame(0, $this->assertOracles($this->y27)['tax_output']);
        $this->assertSame('reversed', $entry->fresh()->status);
    }

    // ───────────── T15/T16. العزل والفروع ─────────────

    /** @test */
    public function t15_tenant_isolation_a_second_tenants_remap_and_history_never_reach_the_first(): void
    {
        $this->out('2120', 15000, '2026-05-01');
        $before = $this->vat($this->y26)['details'];

        $other = Tenant::create(['name' => 'ب', 'slug' => 'tenant-b-fc', 'vat_number' => '300000000000011', 'currency' => 'SAR']);
        app(TenantContext::class)->set($other->id);
        app(ChartOfAccountsSeeder::class)->seed($other->id);
        $bAccount = $this->vatAccount('2125', 'liability');
        $this->remap('tax_output', $bAccount);
        $this->out('2125', 99000, '2026-06-01');
        $yearB = $this->year('2026');
        $b = $this->vat($yearB)['details'];
        $this->assertSame(99000, $b['tax_output']);
        $this->assertSame(['2120' => 0, '2125' => 99000], $this->balances($b, 'tax_output'));

        app(TenantContext::class)->set($this->tenant->id);
        $after = $this->vat($this->y26)['details'];
        $this->assertSame($before, $after);
        $this->assertNotContains($bAccount->id, array_column($after['accounts']['tax_output'], 'account_id'));
        $this->assertSame(15000, $after['tax_output']);
    }

    /** @test */
    public function t16_the_close_aggregates_every_branch_while_a_branch_filtered_report_does_not(): void
    {
        $x = Branch::create(['code' => '00002', 'name' => 'فرع س', 'is_main' => false]);
        $y = Branch::create(['code' => '00003', 'name' => 'فرع ص', 'is_main' => false]);
        $this->out('2120', 10000, '2026-03-01', $x->id);
        $this->out('2120', 5000, '2026-03-02', $y->id);
        $this->out('2120', 2000, '2026-03-03', null);

        $d = $this->assertOracles($this->y26);
        $this->assertSame(17000, $d['tax_output']);                                         // مؤسسي: كل الفروع + بلا فرع
        $this->assertSame('all', $d['basis']['branches']);
        $this->assertSame(10000, app(ReportService::class)->taxReport(['to' => '2026-12-31', 'branch_id' => [$x->id]])['output_vat']);
    }

    // ───────────── T17/T18/T19. تعيينات غير قابلة للحلّ أو مخالفة ─────────────

    /** @test */
    public function t17_an_inactive_mapped_account_keeps_its_historical_balance_and_raises_a_warning(): void
    {
        $this->out('2120', 15000, '2026-11-10');
        $custom = $this->vatAccount('2125', 'liability');
        $this->remap('tax_output', $custom);
        $this->out('2125', 30000, '2026-12-15');
        $custom->update(['is_active' => false]);

        $vat = $this->vat($this->y26);
        $d = $vat['details'];

        $this->assertSame(45000, $d['tax_output']);
        $this->assertSame(['inactive', 'resolved'], [$d['mapping_state']['tax_output'], $d['mapping_state']['tax_input']]);
        $this->assertSame('warnings', $vat['bucket']);
        $this->assertStringContainsString('غير قابل للحلّ', $vat['message']);
        $this->assertTrue($vat['can_close']);
        $this->assertSame(45000, app(ReportService::class)->taxReport(['to' => '2026-12-31'])['output_vat']);
    }

    /** @test */
    public function t18_an_unmapped_role_is_shown_with_the_system_account_balance_not_hidden(): void
    {
        $this->out('2120', 15000, '2026-05-01');
        AccountRoleMapping::where('role_key', 'tax_output')->delete();

        $vat = $this->vat($this->y26);
        $d = $vat['details'];

        $this->assertSame(15000, $d['tax_output']);
        $this->assertSame('unmapped', $d['mapping_state']['tax_output']);
        $this->assertNull($d['current_account']['tax_output']);
        $this->assertSame('warnings', $vat['bucket']);
        $this->assertStringContainsString('ترحيل ضريبة جديدة سيفشل', $vat['message']);
    }

    /** @test */
    public function t19_a_legacy_mapping_to_a_wrong_type_account_uses_the_role_sign_and_is_unverified(): void
    {
        $wrong = $this->vatAccount('1999', 'asset');                                       // أصل بطبيعة مدينة معيَّن لدور مخرجات
        $this->legacyMap('tax_output', $wrong);
        $this->entry('2026-04-01', [['1999', 20000, 0], ['1130', 0, 20000]]);

        $vat = $this->vat($this->y26);
        $d = $vat['details'];
        $report = app(ReportService::class)->taxReport(['to' => '2026-12-31']);

        // إشارة الدور (دائن − مدين) في الإقفال والتقرير معاً، لا طبيعة الحساب (كان الإقفال القديم يقلبها).
        $this->assertSame(-20000, $d['tax_output']);
        $this->assertSame($report['output_vat'], $d['tax_output']);
        $this->assertSame(-20000, $d['current_account']['tax_output']['balance']);
        $this->assertContains('vat_account_type_mismatch', array_column($d['warnings'], 'code'));
        $this->assertSame('unverified', $d['verification']['status']);
        $this->assertSame('warnings', $vat['bucket']);

        // فرق العرض المعلن: الميزانية تعرض الحساب تحت الأصول بإشارة نوعه (+20000).
        $sheet = app(ReportService::class)->balanceSheet(['to' => '2026-12-31']);
        $this->assertSame(20000, (int) collect($sheet['assets'])->firstWhere('account_id', $wrong->id)['amount']);
    }

    // ───────────── T20. الذمم المدينة/الدائنة: لم تُعدَّل، وأساسها يُعلَن ─────────────

    /** @test */
    public function t20_receivables_and_payables_keep_the_all_time_current_account_basis_and_say_so(): void
    {
        $this->entry('2026-03-01', [['1130', 100000, 0], ['4110', 0, 100000]]);
        $this->entry('2026-04-01', [['5130', 40000, 0], ['2110', 0, 40000]]);
        $this->entry('2027-03-01', [['1130', 7000, 0], ['4110', 0, 7000]]);                 // بعد نهاية 2026: يدخل AR/AP ولا يدخل الضريبة
        $this->out('2120', 15000, '2026-05-01');
        $this->out('2120', 9000, '2027-03-02');

        $readiness = app(FiscalCloseService::class)->readiness($this->y26->fresh());
        $arAp = collect($readiness['info'])->firstWhere('code', 'open_ar_ap');

        $this->assertSame(107000 + 15000 + 9000, $arAp['details']['receivable']);          // 1130 كل الزمن (يشمل 2027 وقيود الضريبة المقابلة)
        $this->assertSame(40000, $arAp['details']['payable']);
        $this->assertSame('all_time_current_account', $arAp['details']['basis']);
        $this->assertStringContainsString('ليست كما في نهاية السنة المالية', $arAp['message']);
        $this->assertNotContains('open_ar_ap', array_column($readiness['warnings'], 'code'));
        $this->assertNotContains('open_ar_ap', array_column($readiness['blockers'], 'code'));

        // بينما الضريبة في الجاهزية نفسها حتى نهاية السنة فقط.
        $this->assertSame(15000, collect($readiness['info'])->firstWhere('code', 'vat_balances')['details']['tax_output']);
    }

    // ───────────── T21. الإقفال والفتح ─────────────

    /** @test */
    public function t21_close_and_reopen_leave_the_vat_balances_unchanged_and_post_no_vat_line(): void
    {
        $this->sale('2026-02-10');
        $this->remap('tax_output', $this->vatAccount('2125', 'liability'));
        $this->sale('2026-08-10');
        $before = $this->assertOracles($this->y26);
        $this->assertSame(30000, $before['tax_output']);

        $closed = app(FiscalCloseService::class)->close($this->y26->id, null);
        $this->assertSame(FiscalYear::STATUS_CLOSED, $closed['status']);
        $close = $this->y26->fresh()->closes()->firstOrFail();
        $vatIds = [$this->byCode('2120')->id, $this->byCode('2125')->id, $this->byCode('1150')->id];
        $this->assertSame(0, JournalLine::where('journal_entry_id', $close->journal_entry_id)->whereIn('account_id', $vatIds)->count());

        $afterClose = $this->assertOracles($this->y26);                                     // القراءة تعمل على سنة مقفلة وتبقى حيّة
        $this->assertSame($before['tax_output'], $afterClose['tax_output']);

        app(FiscalCloseService::class)->reopen($this->y26->id, 'تصحيح قيد متأخر', null);
        $afterReopen = $this->assertOracles($this->y26);
        $this->assertSame($before['tax_output'], $afterReopen['tax_output']);
        $this->assertBooksBalanced();
    }

    // ───────────── T22/T23. عقد الـAPI والتوافق ─────────────

    /** @test */
    public function t23_the_readiness_api_keeps_its_keys_adds_the_new_ones_and_never_writes(): void
    {
        $this->out('2120', 15000, '2026-11-10');
        $this->remap('tax_output', $this->vatAccount('2125', 'liability'));
        $this->out('2125', 30000, '2026-12-15');
        $before = $this->ledgerSnapshot();

        $res = $this->getJson("/api/accounting-settings/fiscal-years/{$this->y26->id}/readiness")->assertOk();
        $readiness = $res->json('data.readiness');
        $this->assertSame(['blockers', 'warnings', 'info', 'can_close'], array_keys($readiness));
        $item = collect($readiness['info'])->firstWhere('code', 'vat_balances');
        $this->assertSame(['severity', 'code', 'message', 'details'], array_keys($item));
        $this->assertSame('info', $item['severity']);

        // المفتاحان القائمان: أعداد صحيحة بالهللات، وقيمتهما الآن رصيد المجموعة حتى نهاية السنة.
        $this->assertSame(45000, $item['details']['tax_output']);
        $this->assertSame(0, $item['details']['tax_input']);
        $this->assertIsInt($item['details']['tax_output']);
        // الإضافات.
        foreach (['basis', 'mapping_state', 'accounts', 'current_account', 'verification', 'warnings', 'not_checked'] as $key) {
            $this->assertArrayHasKey($key, $item['details'], $key);
        }
        $this->assertSame(
            ['accounts' => 'vat_role_account_set', 'as_of' => '2026-12-31', 'cutoff' => 'entry_date', 'cumulative' => true,
                'statuses' => ['posted', 'reversed'], 'branches' => 'all',
                'sign' => ['tax_output' => 'credit_minus_debit', 'tax_input' => 'debit_minus_credit']],
            $item['details']['basis']
        );
        $this->assertSame(['2120', '2125'], array_column($item['details']['accounts']['tax_output'], 'code'));
        $this->assertSame(['verified', true], [$item['details']['verification']['status'], $item['details']['verification']['verified']]);

        // تقرير الضريبة: مفتاح disclosures باقٍ وفارغ، والأرقام بالريال كما كانت.
        $this->getJson('/api/reports/tax-report?to=2026-12-31')->assertOk()
            ->assertJsonPath('output_vat', '450.00')
            ->assertJsonPath('disclosures', [])
            ->assertJsonPath('verification.status', 'verified');

        $this->assertSame($before, $this->ledgerSnapshot());                                // قراءة فقط: لا قيد ولا سطر
    }

    /** @test */
    public function t23b_an_unverified_balance_moves_the_same_item_to_warnings_over_the_api_without_blocking_close(): void
    {
        $this->legacyMap('tax_input', $this->byCode('2120'));                              // تداخل ⇒ غير موثَّق
        $this->out('2120', 15000, '2026-03-01');

        $readiness = $this->getJson("/api/accounting-settings/fiscal-years/{$this->y26->id}/readiness")->assertOk()->json('data.readiness');

        $this->assertNull(collect($readiness['info'])->firstWhere('code', 'vat_balances'));
        $item = collect($readiness['warnings'])->firstWhere('code', 'vat_balances');
        $this->assertSame('warning', $item['severity']);
        $this->assertTrue($readiness['can_close']);
        $this->assertSame([], $readiness['blockers']);
    }
}
