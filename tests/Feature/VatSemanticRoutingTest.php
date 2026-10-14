<?php

namespace Tests\Feature;

use App\Models\Account;
use App\Models\AccountRoleMapping;
use App\Models\Asset;
use App\Models\Expense;
use App\Models\FiscalYear;
use App\Models\JournalEntry;
use App\Models\JournalLine;
use App\Services\Accounting\AccountRoutingService;
use App\Services\Accounting\AssetService;
use App\Services\Accounting\ExpenseService;
use App\Services\Accounting\FiscalCloseService;
use App\Services\Accounting\FiscalYearService;
use App\Services\Reporting\ReportService;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use RuntimeException;
use Tests\TestCase;

/**
 * REM-06 / ACC-02 — توجيه ضريبة المدخلات دلالياً في المصروفات واقتناء الأصول.
 *
 * كلاهما مستند **منشئ** للضريبة (لا عكس لمستند سابق)، فيُحلّ `tax_input` الحالي — نفس عقد
 * `PurchaseService` منذ ACC-4. المبالغ والتقريب لا يتغيّران؛ التعيين الفاسد فشلٌ مغلق بلا قيد.
 *
 * قيد مصروف 1,000.00 + ضريبة 15% نقداً (التعيين الافتراضي):
 *   | الحساب            | مدين     | دائن     |
 *   | 5130 المصروف      | 100000   |          |
 *   | tax_input (1150)  |  15000   |          |
 *   | 1110 الصندوق      |          | 115000   |
 *
 * تشغيل: php artisan test --filter=VatSemanticRoutingTest
 */
class VatSemanticRoutingTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    private string $token;
    private string $tenantId;

    protected function setUp(): void
    {
        parent::setUp();

        $auth = $this->registerTenant('vat-routing', 'owner@vat-routing.test');
        $this->token = $auth['token'];
        $this->tenantId = $auth['tenant_id'];
        app(TenantContext::class)->set($this->tenantId);
    }

    // ───────────────────────────── مساعدات ─────────────────────────────

    private function byCode(string $code): Account
    {
        return Account::where('code', $code)->firstOrFail();
    }

    private function inputAccount(string $code, ?string $tenantId = null): Account
    {
        return Account::create([
            'tenant_id' => $tenantId ?? $this->tenantId, 'code' => $code, 'name' => "ضريبة مدخلات {$code}",
            'type' => 'asset', 'normal_balance' => 'debit', 'is_group' => false, 'is_active' => true,
        ]);
    }

    private function remapInput(Account $account): void
    {
        // عبر خدمة التوجيه نفسها (قواعد REM-05 كاملة) — مسار HTTP مغطّى في VatRoleIntegrityTest، واستدعاؤه
        // هنا كان سيبدّل سياق الفرع بين المستندات داخل الاختبار الواحد.
        app(AccountRoutingService::class)->setMapping('tax_input', $account->id, null);
    }

    private function expense(int $amount = 100000, int $rate = 15, string $date = '2026-03-10'): Expense
    {
        $service = app(ExpenseService::class);

        return $service->post($service->create([
            'account_id' => $this->byCode('5130')->id, 'amount' => $amount, 'tax_rate' => $rate,
            'payment_method' => 'cash', 'expense_date' => $date,
        ]));
    }

    private function asset(int $cost = 1000000, int $rate = 15, string $date = '2026-03-11'): Asset
    {
        $service = app(AssetService::class);

        return $service->post($service->create([
            'name' => 'مولّد', 'account_id' => $this->byCode('1210')->id, 'cost' => $cost, 'tax_rate' => $rate,
            'payment_method' => 'cash', 'acquisition_date' => $date,
        ]));
    }

    /** @return array<string, array{0:int,1:int}> code => [debit, credit] */
    private function journal(string $sourceType, string $sourceId): array
    {
        $entry = JournalEntry::with('lines.account')->where('source_type', $sourceType)->where('source_id', $sourceId)->sole();
        $this->assertSame((int) $entry->lines->sum('debit'), (int) $entry->lines->sum('credit'), 'قيد غير متوازن');

        return $entry->lines->mapWithKeys(fn (JournalLine $l) => [$l->account->code => [(int) $l->debit, (int) $l->credit]])->all();
    }

    // ───────────────────────────── المصروفات ─────────────────────────────

    /** @test */
    public function an_expense_with_default_mappings_posts_input_vat_to_1150_exactly_as_before(): void
    {
        $expense = $this->expense();

        $this->assertSame([
            '5130' => [100000, 0],
            '1150' => [15000, 0],
            '1110' => [0, 115000],
        ], $this->journal(Expense::class, $expense->id));
        $this->assertSame(15000, (int) $expense->tax_amount);
        $this->assertSame(115000, (int) $expense->total);
    }

    /** @test */
    public function an_expense_posts_input_vat_to_the_current_tax_input_role_after_remapping(): void
    {
        $custom = $this->inputAccount('1158');
        $this->remapInput($custom);

        $expense = $this->expense();

        $this->assertSame([
            '5130' => [100000, 0],
            '1158' => [15000, 0],
            '1110' => [0, 115000],
        ], $this->journal(Expense::class, $expense->id));
        $this->assertSame(0, (int) JournalLine::where('account_id', $this->byCode('1150')->id)->count());
    }

    /** @test */
    public function multiple_remaps_route_each_expense_to_the_role_in_force_and_never_rewrite_earlier_ones(): void
    {
        $first = $this->expense(date: '2026-01-10');            // 1150
        $a = $this->inputAccount('1158');
        $this->remapInput($a);
        $second = $this->expense(date: '2026-02-10');           // 1158
        $b = $this->inputAccount('1159');
        $this->remapInput($b);
        $third = $this->expense(date: '2026-03-10');            // 1159
        app(AccountRoutingService::class)->reset('tax_input', null);
        $fourth = $this->expense(date: '2026-04-10');           // 1150 مجدداً

        $this->assertArrayHasKey('1150', $this->journal(Expense::class, $first->id));
        $this->assertArrayHasKey('1158', $this->journal(Expense::class, $second->id));
        $this->assertArrayHasKey('1159', $this->journal(Expense::class, $third->id));
        $this->assertArrayHasKey('1150', $this->journal(Expense::class, $fourth->id));

        // تقرير REM-05 يجمع كل حسابات الدور: 4 × 150.00، موثَّق.
        $report = app(ReportService::class)->taxReport();
        $this->assertSame(60000, $report['input_vat']);
        $this->assertSame('verified', $report['verification']['status']);
    }

    /** @test */
    public function vat_amount_and_rounding_are_unchanged_by_routing(): void
    {
        $this->remapInput($this->inputAccount('1158'));

        // 333.33 × 15% = 49.9995 ⇒ 50.00 (نصف لأعلى بالهللات) — نفس دالة الحساب.
        $expense = $this->expense(amount: 33333);
        $this->assertSame(['5130' => [33333, 0], '1158' => [5000, 0], '1110' => [0, 38333]], $this->journal(Expense::class, $expense->id));

        // معدل صفري: لا سطر ضريبة إطلاقاً.
        $zero = $this->expense(amount: 10000, rate: 0);
        $this->assertSame(['5130' => [10000, 0], '1110' => [0, 10000]], $this->journal(Expense::class, $zero->id));
    }

    /** @test */
    public function an_invalid_tax_input_mapping_fails_closed_and_rolls_the_expense_back(): void
    {
        $custom = $this->inputAccount('1158');
        $this->remapInput($custom);
        $custom->update(['is_active' => false]);               // تعطيل الحساب بعد التعيين

        $service = app(ExpenseService::class);
        $draft = $service->create([
            'account_id' => $this->byCode('5130')->id, 'amount' => 100000, 'tax_rate' => 15, 'payment_method' => 'cash',
        ]);
        $entriesBefore = JournalEntry::count();

        try {
            $service->post($draft);
            $this->fail('كان يجب رفض الترحيل');
        } catch (RuntimeException $e) {
            $this->assertStringContainsString('tax_input', $e->getMessage());
        }

        // لا رجوع صامت إلى 1150، ولا قيد، والمستند ما زال مسودة.
        $this->assertSame($entriesBefore, JournalEntry::count());
        $this->assertSame('draft', $draft->fresh()->status);
        $this->assertNull($draft->fresh()->journal_entry_id);
        $this->assertSame(0, (int) JournalLine::where('account_id', $this->byCode('1150')->id)->count());
    }

    /** @test */
    public function an_unmapped_tax_input_role_fails_closed_without_a_journal_entry(): void
    {
        AccountRoleMapping::where('role_key', 'tax_input')->delete();

        $service = app(ExpenseService::class);
        $draft = $service->create([
            'account_id' => $this->byCode('5130')->id, 'amount' => 100000, 'tax_rate' => 15, 'payment_method' => 'cash',
        ]);

        $this->expectException(RuntimeException::class);
        try {
            $service->post($draft);
        } finally {
            $this->assertSame(0, JournalEntry::where('source_type', Expense::class)->count());
            $this->assertSame('draft', $draft->fresh()->status);
        }
    }

    /** @test */
    public function a_zero_rate_expense_does_not_require_a_tax_input_mapping(): void
    {
        AccountRoleMapping::where('role_key', 'tax_input')->delete();

        $expense = $this->expense(amount: 10000, rate: 0);
        $this->assertSame(['5130' => [10000, 0], '1110' => [0, 10000]], $this->journal(Expense::class, $expense->id));
    }

    // ───────────────────────────── الأصول ─────────────────────────────

    /** @test */
    public function an_asset_acquisition_routes_input_vat_through_the_role_with_exact_amounts(): void
    {
        $default = $this->asset();
        $this->assertSame([
            '1210' => [1000000, 0],
            '1150' => [150000, 0],
            '1110' => [0, 1150000],
        ], $this->journal(Asset::class, $default->id));

        $custom = $this->inputAccount('1158');
        $this->remapInput($custom);
        $routed = $this->asset(date: '2026-04-01');
        $this->assertSame([
            '1210' => [1000000, 0],
            '1158' => [150000, 0],
            '1110' => [0, 1150000],
        ], $this->journal(Asset::class, $routed->id));

        // القيد السابق لم يتغيّر.
        $this->assertArrayHasKey('1150', $this->journal(Asset::class, $default->id));
    }

    /** @test */
    public function an_invalid_mapping_blocks_the_asset_acquisition_atomically(): void
    {
        $custom = $this->inputAccount('1158');
        $this->remapInput($custom);
        $custom->update(['is_active' => false]);

        $service = app(AssetService::class);
        $draft = $service->create([
            'name' => 'مولّد', 'account_id' => $this->byCode('1210')->id, 'cost' => 1000000, 'tax_rate' => 15, 'payment_method' => 'cash',
        ]);

        try {
            $service->post($draft);
            $this->fail('كان يجب رفض الترحيل');
        } catch (RuntimeException) {
        }

        $this->assertSame(0, JournalEntry::where('source_type', Asset::class)->count());
        $this->assertSame('draft', $draft->fresh()->status);
    }

    // ───────────────────────────── العزل والتقارير ─────────────────────────────

    /** @test */
    public function a_tenant_mapping_never_routes_another_tenants_postings(): void
    {
        $this->remapInput($this->inputAccount('1158'));     // المستأجر أ

        $other = $this->registerTenant('vat-routing-b', 'owner@vat-routing-b.test');
        app(TenantContext::class)->set($other['tenant_id']);
        $expense = $this->expense();

        // ب يبقى على حسابه الافتراضي — لا يرى حساب أ ولا تعيينه.
        $this->assertSame(['5130' => [100000, 0], '1150' => [15000, 0], '1110' => [0, 115000]], $this->journal(Expense::class, $expense->id));
        $line = JournalLine::where('journal_entry_id', $expense->journal_entry_id)->where('debit', 15000)->sole();
        $this->assertSame($other['tenant_id'], Account::query()->whereKey($line->account_id)->value('tenant_id'));
    }

    /** @test */
    public function post_remap_expenses_feed_the_input_vat_set_and_the_fiscal_close_line_matches_the_report(): void
    {
        // ACC-02-FC: كان الاختبار يثبّت إفصاح الفرق {15000، 30000، 15000} بين سطر الإقفال (1158 وحده) ومجموعة الدور.
        // الإقفال يقرأ الآن المجموعة نفسها حتى نهاية السنة فلا فرق؛ والرصيد القديم محفوظ في current_account.
        $this->expense(date: '2026-01-10');                     // 150.00 على 1150 قبل إعادة التعيين
        $custom = $this->inputAccount('1158');
        $this->remapInput($custom);
        $this->expense(date: '2026-02-10');                     // 150.00 على 1158 (كان سابقاً يذهب إلى 1150)

        $report = app(ReportService::class)->taxReport();
        $this->assertSame(30000, $report['input_vat']);
        $this->assertSame([], $report['disclosures']);

        $year = FiscalYear::findOrFail(app(FiscalYearService::class)->create(
            ['name' => '2026', 'start_date' => '2026-01-01', 'end_date' => '2026-12-31'], null
        )['id']);
        $vat = collect(app(FiscalCloseService::class)->readiness($year)['info'])->firstWhere('code', 'vat_balances');

        $this->assertSame(30000, $vat['details']['tax_input']);
        $this->assertSame($report['input_vat'], $vat['details']['tax_input']);
        // الحساب الحالي يحمل ضريبة ما بعد إعادة التعيين فعلاً (الرقم القديم)؛ الباقي على 1150 قبلها.
        $this->assertSame(['1158', 15000], [
            $vat['details']['current_account']['tax_input']['code'],
            $vat['details']['current_account']['tax_input']['balance'],
        ]);
    }
}
