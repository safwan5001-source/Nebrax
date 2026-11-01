<?php

namespace Tests\Feature;

use App\Models\Account;
use App\Models\Branch;
use App\Models\Invoice;
use App\Models\Partner;
use App\Models\Product;
use App\Models\Purchase;
use App\Models\Tenant;
use App\Services\Accounting\ChartOfAccountsSeeder;
use App\Services\Accounting\InvoiceService;
use App\Services\Accounting\LedgerService;
use App\Services\Accounting\PaymentService;
use App\Services\Accounting\PurchaseService;
use App\Services\Reporting\ReportService;
use App\Services\TenantApplicationService;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * IMP-PARTNER-STATEMENTS PS-A2b (D-PS-10) — لقطة ذهبية لكشف حساب الطرف (`ReportService::partnerStatement`).
 *
 * اللقطة (`tests/Fixtures/partner_statement_report_golden.json`) **وُلِّدت من الكود قبل أي تعديل** على الخدمة، على حالة تغطّي: رصيد افتتاحي، فاتورة، سند قبض بتخصيص،
 * مشتريات، سند صرف بتخصيص، قيد يدوي، وقراءات: بلا تصفية · بفترة (رصيد افتتاحي) · بدور العميل · بدور المورد · بفرع. الاختبار يقارن الناتج الحالي بها
 * **بعد حذف المفاتيح الإضافية الثلاثة وحدها** (`entry_id`، `entry_status`، `reversal_of`): كل مفتاح وقيمة وترتيب قائم يجب أن يبقى حرفياً.
 *
 * المعرّفات تُطبَّع إلى `U1..Un` بترتيب الظهور فتثبت اللقطة بين التشغيلات؛ التواريخ ثابتة صريحة. الحالة الوحيدة التي غيّرها الإصلاح (كشف دور لمستند معكوس) خارج هذه
 * اللقطة عمداً وموثَّقة في `PartnerStatementReversalCharacterizationTest`.
 *
 * إعادة التوليد (نادرة، بقرار مراجعة): GOLDEN_WRITE=1 php artisan test --filter=PartnerStatementReportGoldenTest
 */
class PartnerStatementReportGoldenTest extends TestCase
{
    use RefreshDatabase;

    private const FIXTURE = __DIR__.'/../Fixtures/partner_statement_report_golden.json';

    private const NEW_KEYS = ['entry_id', 'entry_status', 'reversal_of'];

    private Partner $both;

    protected function setUp(): void
    {
        parent::setUp();
        $tenant = Tenant::create(['name' => 'نبراس الطموح', 'slug' => 'nibras', 'vat_number' => '300000000000003', 'currency' => 'SAR']);
        app(TenantContext::class)->set($tenant->id);
        app(ChartOfAccountsSeeder::class)->seed($tenant->id);
        app(TenantApplicationService::class)->enable('purchases.cycle', null);
        $this->both = Partner::create(['name' => 'طرف مزدوج', 'type' => 'both']);
    }

    /** يبني حالة الطرف ويعيد معرّف فرعٍ ثانٍ لا حركة فيه. */
    private function seedLedger(): string
    {
        $ledger = app(LedgerService::class);
        $invoices = app(InvoiceService::class);
        $payments = app(PaymentService::class);
        $purchases = app(PurchaseService::class);

        // رصيد افتتاحي (مصدره الطرف نفسه) قبل الفترة.
        $ledger->post([
            ['account_id' => Account::where('code', '1130')->firstOrFail()->id, 'debit' => 50000, 'credit' => 0, 'partner_type' => Partner::class, 'partner_id' => $this->both->id],
            ['account_id' => Account::where('code', '3110')->firstOrFail()->id, 'debit' => 0, 'credit' => 50000],
        ], ['entry_date' => '2026-08-15', 'description' => 'رصيد افتتاحي', 'source_type' => Partner::class, 'source_id' => $this->both->id]);

        $invoice = $invoices->post($invoices->create(
            ['partner_id' => $this->both->id, 'payment_type' => 'credit', 'invoice_date' => '2026-09-01'],
            [['quantity' => 2, 'unit_price' => 100000, 'tax_rate' => 15]],
        ));
        $payments->post($payments->create(
            ['partner_id' => $this->both->id, 'direction' => 'received', 'amount' => 100000, 'payment_date' => '2026-09-03', 'invoice_id' => $invoice->id],
            [['invoice_id' => $invoice->id, 'amount' => 100000]],
        ));

        $product = Product::create(['name' => 'بضاعة', 'sale_price' => 10000, 'track_inventory' => true]);
        $purchase = $purchases->post($purchases->create(
            ['partner_id' => $this->both->id, 'payment_type' => 'credit', 'purchase_date' => '2026-09-05'],
            [['product_id' => $product->id, 'quantity' => 10, 'unit_price' => 10000, 'tax_rate' => 15]],
        ));
        $payments->post($payments->create(
            ['partner_id' => $this->both->id, 'direction' => 'paid', 'amount' => 40000, 'payment_date' => '2026-09-08'],
            [['purchase_id' => $purchase->id, 'amount' => 40000]],
        ));

        // قيد يدوي موسوم بالطرف (بلا مصدر).
        $ledger->post([
            ['account_id' => Account::where('code', '1130')->firstOrFail()->id, 'debit' => 7000, 'credit' => 0, 'partner_type' => Partner::class, 'partner_id' => $this->both->id],
            ['account_id' => Account::where('code', '4110')->firstOrFail()->id, 'debit' => 0, 'credit' => 7000],
        ], ['entry_date' => '2026-09-10', 'description' => 'قيد يدوي']);

        return Branch::create(['name' => 'فرع بلا حركة', 'code' => 'EMPTY', 'is_main' => false])->id;
    }

    /** @return array<string, mixed> */
    private function readings(string $emptyBranch): array
    {
        $reports = app(ReportService::class);
        $id = $this->both->id;

        return [
            'unfiltered' => $reports->partnerStatement($id),
            'period' => $reports->partnerStatement($id, ['from' => '2026-09-02', 'to' => '2026-09-08']),
            'customer' => $reports->partnerStatement($id, ['partner_role' => 'customer']),
            'supplier' => $reports->partnerStatement($id, ['partner_role' => 'supplier']),
            'customer_period' => $reports->partnerStatement($id, ['partner_role' => 'customer', 'from' => '2026-09-01', 'to' => '2026-09-30']),
            'other_branch' => $reports->partnerStatement($id, ['branch_id' => $emptyBranch]),
        ];
    }

    /** @param array<string, mixed> $value */
    private function normalise(array $value, bool $stripNew): array
    {
        if ($stripNew) {
            $value = $this->strip($value);
        }
        $json = json_encode($value, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
        $map = [];
        $json = preg_replace_callback('/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/', function (array $m) use (&$map): string {
            return $map[$m[0]] ??= 'U'.(count($map) + 1);
        }, $json);

        return json_decode((string) $json, true, 512, JSON_THROW_ON_ERROR);
    }

    /** @param array<string, mixed> $value @return array<string, mixed> */
    private function strip(array $value): array
    {
        foreach ($value as $key => $item) {
            if (is_string($key) && in_array($key, self::NEW_KEYS, true)) {
                unset($value[$key]);

                continue;
            }
            if (is_array($item)) {
                $value[$key] = $this->strip($item);
            }
        }

        return $value;
    }

    /** @test */
    public function the_current_report_output_is_unchanged_apart_from_the_three_additive_keys(): void
    {
        $readings = $this->readings($this->seedLedger());
        $actual = $this->normalise($readings, stripNew: true);

        if (getenv('GOLDEN_WRITE') === '1') {
            file_put_contents(self::FIXTURE, json_encode($actual, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES)."\n");
            $this->markTestSkipped('اللقطة الذهبية كُتبت؛ شغّل الاختبار بدون GOLDEN_WRITE.');
        }

        $expected = json_decode((string) file_get_contents(self::FIXTURE), true, 512, JSON_THROW_ON_ERROR);
        $this->assertSame($expected, $actual, 'مفاتيح/قيم/ترتيب الكشف الحالية تغيّرت.');
    }

    /** @test */
    public function the_golden_state_exercises_every_source_kind_and_both_roles(): void
    {
        $readings = $this->readings($this->seedLedger());

        $kinds = array_values(array_unique(array_map(fn (array $r): string => (string) ($r['source']['kind'] ?? 'journal'), $readings['unfiltered']['rows'])));
        sort($kinds);
        $this->assertSame(['invoice', 'journal', 'opening', 'payment', 'purchase'], $kinds);
        $this->assertNotEmpty($readings['customer']['rows']);
        $this->assertNotEmpty($readings['supplier']['rows']);
        $this->assertSame([], $readings['other_branch']['rows'], 'فرعٌ بلا حركة يعيد كشفاً فارغاً.');
    }
}
