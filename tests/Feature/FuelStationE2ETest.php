<?php

namespace Tests\Feature;

use App\Models\FuelOperationalLedger;
use App\Models\FuelSale;
use App\Models\Invoice;
use App\Models\Payment;
use App\Models\ProductWarehouseStock;
use App\Models\StockMovement;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/**
 * FUEL-E2E: دورة تشغيل محطة وقود كاملة عبر HTTP + تحقق من القاعدة والدفتر.
 * القاعدة: لا ينجح سيناريو لمجرد نجاح الاستجابة؛ كل سيناريو يقارن الوردية بالفواتير والسندات والمخزون والقيود.
 * بيانات E2E_TEST فقط، لا بوابات دفع ولا حسابات بنكية حقيقية.
 */
class FuelStationE2ETest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;
    use FuelStationE2EWorld;

    private const RECEIPTS = ['shift_expected_cash_basis' => 'receiving_shift_receipts'];

    // ═════════ S01 — دورة نقدية كاملة + مطابقة الوردية/الفواتير/المخزون/القيود ═════════

    /** @test */
    public function s01_cash_shift_end_to_end_reconciles_meters_sales_collection_stock_and_ledger(): void
    {
        $this->buildWorld(self::RECEIPTS);
        $before = $this->books();
        $stock0 = $this->stockMl();
        $this->assertSame(10000000, $stock0, 'الرصيد الافتتاحي 10,000 لتر');
        $this->assertSame(1000000, $this->net($before, '1140'), 'قيمة المخزون الافتتاحية = 10,000 لتر × 1.00 ريال');

        $run = $this->standardShift('s01', 20000, 'cash');
        $shift = $run['shift'];
        $closed = $this->closeShift('seller', $shift, $run['counted'])->assertSuccessful()['data'];
        $this->assertSame('closed', $closed['status']);
        $this->assertSame(24600, $closed['expected_operational_cash_minor']);
        $this->assertSame(0, $closed['cash_variance_minor']);
        $this->as('supervisor')->postJson("/api/fuel-stations/shifts/{$shift}/approve", ['note' => 'E2E_TEST'])->assertSuccessful();

        // ── فاتورة وسند ──
        $sale = FuelSale::findOrFail($run['sale']['id']);
        $invoice = Invoice::findOrFail($sale->invoice_id);
        $this->assertSame(4600, (int) $invoice->total);
        $this->assertSame(4600, (int) $invoice->paid_amount);
        $this->assertSame('paid', $sale->payment_status);
        $this->assertSame(1, Payment::where('invoice_id', $invoice->id)->count());
        $this->assertSame(4600, (int) Payment::where('invoice_id', $invoice->id)->sum('amount'));

        // ── مخزون: حركة صرف واحدة 20 لتر، الرصيد ينقص بالضبط ──
        $issues = StockMovement::where('source_type', FuelSale::class)->where('source_id', $sale->id)->get();
        $this->assertCount(1, $issues);
        $this->assertSame(20000, abs((int) $issues->first()->quantity));
        $this->assertSame($stock0 - 20000, $this->stockMl());
        $ledger = FuelOperationalLedger::where('source_type', FuelSale::class)->where('source_id', $sale->id)->get();
        $this->assertCount(1, $ledger);
        $this->assertSame(-20000, (int) $ledger->first()->quantity_milliliters);
        $this->assertSame($stock0 - 20000, (int) $ledger->first()->book_balance_milliliters, 'الدفتر التشغيلي = رصيد المخزن الدفتري');

        // ── قيود: إيراد صافٍ 40.00 + ضريبة 6.00 + تكلفة 20.00 ──
        $after = $this->books();
        $this->assertSame(4000, ($after['by']['4110']['c'] ?? 0) - ($before['by']['4110']['c'] ?? 0), 'إيراد صافٍ');
        $this->assertSame(600, ($after['by']['2120']['c'] ?? 0) - ($before['by']['2120']['c'] ?? 0), 'ضريبة مخرجات 15%');
        $this->assertSame(2000, ($after['by']['5110']['d'] ?? 0) - ($before['by']['5110']['d'] ?? 0), 'تكلفة بضاعة مباعة');
        $this->assertSame(-2000, $this->net($after, '1140') - $this->net($before, '1140'), 'المخزون يقل بالتكلفة');
        $this->assertSame(0, $this->net($after, '1130') - $this->net($before, '1130'), 'ذمة العميل صفر بعد التحصيل');
        $this->assertSame(4600, $this->net($after, '1110') - $this->net($before, '1110'), 'الصندوق +46.00');
        $this->assertBooksIntegrity('s01');

        // ── مطابقة الوردية: عدادات = مبيعات = مخزون = تحصيل ──
        $detail = $this->as('owner')->getJson("/api/fuel-stations/shifts/{$shift}")->assertOk()['data'];
        $this->assertSame('approved', $detail['status']);
        $this->assertSame(20000, $detail['operational_meter_milliliters']);
        $coll = $this->as('owner')->getJson("/api/fuel-stations/shifts/{$shift}/collection")->assertOk()['data'];
        $this->assertSame(4600, $coll['reconciliation']['sales_minor']);
        $this->assertSame(4600, $coll['reconciliation']['collected_total_minor']);
        $this->assertSame(0, $coll['reconciliation']['difference_minor']);
        $this->assertSame(20000, $coll['sales']['milliliters']);
        $this->evidence('S01', [
            'meter_ml' => 20000, 'sale_ml' => 20000, 'stock_delta_ml' => $stock0 - $this->stockMl(), 'invoice_total' => 4600, 'collected' => 4600,
            'gl_revenue' => 4000, 'gl_vat' => 600, 'gl_cogs' => 2000, 'cash_variance' => 0, 'status' => $detail['status'],
        ]);
    }

    /** @test */
    public function s02_default_cash_basis_flags_a_false_overage_for_a_perfectly_correct_cash_shift(): void
    {
        $this->buildWorld(); // افتراضيات النظام كما هي (movements_only)
        $run = $this->standardShift('s02', 20000, 'cash');
        $closed = $this->closeShift('seller', $run['shift'], $run['counted'])->assertSuccessful()['data'];
        $approve = $this->as('supervisor')->postJson("/api/fuel-stations/shifts/{$run['shift']}/approve", ['note' => 'E2E_TEST']);
        $this->evidence('S02', [
            'basis' => $closed['cash_summary']['basis'], 'expected' => $closed['expected_operational_cash_minor'], 'counted' => $closed['counted_cash_minor'],
            'variance' => $closed['cash_variance_minor'], 'incompleteness' => $closed['cash_summary']['incompleteness'], 'approve_status' => $approve->status(),
        ]);
        // السلوك الموثَّق الحالي: المتوقع لا يشمل نقد المبيعات → فرق مزيّف +46.00 ومنع اعتماد.
        $this->assertSame(20000, $closed['expected_operational_cash_minor']);
        $this->assertSame(4600, $closed['cash_variance_minor']);
        $this->assertSame(422, $approve->status());
    }

    // ═════════ S03/S04 — شبكة ودفع مختلط ═════════

    /** @test */
    public function s03_card_sale_does_not_enter_the_cash_drawer(): void
    {
        $this->buildWorld(self::RECEIPTS);
        $run = $this->standardShift('s03', 25000, 'bank', 20000);
        $closed = $this->closeShift('seller', $run['shift'], 20000)->assertSuccessful()['data'];
        $this->assertSame(5750, $run['gross']);
        $this->assertSame(20000, $closed['expected_operational_cash_minor'], 'الشبكة لا تدخل الدرج');
        $this->assertSame(0, $closed['cash_variance_minor']);
        $this->assertSame(5750, $closed['cash_summary']['network_receipts']['amount_minor'] ?? null, 'إيصالات الشبكة معلومة');
        $b = $this->books();
        $this->assertSame(5750, $this->net($b, '1120'), 'مدين البنك 57.50');
        $this->assertSame(0, $this->net($b, '1110'));
        $this->assertBooksIntegrity('s03');
        $this->as('supervisor')->postJson("/api/fuel-stations/shifts/{$run['shift']}/approve", ['note' => 'E2E_TEST'])->assertSuccessful();
        $this->evidence('S03', ['gross' => 5750, 'bank_net' => $this->net($b, '1120'), 'cash_net' => $this->net($b, '1110'), 'variance' => $closed['cash_variance_minor']]);
    }

    /** @test */
    public function s04_mixed_payment_requires_the_deferred_policy_then_reconciles(): void
    {
        $this->buildWorld(self::RECEIPTS + ['fuel_sales_allow_deferred_payment' => false]);
        $shift = $this->openShift('seller', 's04-open');
        $this->as('seller')->postJson("/api/fuel-stations/shifts/{$shift}/staff", ['user_id' => $this->w['seller']->id, 'role' => 'attendant'])->assertSuccessful();
        $this->meter('seller', $shift, 'opening', 1000000);
        $this->tankReading('seller', $shift, 'opening', 10000000);
        $sale = $this->finalSale('seller', $shift, 100000, 's04-sale'); // 100 لتر = 230.00
        $this->assertSame(23000, (int) $sale['gross_minor']);

        // السياسة المغلقة ترفض الدفعة الجزئية دون أثر.
        $rej = $this->collect('seller', $sale['id'], 'cash', 10000, 's04-p1');
        $this->assertSame(422, $rej->status());
        $this->assertSame(0, Payment::where('invoice_id', FuelSale::find($sale['id'])->invoice_id)->count());

        $this->as('owner')->putJson("/api/fuel-stations/stations/{$this->w['station']['id']}/settings", ['fuel_sales_allow_deferred_payment' => true])->assertOk();
        $this->collect('seller', $sale['id'], 'cash', 10000, 's04-p1')->assertSuccessful();
        $mid = FuelSale::find($sale['id']);
        $this->assertSame('partially_paid', $mid->payment_status);
        $this->collect('seller', $sale['id'], 'bank', 13000, 's04-p2')->assertSuccessful();
        $fin = FuelSale::find($sale['id']);
        $this->assertSame('paid', $fin->payment_status);
        $this->assertSame(23000, (int) $fin->paid_minor);
        $over = $this->collect('seller', $sale['id'], 'cash', 1, 's04-p3');
        $this->assertSame(422, $over->status(), 'لا تحصيل فوق المتبقي');

        $this->meter('seller', $shift, 'closing', 1100000);
        $this->tankReading('seller', $shift, 'closing', 9900000);
        $this->declareCollection('seller', $shift, 10000, 13000, 's04-decl')->assertSuccessful();
        $closed = $this->closeShift('seller', $shift, 30000)->assertSuccessful()['data'];
        $this->assertSame(30000, $closed['expected_operational_cash_minor']);
        $this->assertSame(0, $closed['cash_variance_minor']);
        $coll = $this->as('owner')->getJson("/api/fuel-stations/shifts/{$shift}/collection")->assertOk()['data'];
        $this->assertSame(0, $coll['reconciliation']['difference_minor']);
        $this->assertBooksIntegrity('s04');
        $this->evidence('S04', ['gross' => 23000, 'cash' => 10000, 'bank' => 13000, 'payments' => 2, 'difference' => $coll['reconciliation']['difference_minor']]);
    }

    // ═════════ S05 — اختلاف الأسعار ═════════

    /** @test */
    public function s05_price_change_mid_shift_keeps_each_invoice_at_its_own_price_and_marks_derived_sales_unreliable(): void
    {
        $this->buildWorld(self::RECEIPTS);
        $shift = $this->openShift('seller', 's05-open');
        $this->as('seller')->postJson("/api/fuel-stations/shifts/{$shift}/staff", ['user_id' => $this->w['seller']->id, 'role' => 'attendant'])->assertSuccessful();
        $this->meter('seller', $shift, 'opening', 1000000);
        $this->tankReading('seller', $shift, 'opening', 10000000);
        $s1 = $this->finalSale('seller', $shift, 20000, 's05-a');
        $this->collect('seller', $s1['id'], 'cash', (int) $s1['gross_minor'], 's05-pa')->assertSuccessful();
        $this->travelTo(now()->addMinutes(3)); // سعر جديد بعد الأول بوقت حقيقي (الدقيقة هي دقة بدء السعر)
        $newPrice = $this->as('owner')->postJson('/api/fuel-stations/prices', [
            'fuel_station_id' => $this->w['station']['id'], 'fuel_product_id' => $this->w['fuelProduct']['id'], 'price_per_liter_minor' => 250,
            'start_now' => true, 'supersede' => true, 'idempotency_key' => 'e2e-price-change-2',
        ]);
        $this->assertContains($newPrice->status(), [200, 201], $newPrice->getContent());
        $s2 = $this->finalSale('seller', $shift, 20000, 's05-b');
        $this->collect('seller', $s2['id'], 'cash', (int) $s2['gross_minor'], 's05-pb')->assertSuccessful();
        $this->assertSame(4600, (int) $s1['gross_minor']);
        $this->assertSame(5000, (int) $s2['gross_minor']);
        $this->meter('seller', $shift, 'closing', 1040000);
        $this->tankReading('seller', $shift, 'closing', 9960000);
        $this->declareCollection('seller', $shift, 9600, 0, 's05-decl')->assertSuccessful();
        $coll = $this->as('owner')->getJson("/api/fuel-stations/shifts/{$shift}/collection")->assertOk()['data'];
        $this->evidence('S05', [
            'sale1' => $s1['gross_minor'], 'sale2' => $s2['gross_minor'], 'true_total' => 9600, 'collection_sales_minor' => $coll['sales']['amount_minor'],
            'sales_complete' => $coll['sales']['complete'], 'sales_gaps' => $coll['sales']['gaps'], 'product_gaps' => $coll['sales']['products'][0]['gaps'] ?? null,
            'difference' => $coll['reconciliation']['difference_minor'], 'recon_final' => $coll['reconciliation']['final'],
        ]);
        // القاعدة الصارمة: لا يُعرض رقم مبيعات خاطئ بصفته نهائياً.
        if ($coll['sales']['complete'] === true) {
            $this->assertSame(9600, $coll['sales']['amount_minor'], 'مبيعات مشتقة "كاملة" يجب أن تساوي 96.00 (لا 100.00 بسعر واحد).');
        } else {
            $this->assertNull($coll['sales']['amount_minor']);
        }
    }

    // ═════════ S06 — عجز وزيادة وتسوية ═════════

    /** @test */
    public function s06_cash_shortage_and_overage_require_supervisor_review_before_approval(): void
    {
        foreach ([['short', 24000, -600, 'shortage'], ['over', 24900, 300, 'overage']] as [$tag, $counted, $variance, $direction]) {
            $this->buildWorld(self::RECEIPTS, slug: "e2e-test-fuel-{$tag}");
            $run = $this->standardShift("s06{$tag}", 20000, 'cash');
            $closed = $this->closeShift('seller', $run['shift'], $counted, 'E2E_TEST سبب الفرق')->assertSuccessful()['data'];
            $this->assertSame($variance, $closed['cash_variance_minor'], $tag);
            $this->assertSame($direction === 'shortage' ? 'shortage' : 'overage', $closed['cash_variance']['variance_direction']);
            $this->assertSame('pending_review', $closed['cash_variance']['status']);
            $blocked = $this->as('supervisor')->postJson("/api/fuel-stations/shifts/{$run['shift']}/approve", ['note' => 'x']);
            $this->assertSame(422, $blocked->status(), "{$tag}: لا اعتماد قبل مراجعة الفرق");
            $this->as('seller')->postJson("/api/fuel-stations/shifts/{$run['shift']}/cash-variance/review", ['note' => 'x'])->assertForbidden();
            $review = $this->as('supervisor')->postJson("/api/fuel-stations/shifts/{$run['shift']}/cash-variance/review", ['note' => 'E2E_TEST تمت المراجعة']);
            $this->assertContains($review->status(), [200, 201], $review->getContent());
            $this->as('supervisor')->postJson("/api/fuel-stations/shifts/{$run['shift']}/approve", ['note' => 'E2E_TEST'])->assertSuccessful();
            $this->evidence('S06-' . $tag, ['counted' => $counted, 'variance' => $variance, 'approve_before_review' => $blocked->status(), 'final' => 'approved']);
            $this->assertBooksIntegrity("s06-{$tag}");
        }
    }
}
