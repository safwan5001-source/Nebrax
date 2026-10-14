<?php

namespace Tests\Feature;

use App\Models\Account;
use App\Models\AccountRoleMapping;
use App\Models\AccountRoleMappingEvent;
use App\Models\CashBankAccount;
use App\Models\FiscalYear;
use App\Models\Invoice;
use App\Models\JournalEntry;
use App\Models\JournalLine;
use App\Models\Partner;
use App\Models\Payment;
use App\Models\Product;
use App\Models\Purchase;
use App\Models\Tenant;
use App\Services\Accounting\FiscalCloseService;
use App\Services\Accounting\FiscalYearService;
use App\Services\Accounting\InvoiceService;
use App\Services\Accounting\LedgerService;
use App\Services\Accounting\PurchaseService;
use App\Services\Reporting\ReportService;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * REM-05 / ACC-01 — سلامة دورَي ضريبة القيمة المضافة وصحة تقرير الضريبة.
 *
 * يغطي: أهلية التعيين (422 + reason ثابت)، حصرية الحسابات، التاريخ وتعدد إعادة التعيين، صحة التقرير
 * عبر تاريخ إعادة التعيين والفترات، التلوّث والتداخل، العكس وإشعارات الدائن، التعيينات القديمة المخالفة،
 * عدم المساس بالقيود المرحَّلة، عزل المستأجر، واعتماد REM-06 / الإقفال المالي (موثَّقاً باختبار).
 *
 * يعمل على SQLite وPostgreSQL (تزامن PostgreSQL في VatRoleIntegrityPostgresTest).
 * تشغيل: php artisan test --filter=VatRoleIntegrityTest
 */
class VatRoleIntegrityTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    private string $token;
    private string $tenantId;
    private Partner $customer;
    private Partner $supplier;
    private Product $service;

    protected function setUp(): void
    {
        parent::setUp();

        $auth = $this->registerTenant('vat-roles', 'owner@vat-roles.test');
        $this->token = $auth['token'];
        $this->tenantId = $auth['tenant_id'];
        app(TenantContext::class)->set($this->tenantId);

        $this->customer = Partner::create(['name' => 'عميل', 'type' => 'customer']);
        $this->supplier = Partner::create(['name' => 'مورد', 'type' => 'supplier']);
        $this->service = Product::create(['name' => 'خدمة', 'sku' => 'SVC', 'type' => 'service', 'track_inventory' => false]);
    }

    // ───────────────────────────── مساعدات ─────────────────────────────

    private function account(string $code, string $type, ?string $tenantId = null): Account
    {
        return Account::create([
            'tenant_id' => $tenantId ?? $this->tenantId, 'code' => $code, 'name' => "حساب {$code}",
            'type' => $type, 'normal_balance' => in_array($type, ['asset', 'expense'], true) ? 'debit' : 'credit',
            'is_group' => false, 'is_active' => true,
        ]);
    }

    private function byCode(string $code): Account
    {
        return Account::where('code', $code)->firstOrFail();
    }

    private function route(string $role, string $accountId)
    {
        return $this->withToken($this->token)->putJson("/api/accounting-settings/account-routing/{$role}", ['account_id' => $accountId]);
    }

    private function resetRole(string $role)
    {
        return $this->withToken($this->token)->deleteJson("/api/accounting-settings/account-routing/{$role}");
    }

    private function map(string $role, Account $account): void
    {
        $this->route($role, $account->id)->assertOk();
    }

    /** يكتب تعييناً مخالفاً مباشرةً (تعيين قديم سابق للإنفاذ) دون المرور بخدمة التوجيه. */
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
            AccountRoleMappingEvent::query()->whereKey($event->id)->toBase()->update(['created_at' => $eventAt->toDateTimeString(), 'updated_at' => $eventAt->toDateTimeString()]);
        }
    }

    private function invoice(string $date, int $unitPrice = 100000, string $type = 'credit'): Invoice
    {
        $invoice = app(InvoiceService::class)->create(
            ['partner_id' => $this->customer->id, 'payment_type' => $type, 'invoice_date' => $date],
            [['description' => 'خدمة', 'quantity' => 1, 'unit_price' => $unitPrice, 'tax_rate' => 15]],
        );

        return app(InvoiceService::class)->post($invoice);
    }

    private function purchase(string $date, int $unitPrice = 100000): Purchase
    {
        $purchase = app(PurchaseService::class)->create(
            ['partner_id' => $this->supplier->id, 'payment_type' => 'credit', 'purchase_date' => $date],
            [['product_id' => $this->service->id, 'quantity' => 1, 'unit_price' => $unitPrice, 'tax_rate' => 15]],
        );

        return app(PurchaseService::class)->post($purchase);
    }

    private function tax(array $filters = []): array
    {
        return app(ReportService::class)->taxReport($filters);
    }

    private function codes(array $report): array
    {
        return collect($report['warnings'])->pluck('code')->unique()->sort()->values()->all();
    }

    /** لقطة قابلة للمقارنة لكل القيود والسطور المرحَّلة. */
    private function ledgerSnapshot(): array
    {
        return [
            'entries' => JournalEntry::query()->orderBy('id')->get(['id', 'number', 'status', 'entry_date'])->toArray(),
            'lines' => JournalLine::query()->orderBy('id')->get(['id', 'journal_entry_id', 'account_id', 'debit', 'credit'])->toArray(),
        ];
    }

    private function balanced(): void
    {
        $this->assertSame(
            (int) JournalLine::query()->sum('debit'),
            (int) JournalLine::query()->sum('credit'),
            'القيد المزدوج يجب أن يبقى متوازناً'
        );
    }

    // ───────────────────── 1. الأهلية: كل فئة غير صالحة ⇒ 422 ─────────────────────

    /** @test */
    public function tax_output_rejects_every_non_liability_type_with_422_and_a_stable_reason(): void
    {
        foreach (['asset', 'equity', 'revenue', 'expense'] as $i => $type) {
            $account = $this->account('9'.($i + 10), $type);
            $this->route('tax_output', $account->id)
                ->assertStatus(422)
                ->assertJsonPath('reason', 'vat_type_mismatch')
                ->assertJsonPath('message', fn ($m) => str_contains($m, 'التزامات'));
        }
        $this->assertSame('2120', $this->mappedCode('tax_output'));
    }

    /** @test */
    public function tax_input_rejects_every_non_asset_type_with_422_and_a_stable_reason(): void
    {
        foreach (['liability', 'equity', 'revenue', 'expense'] as $i => $type) {
            $account = $this->account('9'.($i + 20), $type);
            $this->route('tax_input', $account->id)
                ->assertStatus(422)
                ->assertJsonPath('reason', 'vat_type_mismatch')
                ->assertJsonPath('message', fn ($m) => str_contains($m, 'أصول'));
        }
        $this->assertSame('1150', $this->mappedCode('tax_input'));
    }

    /** @test */
    public function the_system_account_of_the_other_vat_role_is_rejected(): void
    {
        $this->route('tax_input', $this->byCode('2120')->id)->assertStatus(422)->assertJsonPath('reason', 'vat_type_mismatch');
        $this->route('tax_output', $this->byCode('1150')->id)->assertStatus(422)->assertJsonPath('reason', 'vat_type_mismatch');
    }

    /** @test */
    public function cash_and_bank_accounts_are_rejected_for_tax_input(): void
    {
        // حساب النقد النظامي 1110 (أصل) — يمرّ شرط النوع لكنه نقد.
        $this->route('tax_input', $this->byCode('1110')->id)->assertStatus(422)->assertJsonPath('reason', 'vat_cash_bank_account');
        $this->route('tax_input', $this->byCode('1120')->id)->assertStatus(422)->assertJsonPath('reason', 'vat_cash_bank_account');

        // حساب أصل مخصص مربوط بسجل خزينة.
        $vault = $this->account('1119', 'asset');
        CashBankAccount::create(['account_id' => $vault->id, 'type' => 'cash', 'name' => 'خزينة فرعية', 'currency' => 'SAR']);
        $this->route('tax_input', $vault->id)->assertStatus(422)->assertJsonPath('reason', 'vat_cash_bank_account');
    }

    /** @test */
    public function an_account_already_mapped_to_another_role_is_rejected(): void
    {
        // 1130 دور accounts_receivable و1140 دور inventory_asset — كلاهما أصل.
        $this->route('tax_input', $this->byCode('1130')->id)->assertStatus(422)->assertJsonPath('reason', 'vat_account_in_other_role');
        $this->route('tax_input', $this->byCode('1140')->id)->assertStatus(422)->assertJsonPath('reason', 'vat_account_in_other_role');

        $custom = $this->account('1161', 'asset');
        $this->map('purchase_expense', $custom); // أي دور آخر
        $this->route('tax_input', $custom->id)->assertStatus(422)->assertJsonPath('reason', 'vat_account_in_other_role');
    }

    /** @test */
    public function the_two_vat_roles_cannot_share_one_account(): void
    {
        $liability = $this->account('2125', 'liability');
        $this->legacyMap('tax_input', $liability); // تعيين قديم مخالف

        $this->route('tax_output', $liability->id)->assertStatus(422)->assertJsonPath('reason', 'vat_roles_must_differ');
    }

    /** @test */
    public function an_account_in_the_other_vat_roles_history_is_closed_to_this_role(): void
    {
        $liability = $this->account('2126', 'liability');
        $this->legacyMap('tax_input', $liability);
        AccountRoleMapping::where('role_key', 'tax_input')->update(['account_id' => $this->byCode('1150')->id]); // خرج منه لاحقاً

        $this->route('tax_output', $liability->id)->assertStatus(422)->assertJsonPath('reason', 'vat_account_reserved_by_other_vat_role');
    }

    /** @test */
    public function a_vat_reserved_account_cannot_be_given_to_another_role(): void
    {
        $this->route('accounts_receivable', $this->byCode('1150')->id)->assertStatus(422)->assertJsonPath('reason', 'account_reserved_for_vat');
        $this->route('sales_revenue', $this->byCode('2120')->id)->assertStatus(422)->assertJsonPath('reason', 'account_reserved_for_vat');

        // وحساب خرج من دور ضريبي يبقى محجوزاً.
        $custom = $this->account('1157', 'asset');
        $this->map('tax_input', $custom);
        $this->resetRole('tax_input')->assertOk();
        $this->route('purchase_expense', $custom->id)->assertStatus(422)->assertJsonPath('reason', 'account_reserved_for_vat');
    }

    /** @test */
    public function a_new_vat_target_must_be_clean_unless_it_is_a_system_or_already_associated_account(): void
    {
        $used = $this->account('1158', 'asset');
        app(LedgerService::class)->post([
            ['account_id' => $used->id, 'debit' => 5000],
            ['account_id' => $this->byCode('3110')->id, 'credit' => 5000],
        ], ['entry_date' => '2026-01-05']);

        $this->route('tax_input', $used->id)->assertStatus(422)->assertJsonPath('reason', 'vat_account_not_clean');

        // الحساب النظامي مستثنى رغم حركاته (reset وPUT كلاهما).
        $this->invoice('2026-01-10');
        $this->purchase('2026-01-11');
        $this->resetRole('tax_input')->assertOk();
        $this->route('tax_input', $this->byCode('1150')->id)->assertOk();

        // وحساب نظيف خاص ثم حركة عليه ثم تحويل بعيداً ثم عودة إليه (مرتبط تاريخياً بالدور) ⇒ مقبول.
        $clean = $this->account('1159', 'asset');
        $this->map('tax_input', $clean);
        $this->purchase('2026-02-01');
        $this->resetRole('tax_input')->assertOk();
        $this->route('tax_input', $clean->id)->assertOk();
    }

    /** @test */
    public function inactive_group_and_foreign_accounts_are_still_rejected(): void
    {
        $inactive = $this->account('2127', 'liability');
        $inactive->update(['is_active' => false]);
        $this->route('tax_output', $inactive->id)->assertStatus(422);

        $group = $this->account('2128', 'liability');
        $group->update(['is_group' => true]);
        $this->route('tax_output', $group->id)->assertStatus(422);

        $this->route('tax_output', (string) Str::uuid())->assertStatus(422);
    }

    /** @test */
    public function valid_custom_mappings_are_accepted_and_posting_lands_in_them(): void
    {
        $output = $this->account('2125', 'liability');
        $input = $this->account('1158', 'asset');

        $this->route('tax_output', $output->id)->assertOk()->assertJsonPath('data.mapping.violations', []);
        $this->route('tax_input', $input->id)->assertOk()->assertJsonPath('data.mapping.violations', []);

        $sale = $this->invoice('2026-03-01');
        $buy = $this->purchase('2026-03-02');

        $this->assertSame(15000, (int) $this->lineSum($sale->journalEntry()->first(), $output, 'credit'));
        $this->assertSame(15000, (int) $this->lineSum($buy->journalEntry()->first(), $input, 'debit'));
        $this->assertSame(0, (int) JournalLine::where('account_id', $this->byCode('2120')->id)->count());

        $report = $this->tax();
        $this->assertSame(15000, $report['output_vat']);
        $this->assertSame(15000, $report['input_vat']);
        $this->assertSame(0, $report['net_vat']);
        $this->assertTrue($report['verification']['verified']);
        $this->balanced();
    }

    /** @test */
    public function reset_is_always_allowed_for_valid_history_and_records_an_event(): void
    {
        $output = $this->account('2125', 'liability');
        $this->map('tax_output', $output);

        $this->resetRole('tax_output')->assertOk()->assertJsonPath('data.mapping.account.code', '2120');
        $this->assertTrue(AccountRoleMappingEvent::where('role_key', 'tax_output')->where('action', 'mapping_reset')->exists());
    }

    // ───────────── 2. التقرير: قبل/بعد إعادة التعيين، تعدد التعيينات، الفترات ─────────────

    /** @test */
    public function default_tenant_report_is_unchanged_and_verified(): void
    {
        $this->invoice('2026-01-10');
        $this->purchase('2026-01-11', 50000);

        $report = $this->tax(['from' => '2026-01-01', 'to' => '2026-01-31']);

        $this->assertSame(15000, $report['output_vat']);
        $this->assertSame(7500, $report['input_vat']);
        $this->assertSame(7500, $report['net_vat']);
        $this->assertSame('payable', $report['status']);
        $this->assertSame(['verified' => true, 'status' => 'verified', 'issues' => 0], $report['verification']);
        $this->assertSame([], $report['warnings']);
        $this->assertSame(['2120'], collect($report['accounts']['output'])->pluck('code')->all());
        $this->assertSame(['1150'], collect($report['accounts']['input'])->pluck('code')->all());
    }

    /** @test */
    public function the_report_sums_the_old_and_new_accounts_across_a_remap_and_respects_periods(): void
    {
        $custom = $this->account('2125', 'liability');
        $this->invoice('2026-01-10');                 // VAT 15000 على 2120
        $this->map('tax_output', $custom);
        $this->invoice('2026-02-10');                 // VAT 15000 على 2125

        $all = $this->tax(['from' => '2026-01-01', 'to' => '2026-02-28']);
        $this->assertSame(30000, $all['output_vat']);   // تعريف الخلل: كان يظهر 15000
        $this->assertTrue($all['verification']['verified']);
        $this->assertEqualsCanonicalizing(['2120', '2125'], collect($all['accounts']['output'])->pluck('code')->all());

        $this->assertSame(15000, $this->tax(['from' => '2026-01-01', 'to' => '2026-01-31'])['output_vat']);
        $this->assertSame(15000, $this->tax(['from' => '2026-02-01', 'to' => '2026-02-28'])['output_vat']);
        $this->assertSame(30000, $this->tax()['output_vat']);
        $this->assertSame(0, $this->tax(['from' => '2026-03-01', 'to' => '2026-03-31'])['output_vat']);

        // الأرصدة التاريخية بقيت في أماكنها.
        $this->assertSame(15000, $this->net($this->byCode('2120'), 'credit'));
        $this->assertSame(15000, $this->net($custom, 'credit'));
    }

    /** @test */
    public function multiple_remaps_form_a_history_chain_and_the_input_side_follows_the_same_rule(): void
    {
        $o1 = $this->account('2125', 'liability');
        $o2 = $this->account('2126', 'liability');
        $i1 = $this->account('1158', 'asset');
        $i2 = $this->account('1159', 'asset');

        $this->invoice('2026-01-10'); $this->purchase('2026-01-11');
        $this->map('tax_output', $o1); $this->map('tax_input', $i1);
        $this->invoice('2026-02-10'); $this->purchase('2026-02-11');
        $this->map('tax_output', $o2); $this->map('tax_input', $i2);
        $this->invoice('2026-03-10'); $this->purchase('2026-03-11');
        $this->resetRole('tax_output'); $this->resetRole('tax_input');
        $this->invoice('2026-04-10'); $this->purchase('2026-04-11');

        $report = $this->tax();
        $this->assertSame(60000, $report['output_vat']);
        $this->assertSame(60000, $report['input_vat']);
        $this->assertSame(0, $report['net_vat']);
        $this->assertTrue($report['verification']['verified']);
        $this->assertCount(3, $report['accounts']['output']);
        $this->assertCount(3, $report['accounts']['input']);

        foreach ([['2026-01-01', '2026-01-31'], ['2026-02-01', '2026-02-28'], ['2026-03-01', '2026-03-31'], ['2026-04-01', '2026-04-30']] as [$from, $to]) {
            $period = $this->tax(['from' => $from, 'to' => $to]);
            $this->assertSame(15000, $period['output_vat'], "output {$from}");
            $this->assertSame(15000, $period['input_vat'], "input {$from}");
        }
        $this->balanced();
    }

    /** @test */
    public function a_reversed_invoice_nets_to_zero_inside_the_role_account_set(): void
    {
        $custom = $this->account('2125', 'liability');
        $this->map('tax_output', $custom);
        $invoice = $this->invoice('2026-02-10');
        app(LedgerService::class)->reverse($invoice->journalEntry()->first(), '2026-02-15', 'عكس');

        $report = $this->tax();
        $this->assertSame(0, $report['output_vat']);
        $this->assertTrue($report['verification']['verified']);
    }

    /** @test */
    public function a_credit_note_posted_to_the_hard_coded_account_after_a_remap_is_still_reported(): void
    {
        // REM-06: الإشعار ما زال يرحّل إلى 2120 بالكود. التقرير يبقى كاملاً بفضل الحساب النظامي في المجموعة.
        $custom = $this->account('2125', 'liability');
        $this->map('tax_output', $custom);
        $invoice = $this->invoice('2026-02-10');   // 15000 على 2125

        $noteId = $this->withToken($this->token)->postJson('/api/credit-notes', [
            'partner_id' => $this->customer->id,
            'original_invoice_id' => $invoice->id,
            'note_date' => '2026-02-20',
            'items' => [['source_line_id' => $invoice->lines()->first()->id, 'quantity' => 1]],
        ])->assertCreated()['data']['id'];
        $this->withToken($this->token)->postJson("/api/credit-notes/{$noteId}/post")->assertOk();

        $report = $this->tax();
        $this->assertSame(0, $report['output_vat']);          // 15000 دائن − 15000 مدين (إشعار كامل)
        $this->assertTrue($report['verification']['verified']);

        // التوزيع الدفتري منقسم حتى REM-06: الدائن على 2125 والمدين على 2120.
        $this->assertSame(15000, $this->net($custom, 'credit'));
        $this->assertSame(-15000, $this->net($this->byCode('2120'), 'credit'));
        $this->balanced();
    }

    /** @test */
    public function the_branch_filter_is_honoured_by_the_role_account_set(): void
    {
        $custom = $this->account('2125', 'liability');
        $this->invoice('2026-01-10');
        $this->map('tax_output', $custom);
        $this->invoice('2026-02-10');

        $report = $this->tax(['branch_id' => [(string) Str::uuid()]]);
        $this->assertSame(0, $report['output_vat']);
    }

    // ───────────── 3. التلوّث والتداخل: لا يُعرض إجمالي ملوَّث كموثَّق ─────────────

    /** @test */
    public function overlapping_roles_are_detected_attributed_by_type_and_never_reported_as_verified(): void
    {
        $this->legacyMap('tax_input', $this->byCode('2120')); // مدخلات ← حساب المخرجات النظامي (تعيين قديم)
        $this->invoice('2026-01-10');

        $report = $this->tax();
        $this->assertContains('vat_role_accounts_overlap', $this->codes($report));
        $this->assertFalse($report['verification']['verified']);
        $this->assertSame('unverified', $report['verification']['status']);
        // 2120 التزام ⇒ يُنسب للمخرجات فقط؛ لا ازدواج عدّ.
        $this->assertSame(15000, $report['output_vat']);
        $this->assertSame(0, $report['input_vat']);
    }

    /** @test */
    public function type_cash_bank_and_other_role_contamination_are_flagged(): void
    {
        $this->legacyMap('tax_output', $this->byCode('4110')); // إيرادات المبيعات: نوع خاطئ + دور آخر
        $this->legacyMap('tax_input', $this->byCode('1110'));  // نقد

        $codes = $this->codes($this->tax());
        $this->assertContains('vat_account_type_mismatch', $codes);
        $this->assertContains('vat_account_mapped_to_other_role', $codes);
        $this->assertContains('vat_account_cash_bank', $codes);
        $this->assertFalse($this->tax()['verification']['verified']);
    }

    /** @test */
    public function activity_before_the_association_is_flagged_as_potentially_non_vat(): void
    {
        $used = $this->account('1158', 'asset');
        app(LedgerService::class)->post([
            ['account_id' => $used->id, 'debit' => 9000],
            ['account_id' => $this->byCode('3110')->id, 'credit' => 9000],
        ], ['entry_date' => '2026-01-01']);

        // ارتبط الحساب بالدور بعد أن صارت عليه حركة (تعيين قديم سابق للإنفاذ).
        $this->legacyMap('tax_input', $used, Carbon::now()->addMinutes(5));

        $report = $this->tax();
        $this->assertContains('vat_account_pre_mapping_activity', $this->codes($report));
        $this->assertFalse($report['verification']['verified']);
    }

    /** @test */
    public function a_mapped_account_without_an_audit_trail_but_with_lines_is_flagged(): void
    {
        $used = $this->account('1158', 'asset');
        app(LedgerService::class)->post([
            ['account_id' => $used->id, 'debit' => 9000],
            ['account_id' => $this->byCode('3110')->id, 'credit' => 9000],
        ], ['entry_date' => '2026-01-01']);
        AccountRoleMapping::where('role_key', 'tax_input')->update(['account_id' => $used->id]); // بلا حدث

        $this->assertContains('vat_account_unaudited_history', $this->codes($this->tax()));
    }

    /** @test */
    public function lines_from_sources_that_never_carry_vat_are_flagged_within_the_period_only(): void
    {
        app(LedgerService::class)->post([
            ['account_id' => $this->byCode('1110')->id, 'debit' => 4000],
            ['account_id' => $this->byCode('2120')->id, 'credit' => 4000],
        ], ['entry_date' => '2026-01-10', 'source_type' => Payment::class, 'source_id' => (string) Str::uuid()]);

        $this->assertContains('vat_account_non_vat_source', $this->codes($this->tax(['from' => '2026-01-01', 'to' => '2026-01-31'])));
        $this->assertNotContains('vat_account_non_vat_source', $this->codes($this->tax(['from' => '2026-02-01', 'to' => '2026-02-28'])));
    }

    // ───────────── 4. تعيينات قديمة مخالفة: تُرحَّل وتُعلَّم ولا تُعاد كتابتها ─────────────

    /** @test */
    public function an_existing_invalid_mapping_still_posts_but_is_visibly_flagged(): void
    {
        $revenueLike = $this->account('4999', 'revenue');
        $this->legacyMap('tax_output', $revenueLike);

        $invoice = $this->invoice('2026-01-10'); // لا يُحجب الترحيل
        $this->assertSame(15000, (int) $this->lineSum($invoice->journalEntry()->first(), $revenueLike, 'credit'));

        $list = $this->withToken($this->token)->getJson('/api/accounting-settings/account-routing')->assertOk();
        $role = collect($list->json('data.roles'))->firstWhere('key', 'tax_output');
        $this->assertSame('mapped', $role['mapping']['state']);                 // state لم يتغيّر
        $this->assertSame('vat_type_mismatch', $role['mapping']['violations'][0]['code']);
        $clean = collect($list->json('data.roles'))->firstWhere('key', 'tax_input');
        $this->assertSame([], $clean['mapping']['violations']);

        $report = $this->tax();
        $this->assertFalse($report['verification']['verified']);
        $this->assertContains('vat_account_type_mismatch', $this->codes($report));

        // تغييره لاحقاً يخضع للقواعد الجديدة، والعودة لصالح تنجح.
        $this->route('tax_output', $this->account('4998', 'revenue')->id)->assertStatus(422);
        $this->resetRole('tax_output')->assertOk()->assertJsonPath('data.mapping.violations', []);
        $this->assertTrue($this->tax()['verification']['status'] === 'unverified'); // التاريخ الملوّث يبقى معلَّماً
    }

    /** @test */
    public function enforcement_never_rewrites_mappings_events_or_posted_entries(): void
    {
        $this->invoice('2026-01-10');
        $this->purchase('2026-01-11');
        $legacy = $this->account('4999', 'revenue');
        $this->legacyMap('tax_output', $legacy);
        $this->invoice('2026-01-12');

        $ledgerBefore = $this->ledgerSnapshot();
        $mappingsBefore = AccountRoleMapping::query()->orderBy('role_key')->get(['role_key', 'account_id'])->toArray();
        $eventsBefore = AccountRoleMappingEvent::count();

        $this->route('tax_output', $this->account('4998', 'revenue')->id)->assertStatus(422);       // مرفوض
        $this->route('tax_input', $this->byCode('2120')->id)->assertStatus(422);                    // مرفوض
        $this->tax(); $this->withToken($this->token)->getJson('/api/accounting-settings/account-routing')->assertOk();

        $this->assertSame($ledgerBefore, $this->ledgerSnapshot());
        $this->assertSame($mappingsBefore, AccountRoleMapping::query()->orderBy('role_key')->get(['role_key', 'account_id'])->toArray());
        $this->assertSame($eventsBefore, AccountRoleMappingEvent::count());

        // وإعادة ضبط صالحة لا تمسّ القيود التاريخية.
        $this->resetRole('tax_output')->assertOk();
        $this->assertSame($ledgerBefore, $this->ledgerSnapshot());
        $this->balanced();
    }

    // ───────────── 5. عزل المستأجر ─────────────

    /** @test */
    public function tenant_isolation_holds_for_mappings_history_and_reports(): void
    {
        $custom = $this->account('2125', 'liability');
        $this->map('tax_output', $custom);
        $this->invoice('2026-01-10');
        $this->map('tax_input', $this->account('1158', 'asset')); // حساب A محجوز للضريبة

        $other = $this->registerTenant('vat-other', 'owner@vat-other.test');
        app(TenantContext::class)->set($other['tenant_id']);

        // B لا يستطيع تعيين حساب A (يظهر «غير موجود») ولا يتأثر تقريره.
        $this->withToken($other['token'])->putJson('/api/accounting-settings/account-routing/tax_output', ['account_id' => $custom->id])->assertStatus(422);
        $report = $this->tax();
        $this->assertSame(0, $report['output_vat']);
        $this->assertTrue($report['verification']['verified']);
        $this->assertSame(['2120'], collect($report['accounts']['output'])->pluck('code')->all());

        // حجز حسابات A لا يتسرب إلى B: B يعيّن حساباً بالكود نفسه بحرية.
        $own = $this->account('2125', 'liability', $other['tenant_id']);
        $this->withToken($other['token'])->putJson('/api/accounting-settings/account-routing/tax_output', ['account_id' => $own->id])->assertOk();
        $this->assertSame(1, AccountRoleMappingEvent::where('role_key', 'tax_output')->count());

        // وتعيين B لا يغيّر تقرير A.
        app(TenantContext::class)->set($this->tenantId);
        $this->assertSame(15000, $this->tax()['output_vat']);
        $this->assertSame(2, AccountRoleMappingEvent::where('role_key', 'tax_output')->count() + AccountRoleMappingEvent::where('role_key', 'tax_input')->count());
    }

    // ───────────── 6. REM-06 / الإقفال المالي: الاعتماد الموثَّق ─────────────

    /** @test */
    public function fiscal_close_reads_only_the_current_role_account_which_is_a_documented_rem06_dependency(): void
    {
        $custom = $this->account('2125', 'liability');
        $this->invoice('2026-01-10');          // 15000 على 2120
        $this->map('tax_output', $custom);
        $this->invoice('2026-02-10');          // 15000 على 2125

        $year = FiscalYear::findOrFail(app(FiscalYearService::class)->create(
            ['name' => '2026', 'start_date' => '2026-01-01', 'end_date' => '2026-12-31'], null
        )['id']);
        $vat = collect(app(FiscalCloseService::class)->readiness($year)['info'])->firstWhere('code', 'vat_balances');

        // خط التحكم في الإقفال يرى الحساب الحالي وحده (15000) بينما تقرير الضريبة الكامل 30000.
        // لا يعدّل REM-05 الإقفال؛ توحيده ضمن REM-06.
        $this->assertSame(15000, $vat['details']['tax_output']);
        $this->assertSame(30000, $this->tax()['output_vat']);
    }

    // ───────────── مساعدات تأكيد ─────────────

    private function mappedCode(string $role): string
    {
        return Account::query()->whereKey(AccountRoleMapping::where('role_key', $role)->value('account_id'))->value('code');
    }

    private function lineSum(JournalEntry $entry, Account $account, string $side): int
    {
        return (int) JournalLine::where('journal_entry_id', $entry->id)->where('account_id', $account->id)->sum($side);
    }

    /** صافي الحساب بالجانب المطلوب (credit ⇒ دائن − مدين). */
    private function net(Account $account, string $side): int
    {
        $debit = (int) JournalLine::where('account_id', $account->id)->sum('debit');
        $credit = (int) JournalLine::where('account_id', $account->id)->sum('credit');

        return $side === 'credit' ? $credit - $debit : $debit - $credit;
    }
}
