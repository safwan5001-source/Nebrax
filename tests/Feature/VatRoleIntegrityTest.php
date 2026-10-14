<?php

namespace Tests\Feature;

use App\Models\Account;
use App\Models\Branch;
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
        $this->assertTrue($report['verification']['verified']);
        $this->assertSame('verified', $report['verification']['status']);
        $this->assertSame([0, 0], [$report['verification']['issues'], $report['verification']['notices']]);
        $this->assertSame([], $report['warnings']);
        $this->assertSame([], $report['disclosures']);
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
    public function a_credit_note_after_a_remap_uses_the_current_role_and_the_report_stays_complete(): void
    {
        // REM-06 (R6-1): الإشعار يحلّ الدور الحالي وقت الترحيل (2125)، لا حساب الفاتورة الأصلية (2120).
        // الفاتورة قبل إعادة التعيين ⇒ توزيع الأستاذ منقسم، والتقرير (مجموعة الدور) كاملٌ وموثَّق.
        $invoice = $this->invoice('2026-01-10');                 // VAT 150.00 دائن 2120
        $custom = $this->account('2125', 'liability');
        $this->map('tax_output', $custom);

        $noteId = $this->withToken($this->token)->postJson('/api/credit-notes', [
            'partner_id' => $this->customer->id,
            'original_invoice_id' => $invoice->id,
            'note_date' => '2026-02-20',
            'items' => [['source_line_id' => $invoice->lines()->first()->id, 'quantity' => 1]],
        ])->assertCreated()['data']['id'];
        $this->withToken($this->token)->postJson("/api/credit-notes/{$noteId}/post")->assertOk();

        $report = $this->tax();
        $this->assertSame(0, $report['output_vat']);          // 15000 دائن − 15000 مدين (إشعار كامل)
        $this->assertSame('verified', $report['verification']['status']);

        // الأستاذ: 2120 دائن 150.00 (الفاتورة)، 2125 مدين 150.00 (الإشعار) — الفرق مع سطر الإقفال مُفصَح عنه.
        $this->assertSame(15000, $this->net($this->byCode('2120'), 'credit'));
        $this->assertSame(-15000, $this->net($custom, 'credit'));
        $disclosure = collect($report['disclosures'])->firstWhere('role_key', 'tax_output');
        $this->assertSame([-15000, 0, 15000], [$disclosure['current_balance'], $disclosure['set_balance'], $disclosure['difference']]);
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

    // ───────────── 3b. دلالات التوثيق: ما فُحص، وما لم يُفحص، وأثر النطاق ─────────────

    /** @test */
    public function verification_declares_what_was_checked_and_what_was_not(): void
    {
        $this->invoice('2026-01-10');
        $v = $this->tax()['verification'];

        $this->assertSame('role_account_integrity', $v['basis']);
        $this->assertSame(
            ['vat_role_accounts_overlap', 'vat_account_type_mismatch', 'vat_account_cash_bank', 'vat_account_mapped_to_other_role',
                'vat_account_pre_mapping_activity', 'vat_account_unaudited_history', 'vat_account_non_vat_source'],
            array_column($v['checks'], 'code')
        );
        $this->assertSame(['passed'], array_values(array_unique(array_column($v['checks'], 'result'))));
        // «موثَّق» لا يعني مطابقة الفواتير ولا الإقرار ولا ZATCA — يُعلن صراحةً.
        foreach (['invoice_to_ledger_reconciliation', 'zatca_clearance', 'vat_return_filing'] as $notChecked) {
            $this->assertContains($notChecked, $v['not_checked']);
        }
    }

    /** @test */
    public function a_contaminated_historical_account_only_taints_the_periods_it_moved_in(): void
    {
        $legacy = $this->account('4999', 'revenue');
        $this->legacyMap('tax_output', $legacy);            // تعيين قديم مخالف
        $this->invoice('2026-01-10');                       // VAT 150.00 على الحساب المخالف
        $valid = $this->account('2125', 'liability');
        $this->map('tax_output', $valid);                   // التصحيح بحساب صالح
        $this->invoice('2026-02-10');                       // VAT 150.00 على الحساب الصالح

        $jan = $this->tax(['from' => '2026-01-01', 'to' => '2026-01-31']);
        $this->assertSame('unverified', $jan['verification']['status']);
        $this->assertFalse($jan['verification']['verified']);
        $this->assertGreaterThan(0, $jan['verification']['issues']);
        $this->assertTrue(collect($jan['warnings'])->firstWhere('code', 'vat_account_type_mismatch')['affects_totals']);

        // شباط: الحساب المخالف بلا حركة ⇒ أرقام الفترة غير ملوّثة، لكن التحذير لا يُخفى ولا يُقدَّم «موثَّقاً» نظيفاً.
        $feb = $this->tax(['from' => '2026-02-01', 'to' => '2026-02-28']);
        $this->assertSame(15000, $feb['output_vat']);
        $this->assertSame('verified_with_notices', $feb['verification']['status']);
        $this->assertFalse($feb['verification']['verified']);                 // المنطقي محافظ: true لا يكون إلا بلا أي تحذير
        $this->assertSame(0, $feb['verification']['issues']);
        $this->assertGreaterThan(0, $feb['verification']['notices']);
        // «مع ملاحظات» لا يوحي بجاهزية الإقرار ولا بمطابقة الدفاتر: ما لم يُفحص يُعلن في كل حالة.
        foreach (['vat_return_filing', 'invoice_to_ledger_reconciliation', 'zatca_clearance'] as $notChecked) {
            $this->assertContains($notChecked, $feb['verification']['not_checked']);
        }
        $mismatch = collect($feb['warnings'])->firstWhere('code', 'vat_account_type_mismatch');
        $this->assertNotNull($mismatch);
        $this->assertFalse($mismatch['affects_totals']);
        $this->assertSame('notice', collect($feb['verification']['checks'])->firstWhere('code', 'vat_account_type_mismatch')['result']);

        // كل الزمن يشمل حركة الحساب المخالف ⇒ غير موثَّق.
        $all = $this->tax();
        $this->assertSame(30000, $all['output_vat']);
        $this->assertSame('unverified', $all['verification']['status']);
    }

    /** @test */
    public function a_historical_role_overlap_is_a_notice_without_movement_and_a_failure_with_movement(): void
    {
        $shared = $this->account('2125', 'liability');
        $this->legacyMap('tax_input', $shared);                                   // دخل تاريخ المدخلات
        AccountRoleMapping::where('role_key', 'tax_input')->update(['account_id' => $this->byCode('1150')->id]);
        $this->legacyMap('tax_output', $shared);                                  // ويُعيَّن الآن للمخرجات ⇒ تداخل تاريخي
        $this->invoice('2026-02-10');                                             // VAT على الحساب المشترك

        $jan = $this->tax(['from' => '2026-01-01', 'to' => '2026-01-31']);
        $this->assertContains('vat_role_accounts_overlap', $this->codes($jan));
        $this->assertSame('verified_with_notices', $jan['verification']['status']);
        $this->assertFalse(collect($jan['warnings'])->firstWhere('code', 'vat_role_accounts_overlap')['affects_totals']);

        $feb = $this->tax(['from' => '2026-02-01', 'to' => '2026-02-28']);
        $this->assertSame('unverified', $feb['verification']['status']);
        $this->assertTrue(collect($feb['warnings'])->firstWhere('code', 'vat_role_accounts_overlap')['affects_totals']);
        $this->assertSame(15000, $feb['output_vat']);                             // يُنسب بنوعه (التزام ⇒ مخرجات)، لا ازدواج
        $this->assertSame(0, $feb['input_vat']);
    }

    // ───────────── 3b-2. أثر النطاق: حدود التواريخ، العكس، التداخل التاريخي، الفروع، المستأجرون ─────────────

    /** يرحّل سطر «ضريبة» على الحساب المعطوب (بديل عن فاتورة) بتاريخ وفرع محدَّدين. */
    private function vatLine(Account $account, int $amount, string $date, ?string $branchId = null): JournalEntry
    {
        return app(LedgerService::class)->post([
            ['account_id' => $this->byCode('1130')->id, 'debit' => $amount],
            ['account_id' => $account->id, 'credit' => $amount],
        ], ['entry_date' => $date, 'branch_id' => $branchId]);
    }

    private function statusFor(array $filters): string
    {
        return $this->tax($filters)['verification']['status'];
    }

    /** @test */
    public function period_boundaries_are_inclusive_and_any_movement_in_scope_keeps_the_figures_unverified(): void
    {
        $legacy = $this->account('4999', 'revenue');
        $this->legacyMap('tax_output', $legacy);
        $this->vatLine($legacy, 15000, '2026-02-15');
        $this->vatLine($legacy, 5000, '2026-01-31');

        $this->assertSame('unverified', $this->statusFor(['from' => '2026-02-15', 'to' => '2026-02-15']));   // يوم واحد = يوم الحركة
        $this->assertSame('unverified', $this->statusFor(['from' => '2026-02-15', 'to' => '2026-02-28']));   // الحد الأدنى مشمول
        $this->assertSame('unverified', $this->statusFor(['from' => '2026-02-01', 'to' => '2026-02-15']));   // الحد الأعلى مشمول
        $this->assertSame('verified_with_notices', $this->statusFor(['from' => '2026-02-16', 'to' => '2026-02-28']));
        $this->assertSame('verified_with_notices', $this->statusFor(['from' => '2026-02-01', 'to' => '2026-02-14']));

        // الحدّ بين شهرين: حركة 31 كانون الثاني ملوِّثة لكانون الثاني فقط.
        $this->assertSame('unverified', $this->statusFor(['from' => '2026-01-01', 'to' => '2026-01-31']));
        $this->assertSame('unverified', $this->statusFor(['from' => '2026-01-31', 'to' => '2026-01-31']));
        $this->assertSame('verified_with_notices', $this->statusFor(['from' => '2026-02-01', 'to' => '2026-02-14']));

        // بلا مرشّح (كل الزمن) = كل الحركات ⇒ غير موثَّق.
        $this->assertSame('unverified', $this->statusFor([]));
        $this->balanced();
    }

    /** @test */
    public function a_reversed_movement_still_counts_as_movement_in_both_the_original_and_the_reversal_period(): void
    {
        $legacy = $this->account('4999', 'revenue');
        $this->legacyMap('tax_output', $legacy);
        $entry = $this->vatLine($legacy, 15000, '2026-01-10');
        app(LedgerService::class)->reverse($entry, '2026-02-05', 'عكس');

        // صافي كل الزمن صفر، لكن الحساب تحرّك: لا يُعدّ «نظيفاً» لمجرد التصفية.
        $all = $this->tax();
        $this->assertSame(0, $all['output_vat']);
        $this->assertSame('unverified', $all['verification']['status']);

        $this->assertSame('unverified', $this->statusFor(['from' => '2026-01-01', 'to' => '2026-01-31']));     // الأصل
        $feb = $this->tax(['from' => '2026-02-01', 'to' => '2026-02-28']);                                   // العكس وحده
        $this->assertSame('unverified', $feb['verification']['status']);
        $this->assertSame(-15000, $feb['output_vat']);
        $this->assertSame('verified_with_notices', $this->statusFor(['from' => '2026-03-01', 'to' => '2026-03-31']));
    }

    /** @test */
    public function a_historical_overlap_respects_the_same_inclusive_boundaries(): void
    {
        $shared = $this->account('2125', 'liability');
        $this->legacyMap('tax_input', $shared);
        AccountRoleMapping::where('role_key', 'tax_input')->update(['account_id' => $this->byCode('1150')->id]);
        $this->legacyMap('tax_output', $shared);
        $this->vatLine($shared, 15000, '2026-02-10');

        $this->assertSame('unverified', $this->statusFor(['from' => '2026-02-10', 'to' => '2026-02-10']));
        $this->assertSame('verified_with_notices', $this->statusFor(['from' => '2026-02-11', 'to' => '2026-02-28']));
        $this->assertSame('verified_with_notices', $this->statusFor(['from' => '2026-01-01', 'to' => '2026-02-09']));
        $this->assertSame('unverified', $this->statusFor([]));
    }

    /** @test */
    public function the_branch_filter_decides_whether_a_contaminated_account_moved_in_scope(): void
    {
        $branchA = Branch::create(['code' => '00002', 'name' => 'فرع أ', 'is_main' => false]);
        $branchB = Branch::create(['code' => '00003', 'name' => 'فرع ب', 'is_main' => false]);
        $legacy = $this->account('4999', 'revenue');
        $this->legacyMap('tax_output', $legacy);
        $this->vatLine($legacy, 15000, '2026-02-10', $branchA->id);
        $this->vatLine($legacy, 5000, '2026-02-11', null);                         // غير موزَّع على فرع

        $this->assertSame('unverified', $this->statusFor(['branch_id' => [$branchA->id]]));
        $this->assertSame('verified_with_notices', $this->statusFor(['branch_id' => [$branchB->id]]));   // لا حركة للفرع ب
        $this->assertSame('unverified', $this->statusFor([]));                                          // كل الفروع تشمل الحركتين
        $b = $this->tax(['branch_id' => [$branchB->id]]);
        $this->assertSame(0, $b['output_vat']);
        $this->assertFalse($b['verification']['verified']);                                              // لا «موثَّق» نظيف
    }

    /** @test */
    public function verification_and_warnings_never_cross_tenants(): void
    {
        $legacy = $this->account('4999', 'revenue');
        $this->legacyMap('tax_output', $legacy);
        $this->vatLine($legacy, 15000, '2026-02-10');
        $this->assertSame('unverified', $this->statusFor([]));

        // مستأجر ب نظيف: لا يرث تحذيرات أ ولا حركاتها، ولو كان بالفترة نفسها.
        $other = $this->registerTenant('vat-clean', 'owner@vat-clean.test');
        app(TenantContext::class)->set($other['tenant_id']);
        $clean = $this->tax(['from' => '2026-02-01', 'to' => '2026-02-28']);
        $this->assertSame('verified', $clean['verification']['status']);
        $this->assertSame([], $clean['warnings']);
        $this->assertSame([], $clean['disclosures']);

        // ولوثةُ ب لا تنعكس على أ.
        $dirty = Account::create([
            'tenant_id' => $other['tenant_id'], 'code' => '4998', 'name' => 'ب', 'type' => 'revenue',
            'normal_balance' => 'credit', 'is_group' => false, 'is_active' => true,
        ]);
        AccountRoleMapping::where('role_key', 'tax_output')->update(['account_id' => $dirty->id]);
        $this->assertSame('verified_with_notices', $this->statusFor([]));   // نوع خاطئ بلا حركة في ب ⇒ ملاحظة فقط، مستقلة عن حركة أ
        app(TenantContext::class)->set($this->tenantId);
        $a = $this->tax(['from' => '2026-02-01', 'to' => '2026-02-28']);
        $this->assertSame('unverified', $a['verification']['status']);
        $this->assertSame(15000, $a['output_vat']);
        $this->assertSame(['4999'], collect($a['warnings'])->pluck('account_code')->unique()->values()->all());
    }

    // ───────────── 3c. إفصاح فرق سطر الإقفال المالي ─────────────

    /** @test */
    public function the_report_discloses_the_fiscal_close_vat_line_difference_with_the_same_numbers_the_close_shows(): void
    {
        $this->assertSame([], $this->tax()['disclosures']);                       // مستأجر افتراضي: لا فرق

        $out = $this->account('2125', 'liability');
        $in = $this->account('1158', 'asset');
        $this->invoice('2026-01-10'); $this->purchase('2026-01-11', 50000);       // 2120: 150.00 · 1150: 75.00
        $this->map('tax_output', $out); $this->map('tax_input', $in);
        $this->invoice('2026-02-10'); $this->purchase('2026-02-11', 50000);       // 2125: 150.00 · 1158: 75.00

        // التقرير في فترة لا تحوي الحركات لا يغيّر الإفصاح: يُقاس كما يقيس الإقفال (كل الزمن).
        $disclosures = collect($this->tax(['from' => '2026-03-01', 'to' => '2026-03-31'])['disclosures'])->keyBy('role_key');
        $this->assertSame(['tax_input', 'tax_output'], $disclosures->keys()->sort()->values()->all());
        $o = $disclosures['tax_output'];
        $this->assertSame('fiscal_close_vat_control_differs', $o['code']);
        $this->assertSame('2125', $o['current_account_code']);
        $this->assertSame([15000, 30000, 15000], [$o['current_balance'], $o['set_balance'], $o['difference']]);
        $this->assertSame([7500, 15000, 7500], [$disclosures['tax_input']['current_balance'], $disclosures['tax_input']['set_balance'], $disclosures['tax_input']['difference']]);

        // نفس رقم الإقفال حرفياً (FiscalCloseService غير معدَّل).
        $year = FiscalYear::findOrFail(app(FiscalYearService::class)->create(
            ['name' => '2026', 'start_date' => '2026-01-01', 'end_date' => '2026-12-31'], null
        )['id']);
        $vat = collect(app(FiscalCloseService::class)->readiness($year)['info'])->firstWhere('code', 'vat_balances');
        $this->assertSame($vat['details']['tax_output'], $o['current_balance']);
        $this->assertSame($vat['details']['tax_input'], $disclosures['tax_input']['current_balance']);

        // العقد عبر الـAPI: مبالغ بالريال، وتوثيق الأرقام يبقى مستقلاً عن الإفصاح.
        $res = $this->withToken($this->token)->getJson('/api/reports/tax-report')->assertOk();
        $res->assertJsonPath('output_vat', '300.00')
            ->assertJsonPath('verification.status', 'verified')
            ->assertJsonPath('disclosures.0.code', 'fiscal_close_vat_control_differs');
        $apiOut = collect($res->json('disclosures'))->firstWhere('role_key', 'tax_output');
        $this->assertSame(['150.00', '300.00', '150.00'], [$apiOut['current_balance'], $apiOut['set_balance'], $apiOut['difference']]);
        $this->balanced();
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
