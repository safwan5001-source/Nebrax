<?php

namespace Tests\Feature;

use App\Models\Account;
use App\Models\Partner;
use App\Models\Product;
use App\Models\Tenant;
use App\Services\Accounting\ChartOfAccountsSeeder;
use App\Services\Accounting\InvoiceService;
use App\Services\Accounting\LedgerService;
use App\Services\Accounting\PaymentService;
use App\Services\Accounting\PurchaseService;
use App\Services\ApiClientKeyService;
use App\Services\Reporting\ReportService;
use App\Services\TenantApplicationService;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\Attributes\Test;
use Tests\TestCase;

/**
 * AIA-0.1 — الغلاف المالي لـ `GET /api/v1/partners/{id}/statement` على قيود حقيقية (يعمل على SQLite وPostgreSQL).
 *
 * القيم 586086/608511/705403 هي المُبلَّغة من باشت (غير متحقَّق منها من الإنتاج)؛ تُستعمل هنا كبيانات اصطناعية فقط.
 */
class PublicApiPartnerStatementIntegrityTest extends TestCase
{
    use RefreshDatabase;

    /** مفاتيح الحقول القديمة في `data` — يجب ألا يتغيّر أيٌّ منها. */
    private const LEGACY_KEYS = ['partner', 'currency', 'from', 'to', 'opening_balance_minor', 'rows', 'closing_balance_minor'];

    /** الحقول الإضافية (AIA-0.1) وحدها. */
    private const ENVELOPE_KEYS = ['role', 'row_count', 'totals', 'balance_convention', 'position', 'display', 'minor_unit_exponent', 'integrity', 'report_status'];

    private Tenant $tenant;

    protected function setUp(): void
    {
        parent::setUp();
        $this->tenant = $this->makeTenant('acme', 'SAR');
    }

    private function makeTenant(string $slug, string $currency): Tenant
    {
        $tenant = Tenant::create(['name' => $slug, 'slug' => $slug, 'vat_number' => '300000000000003', 'currency' => $currency]);
        app(TenantContext::class)->set($tenant->id);
        app(ChartOfAccountsSeeder::class)->seed($tenant->id);
        app(TenantApplicationService::class)->enable('purchases.cycle', null);

        return $tenant;
    }

    private function key(Tenant $tenant, array $scopes = ['statements:read']): string
    {
        // انظر PublicApiPartnerStatementTest::key — نعيد الحارس الإنتاجي قبل نداء الـ Public.
        $this->app['auth']->shouldUse('web');
        $this->app['auth']->forgetGuards();

        $service = app(ApiClientKeyService::class);
        $client = $service->createClient($tenant, 'agent');

        return $service->issueKey($client, 'k', $scopes)->plainTextToken;
    }

    private function statement(Partner $partner, string $query = '', ?Tenant $tenant = null, array $scopes = ['statements:read'])
    {
        $token = $this->key($tenant ?? $this->tenant, $scopes);

        return $this->withToken($token)->getJson("/api/v1/partners/{$partner->id}/statement".$query);
    }

    /** شراء آجل بإجمالي مطابق للمبلغ تماماً (بلا ضريبة) ثم يُرحَّل. */
    private function purchase(Partner $partner, int $total, string $date)
    {
        $svc = app(PurchaseService::class);
        $product = Product::first() ?? Product::create(['name' => 'خدمة', 'sale_price' => 100, 'track_inventory' => false]);

        return $svc->post($svc->create(
            ['partner_id' => $partner->id, 'payment_type' => 'credit', 'purchase_date' => $date],
            [['product_id' => $product->id, 'quantity' => 1, 'unit_price' => $total, 'tax_rate' => 0]],
        ));
    }

    private function pay(Partner $partner, int $amount, string $date, $purchase)
    {
        $svc = app(PaymentService::class);

        return $svc->post($svc->create(
            ['partner_id' => $partner->id, 'direction' => 'paid', 'amount' => $amount, 'payment_date' => $date],
            [['purchase_id' => $purchase->id, 'amount' => $amount]],
        ));
    }

    private function invoice(Partner $partner, int $unitPrice, string $date)
    {
        $svc = app(InvoiceService::class);

        return $svc->post($svc->create(
            ['partner_id' => $partner->id, 'payment_type' => 'credit', 'invoice_date' => $date],
            [['quantity' => 1, 'unit_price' => $unitPrice, 'tax_rate' => 15]],
        ));
    }

    private function receive(Partner $partner, int $amount, string $date, $invoice)
    {
        $svc = app(PaymentService::class);

        return $svc->post($svc->create(
            ['partner_id' => $partner->id, 'direction' => 'received', 'amount' => $amount, 'payment_date' => $date, 'invoice_id' => $invoice->id],
            [['invoice_id' => $invoice->id, 'amount' => $amount]],
        ));
    }

    /** مورد: شراء 115000 ثم دفع 50000 ⇒ نحن مدينون بـ650.00. */
    private function supplierWeOwe(): Partner
    {
        $supplier = Partner::create(['name' => 'مورد مستحق', 'type' => 'supplier']);
        $purchase = $this->purchase($supplier, 115000, '2026-03-01');
        $this->pay($supplier, 50000, '2026-03-05', $purchase);

        return $supplier;
    }

    // ── كشف المورد ───────────────────────────────────────────────────

    #[Test]
    public function supplier_statement_exposes_totals_direction_and_ready_display(): void
    {
        $supplier = $this->supplierWeOwe();

        $this->statement($supplier)->assertOk()
            ->assertJsonPath('data.report_status', 'final')
            ->assertJsonPath('data.integrity.status', 'verified')
            ->assertJsonPath('data.minor_unit_exponent', 2)
            ->assertJsonPath('data.role', null)
            ->assertJsonPath('data.row_count', 2)
            ->assertJsonPath('data.totals', ['row_count' => 2, 'debit_minor' => 50000, 'credit_minor' => 115000, 'net_minor' => -65000])
            ->assertJsonPath('data.opening_balance_minor', 0)
            ->assertJsonPath('data.closing_balance_minor', -65000)
            ->assertJsonPath('data.position.closing', ['side' => 'payable', 'amount_minor' => 65000, 'opposite_sign' => false])
            ->assertJsonPath('data.display.closing', '650.00')
            ->assertJsonPath('data.display.closing_side', 'payable')
            ->assertJsonPath('data.display.net', '-650.00')
            ->assertJsonPath('data.display.debit', '500.00')
            ->assertJsonPath('data.display.credit', '1150.00')
            ->assertJsonPath('data.balance_convention.negative_means', 'we_owe_partner');
    }

    #[Test]
    public function the_reported_baseline_reconciles_for_a_supplier_with_role_supplier(): void
    {
        // ست حركات: ثلاث مشتريات وثلاث دفعات بالقيم المُبلَّغة؛ المدين = الدائن = 1,900,000 هللة = 19,000.00.
        $supplier = Partner::create(['name' => 'شركة نجم المناجم (اصطناعي)', 'type' => 'supplier']);
        foreach ([[586086, '2026-02-01', '2026-02-10'], [608511, '2026-04-01', '2026-04-10'], [705403, '2026-06-01', '2026-06-10']] as [$amount, $buy, $pay]) {
            $this->pay($supplier, $amount, $pay, $this->purchase($supplier, $amount, $buy));
        }

        foreach (['?role=supplier&from=2026-01-01&to=2026-11-06', ''] as $query) {
            $this->statement($supplier, $query)->assertOk()
                ->assertJsonPath('data.row_count', 6)
                ->assertJsonPath('data.totals.debit_minor', 1900000)
                ->assertJsonPath('data.totals.credit_minor', 1900000)
                ->assertJsonPath('data.totals.net_minor', 0)
                ->assertJsonPath('data.opening_balance_minor', 0)
                ->assertJsonPath('data.closing_balance_minor', 0)
                ->assertJsonPath('data.display.debit', '19000.00')
                ->assertJsonPath('data.display.credit', '19000.00')
                ->assertJsonPath('data.display.closing', '0.00')
                ->assertJsonPath('data.position.closing.side', 'settled')
                ->assertJsonPath('data.report_status', 'final');
        }
    }

    #[Test]
    public function an_overpaid_supplier_is_receivable_with_the_opposite_sign_flag(): void
    {
        $supplier = Partner::create(['name' => 'مورد دفعنا له أكثر', 'type' => 'supplier']);
        $purchase = $this->purchase($supplier, 10000, '2026-03-01');
        $this->pay($supplier, 10000, '2026-03-02', $purchase);
        // دفعة زائدة بقيد يدوي موسوم بالمورد: مدين المورد 2110 (يزيد رصيدنا لديه).
        $this->manualEntry($supplier, 4000, 0, '2026-03-03');

        $this->statement($supplier)->assertOk()
            ->assertJsonPath('data.closing_balance_minor', 4000)
            ->assertJsonPath('data.position.closing', ['side' => 'receivable', 'amount_minor' => 4000, 'opposite_sign' => true])
            ->assertJsonPath('data.display.closing_side', 'receivable')
            ->assertJsonPath('data.report_status', 'final');
    }

    // ── كشف العميل ───────────────────────────────────────────────────

    #[Test]
    public function customer_statement_is_receivable_and_a_credit_customer_is_flagged(): void
    {
        $customer = Partner::create(['name' => 'عميل', 'type' => 'customer']);
        $invoice = $this->invoice($customer, 100000, '2026-03-01');

        $this->statement($customer)->assertOk()
            ->assertJsonPath('data.totals.debit_minor', 115000)
            ->assertJsonPath('data.position.closing', ['side' => 'receivable', 'amount_minor' => 115000, 'opposite_sign' => false])
            ->assertJsonPath('data.display.closing', '1150.00');

        $this->receive($customer, 115000, '2026-03-02', $invoice);
        $this->manualEntry($customer, 0, 2500, '2026-03-03'); // دفعة زائدة ⇒ العميل دائن

        $this->statement($customer)->assertOk()
            ->assertJsonPath('data.closing_balance_minor', -2500)
            ->assertJsonPath('data.position.closing', ['side' => 'payable', 'amount_minor' => 2500, 'opposite_sign' => true])
            ->assertJsonPath('data.display.closing', '25.00')
            ->assertJsonPath('data.display.closing_side', 'payable');
    }

    // ── طرف من النوع both ────────────────────────────────────────────

    #[Test]
    public function a_dual_role_partner_is_partitioned_by_role_without_leakage(): void
    {
        $both = Partner::create(['name' => 'طرف مزدوج', 'type' => 'both']);
        $this->invoice($both, 100000, '2026-03-01');                    // عميل: +115000
        $this->purchase($both, 40000, '2026-03-02');                    // مورد: −40000

        $all = $this->statement($both)->assertOk()
            ->assertJsonPath('data.role', null)
            ->assertJsonPath('data.closing_balance_minor', 75000)
            ->assertJsonPath('data.position.closing.opposite_sign', false);

        $customer = $this->statement($both, '?role=customer')->assertOk()
            ->assertJsonPath('data.role', 'customer')
            ->assertJsonPath('data.totals', ['row_count' => 1, 'debit_minor' => 115000, 'credit_minor' => 0, 'net_minor' => 115000])
            ->assertJsonPath('data.position.closing.side', 'receivable')
            ->assertJsonPath('data.report_status', 'final');

        $supplier = $this->statement($both, '?role=supplier')->assertOk()
            ->assertJsonPath('data.role', 'supplier')
            ->assertJsonPath('data.totals', ['row_count' => 1, 'debit_minor' => 0, 'credit_minor' => 40000, 'net_minor' => -40000])
            ->assertJsonPath('data.position.closing', ['side' => 'payable', 'amount_minor' => 40000, 'opposite_sign' => false])
            ->assertJsonPath('data.report_status', 'final');

        // صافي الدورين معاً = صافي الكشف غير المقيَّد.
        $this->assertSame(
            $all->json('data.totals.net_minor'),
            $customer->json('data.totals.net_minor') + $supplier->json('data.totals.net_minor')
        );
        $this->assertSame($all->json('data.row_count'), $customer->json('data.row_count') + $supplier->json('data.row_count'));
    }

    // ── الأرصدة الافتتاحية والختامية والفترات ────────────────────────

    #[Test]
    public function a_non_zero_opening_balance_reconciles_with_the_period_movement(): void
    {
        $supplier = $this->supplierWeOwe(); // قبل 2026-04-01: صافي −65000
        $purchase = $this->purchase($supplier, 20000, '2026-04-10');
        $this->pay($supplier, 5000, '2026-04-12', $purchase);

        $this->statement($supplier, '?from=2026-04-01')->assertOk()
            ->assertJsonPath('data.opening_balance_minor', -65000)
            ->assertJsonPath('data.row_count', 2)
            ->assertJsonPath('data.totals', ['row_count' => 2, 'debit_minor' => 5000, 'credit_minor' => 20000, 'net_minor' => -15000])
            ->assertJsonPath('data.closing_balance_minor', -80000)
            ->assertJsonPath('data.position.opening', ['side' => 'payable', 'amount_minor' => 65000, 'opposite_sign' => false])
            ->assertJsonPath('data.display.opening', '650.00')
            ->assertJsonPath('data.display.opening_side', 'payable')
            ->assertJsonPath('data.display.closing', '800.00')
            ->assertJsonPath('data.report_status', 'final');
    }

    #[Test]
    public function the_to_filter_excludes_later_movements_from_rows_totals_and_closing(): void
    {
        $supplier = $this->supplierWeOwe();
        $this->purchase($supplier, 99999, '2026-09-01');

        $this->statement($supplier, '?to=2026-06-30')->assertOk()
            ->assertJsonPath('data.row_count', 2)
            ->assertJsonPath('data.totals.credit_minor', 115000)
            ->assertJsonPath('data.closing_balance_minor', -65000)
            ->assertJsonPath('data.display.closing', '650.00');
    }

    #[Test]
    public function a_statement_with_no_movements_is_final_and_settled(): void
    {
        $partner = Partner::create(['name' => 'بلا حركة', 'type' => 'supplier']);

        $this->statement($partner)->assertOk()
            ->assertJsonPath('data.row_count', 0)
            ->assertJsonCount(0, 'data.rows')
            ->assertJsonPath('data.totals', ['row_count' => 0, 'debit_minor' => 0, 'credit_minor' => 0, 'net_minor' => 0])
            ->assertJsonPath('data.position.closing.side', 'settled')
            ->assertJsonPath('data.display.closing', '0.00')
            ->assertJsonPath('data.report_status', 'final');
    }

    // ── التوافق الخلفي ───────────────────────────────────────────────

    #[Test]
    public function the_legacy_fields_are_unchanged_and_the_envelope_is_purely_additive(): void
    {
        $supplier = $this->supplierWeOwe();
        $data = $this->statement($supplier)->assertOk()->json('data');

        $this->assertSame([...self::LEGACY_KEYS, ...self::ENVELOPE_KEYS], array_keys($data), 'القديم أولاً بترتيبه ثم الإضافي فقط.');

        // الحقول القديمة تساوي حرفياً ما يعيده التقرير الداخلي القائم، بلا قلب إشارة للمورد.
        $report = app(ReportService::class)->partnerStatement($supplier->id);
        $this->assertSame($report['opening_balance'], $data['opening_balance_minor']);
        $this->assertSame($report['closing_balance'], $data['closing_balance_minor']);
        $this->assertSame(-65000, $data['closing_balance_minor'], 'رصيد المورد يبقى مدين − دائن (سالب).');
        $this->assertSame('SAR', $data['currency']);
        $this->assertNull($data['from']);
        $this->assertNull($data['to']);
        $this->assertSame(['id' => $supplier->id, 'name' => 'مورد مستحق', 'type' => 'supplier'], $data['partner']);

        foreach ($data['rows'] as $i => $row) {
            $this->assertSame(['date', 'number', 'description', 'debit_minor', 'credit_minor', 'balance_minor', 'source'], array_keys($row));
            $this->assertSame($report['rows'][$i]['debit'], $row['debit_minor']);
            $this->assertSame($report['rows'][$i]['credit'], $row['credit_minor']);
            $this->assertSame($report['rows'][$i]['balance'], $row['balance_minor']);
            $this->assertIsInt($row['debit_minor']);
        }
    }

    // ── السقف 2000 ───────────────────────────────────────────────────

    private function fakeStatement(int $rowCount): void
    {
        $rows = [];
        for ($i = 1; $i <= $rowCount; $i++) {
            $rows[] = ['date' => '2026-03-10', 'number' => 'X'.$i, 'description' => null, 'debit' => 1, 'credit' => 0, 'balance' => $i, 'source' => null];
        }
        $fake = \Mockery::mock(ReportService::class);
        $fake->shouldReceive('partnerStatement')->once()->andReturn([
            'partner' => ['id' => 'p', 'name' => 'x', 'type' => 'customer'],
            'opening_balance' => 0, 'rows' => $rows, 'closing_balance' => $rowCount,
        ]);
        $this->app->instance(ReportService::class, $fake);
    }

    #[Test]
    public function exactly_2000_movements_pass_and_2001_are_refused_without_partial_data(): void
    {
        $partner = Partner::create(['name' => 'كثير الحركات', 'type' => 'customer']);

        $this->fakeStatement(2000);
        $this->statement($partner)->assertOk()
            ->assertJsonPath('data.row_count', 2000)
            ->assertJsonPath('data.totals.debit_minor', 2000)
            ->assertJsonPath('data.report_status', 'final')
            ->assertJsonPath('data.integrity.status', 'verified');

        $this->fakeStatement(2001);
        $this->statement($partner)->assertStatus(422)
            ->assertJsonMissingPath('data')
            ->assertJsonMissingPath('data.report_status');
    }

    // ── الفشل المغلق (حقن بيانات غير متطابقة) ────────────────────────

    public static function corruptions(): array
    {
        return [
            'broken chain'        => [fn (array $s) => tap($s, fn (&$x) => $x['rows'][1]['balance'] = 999), 'running_balance_chain'],
            'closing mismatch'    => [fn (array $s) => tap($s, fn (&$x) => $x['closing_balance'] = 7), 'closing_equals_opening_plus_net'],
            'float amount'        => [fn (array $s) => tap($s, fn (&$x) => $x['rows'][0]['debit'] = 100.0), 'minor_units_are_integers'],
            'numeric string'      => [fn (array $s) => tap($s, fn (&$x) => $x['rows'][0]['credit'] = '0'), 'minor_units_are_integers'],
            'unsafe totals'       => [fn (array $s) => tap($s, function (&$x) {
                $big = 4503599627370496; // 2^52: كل حركة والرصيد الجاري آمنان، وإجمالي كل جانب 3×2^52 > 2^53−1
                $rows = [];
                for ($i = 0; $i < 3; $i++) {
                    $rows[] = ['date' => '2026-03-10', 'number' => 'D'.$i, 'description' => null, 'debit' => $big, 'credit' => 0, 'balance' => $big, 'source' => null];
                    $rows[] = ['date' => '2026-03-10', 'number' => 'C'.$i, 'description' => null, 'debit' => 0, 'credit' => $big, 'balance' => 0, 'source' => null];
                }
                $x['rows'] = $rows;
                $x['closing_balance'] = 0;
            }), 'computed_values_within_safe_range'],
            'beyond safe range'   => [fn (array $s) => tap($s, function (&$x) {
                $big = 9007199254740993;
                $x['rows'] = [['date' => '2026-03-10', 'number' => 'B', 'description' => null, 'debit' => $big, 'credit' => 0, 'balance' => $big, 'source' => null]];
                $x['closing_balance'] = $big;
            }), 'minor_units_are_integers'],
        ];
    }

    private function injected(callable $corrupt): void
    {
        $base = [
            'partner' => ['id' => 'p', 'name' => 'x', 'type' => 'customer'],
            'opening_balance' => 0,
            'rows' => [
                ['date' => '2026-03-10', 'number' => 'A', 'description' => null, 'debit' => 100, 'credit' => 0, 'balance' => 100, 'source' => null],
                ['date' => '2026-03-11', 'number' => 'B', 'description' => null, 'debit' => 0, 'credit' => 30, 'balance' => 70, 'source' => null],
            ],
            'closing_balance' => 70,
        ];
        $fake = \Mockery::mock(ReportService::class);
        $fake->shouldReceive('partnerStatement')->once()->andReturn($corrupt($base));
        $this->app->instance(ReportService::class, $fake);
    }

    #[Test]
    #[DataProvider('corruptions')]
    public function inconsistent_data_is_never_reported_as_final(callable $corrupt, string $failedCheck): void
    {
        $partner = Partner::create(['name' => 'حقن', 'type' => 'customer']);
        $this->injected($corrupt);

        $response = $this->statement($partner)->assertOk()
            ->assertJsonPath('data.report_status', 'unverified')
            ->assertJsonPath('data.integrity.status', 'failed')
            ->assertJsonPath('data.display', null)
            ->assertJsonPath('data.position', null);

        // السبب الجذري يظهر دائماً. فشل سلامة الأعداد الصحيحة يُسقط تبعاً الفحوص التي لا يمكن تقييمها بدونه.
        $this->assertContains($failedCheck, $response->json('data.integrity.failed_checks'));
        if (in_array($failedCheck, ['running_balance_chain', 'closing_equals_opening_plus_net'], true)) {
            $this->assertSame([$failedCheck], $response->json('data.integrity.failed_checks'), 'خلل واحد ⇒ فحص واحد فاشل.');
        }
        if ($failedCheck === 'computed_values_within_safe_range') {
            // الإجماليات غير قابلة للحساب الآمن فلا يمكن التحقق من الختامي = الافتتاحي + الصافي، لكن السلسلة سليمة وكل مُدخَل آمن.
            $this->assertSame(['computed_values_within_safe_range', 'closing_equals_opening_plus_net'], $response->json('data.integrity.failed_checks'));
        }
        $this->assertNotSame('final', $response->json('data.report_status'));
        // عند عجز الجمع لا إجماليات جزئية: كل المجاميع null لا صفر مضلّل.
        if (in_array($failedCheck, ['computed_values_within_safe_range', 'minor_units_are_integers'], true)) {
            foreach (['debit_minor', 'credit_minor', 'net_minor'] as $key) {
                $this->assertNull($response->json('data.totals.'.$key), $key);
            }
        }
    }

    #[Test]
    #[DataProvider('corruptions')]
    public function with_the_reject_flag_on_an_integrity_failure_returns_no_statement_data(callable $corrupt): void
    {
        config(['public_api.statement_reject_on_integrity_failure' => true]);
        $partner = Partner::create(['name' => 'حقن', 'type' => 'customer']);
        $this->injected($corrupt);

        $this->statement($partner)->assertStatus(500)
            ->assertJsonPath('error.details.reason', 'report_integrity_failed')
            ->assertJsonMissingPath('data')
            ->assertJsonMissingPath('error.details.failed_checks');
    }

    // ── العملات (D-12 الخيار C) ──────────────────────────────────────

    public static function foreignCurrencies(): array
    {
        return [['KWD'], ['JPY'], ['USD'], ['XYZ']];
    }

    #[Test]
    #[DataProvider('foreignCurrencies')]
    public function a_non_sar_tenant_gets_unsupported_with_raw_legacy_values_and_no_display(string $currency): void
    {
        // CUR-1 يحرس `PUT /company` فقط؛ نضبط العمود مباشرة لمحاكاة مستأجر قائم بعملة أخرى.
        Tenant::query()->whereKey($this->tenant->id)->update(['currency' => $currency]);
        $supplier = $this->supplierWeOwe();

        $this->statement($supplier)->assertOk()
            ->assertJsonPath('data.currency', $currency)
            ->assertJsonPath('data.closing_balance_minor', -65000)
            ->assertJsonPath('data.opening_balance_minor', 0)
            ->assertJsonPath('data.rows.0.credit_minor', 115000)
            ->assertJsonPath('data.report_status', 'unsupported')
            ->assertJsonPath('data.integrity.status', 'unsupported')
            ->assertJsonPath('data.integrity.reason', 'currency_exponent_unsupported')
            ->assertJsonPath('data.minor_unit_exponent', null)
            ->assertJsonPath('data.display', null)
            ->assertJsonPath('data.position', null)
            ->assertJsonPath('data.totals.net_minor', -65000);
    }

    #[Test]
    public function a_lowercase_sar_tenant_is_supported_and_the_stored_code_is_kept_in_the_legacy_field(): void
    {
        Tenant::query()->whereKey($this->tenant->id)->update(['currency' => 'sar']);
        $supplier = $this->supplierWeOwe();

        $this->statement($supplier)->assertOk()
            ->assertJsonPath('data.currency', 'sar')
            ->assertJsonPath('data.display.currency', 'SAR')
            ->assertJsonPath('data.report_status', 'final');
    }

    // ── العزل والصلاحيات ─────────────────────────────────────────────

    #[Test]
    public function tenant_isolation_holds_for_statements_and_totals(): void
    {
        $mine = $this->supplierWeOwe();                       // مستأجر acme: −65000
        $other = $this->makeTenant('beta', 'SAR');
        $theirs = Partner::create(['name' => 'مورد beta', 'type' => 'supplier']);
        $this->pay($theirs, 777, '2026-03-02', $this->purchase($theirs, 777, '2026-03-01'));

        // مفتاح beta لا يرى طرف acme: 404 بلا أي بيانات.
        $this->statement($mine, '', $other)->assertStatus(404)->assertJsonMissingPath('data');

        // وكل مستأجر يرى إجمالياته هو فقط.
        $this->statement($theirs, '', $other)->assertOk()
            ->assertJsonPath('data.totals.credit_minor', 777)
            ->assertJsonPath('data.closing_balance_minor', 0);

        app(TenantContext::class)->set($this->tenant->id);
        $this->statement($mine, '', $this->tenant)->assertOk()->assertJsonPath('data.totals.credit_minor', 115000);
    }

    #[Test]
    public function a_key_without_statements_read_is_rejected_before_any_envelope_work(): void
    {
        $supplier = $this->supplierWeOwe();

        $this->statement($supplier, '', null, ['partners:read', 'invoices:read'])->assertStatus(403)
            ->assertJsonPath('error.code', 'insufficient_scope')
            ->assertJsonMissingPath('data');
    }

    // ── أدوات ────────────────────────────────────────────────────────

    /** قيد يدوي موسوم بالطرف على حسابه التجميعي (بلا مصدر) — للأرصدة المعاكسة. */
    private function manualEntry(Partner $partner, int $debit, int $credit, string $date): void
    {
        $code = $partner->type === 'supplier' ? '2110' : '1130';
        $control = Account::where('code', $code)->firstOrFail()->id;
        $equity = Account::where('code', '3110')->firstOrFail()->id;

        app(LedgerService::class)->post([
            ['account_id' => $control, 'debit' => $debit, 'credit' => $credit, 'partner_type' => Partner::class, 'partner_id' => $partner->id],
            ['account_id' => $equity, 'debit' => $credit, 'credit' => $debit],
        ], ['entry_date' => $date, 'description' => 'قيد يدوي']);
    }
}
