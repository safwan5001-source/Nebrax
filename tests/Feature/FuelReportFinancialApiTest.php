<?php

namespace Tests\Feature;

use App\Models\FuelSale;
use App\Models\Invoice;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/** HORIZON-REPORTS / S7 — العائلة المالية (F): قراءة فقط من بيع الوقود النهائي وفاتورته وقيد COGS. بيانات اصطناعية. */
class FuelReportFinancialApiTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;
    use CapturesThrowable;
    use BuildsFuelCashFixture;

    private const BASE = '/api/fuel-stations/report-center';

    protected function setUp(): void
    {
        parent::setUp();
        config(['fuel_stations.shift_cash_receipts_enabled' => true]);
        $this->f = $this->fixture();
        config(['fuel_stations.shift_cash_receipts_enabled' => false]);
    }

    private function token(string $who = 'actor'): string
    {
        return $this->f[$who]->createToken('t')->plainTextToken;
    }

    private function report(string $key, string $who = 'actor', string $query = ''): array
    {
        return $this->withToken($this->token($who))->getJson(self::BASE.'/'.$key.$query)->assertOk()->json('data');
    }

    private function table(array $p, string $key): ?array
    {
        return collect($p['tables'])->firstWhere('key', $key);
    }

    private function finalizedSale(): FuelSale
    {
        $shift = $this->open('fin');

        return $this->sale('fin-sale', $shift)->fresh(['invoice']);
    }

    /** @test */
    public function revenue_and_vat_come_from_the_official_invoice_without_recomputation(): void
    {
        $sale = $this->finalizedSale();
        $invoice = Invoice::findOrFail($sale->invoice_id);

        $rev = $this->table($this->report('financial.revenue'), 'revenue')['rows'][0];
        $this->assertSame(1, $rev['sales']);
        $this->assertSame(1000, $rev['liters']);
        $this->assertSame((int) $sale->gross_minor, $rev['gross']);
        $this->assertSame((int) $invoice->subtotal, $rev['net']);
        $this->assertSame((int) $invoice->tax_amount, $rev['tax']);

        $vat = $this->table($this->report('financial.vat'), 'vat');
        $this->assertSame((int) $invoice->tax_amount, $vat['totals']['tax']);
        $this->assertSame('finalized_sales', $this->report('financial.vat')['source']['kind']);
    }

    /** @test */
    public function cost_and_profit_use_the_official_cogs_and_are_hidden_without_cost_permission(): void
    {
        $sale = $this->finalizedSale();
        $invoice = Invoice::findOrFail($sale->invoice_id);
        $this->assertNotNull($sale->cogs_minor);

        $cogs = $this->table($this->report('financial.cogs'), 'cogs');
        $this->assertSame((int) $sale->cogs_minor, $cogs['totals']['cogs']);
        $profit = $this->table($this->report('financial.gross_profit'), 'profit')['rows'][0];
        $this->assertSame((int) $invoice->subtotal - (int) $sale->cogs_minor, $profit['profit']);

        // مستخدم يرى المبيعات بلا صلاحية التكلفة: الإيراد يبقى، والتكلفة والربح جدولان محذوفان.
        $viewer = $this->roleUser($this->f['tenant_id'], 'salesview', 'salesview@fin.test', ['fuel.sale.view']);
        $this->f['viewer'] = $viewer;
        $this->assertNotNull($this->table($this->report('financial.revenue', 'viewer'), 'revenue'));
        $this->assertSame([], $this->report('financial.cogs', 'viewer')['tables']);
        $this->assertSame([], $this->report('financial.gross_profit', 'viewer')['tables']);
    }

    /** @test */
    public function a_sale_without_cogs_makes_cost_unavailable_instead_of_estimating(): void
    {
        $sale = $this->finalizedSale();
        \Illuminate\Support\Facades\DB::table('fuel_sales')->where('id', $sale->id)->update(['cogs_minor' => null]);

        $p = $this->report('financial.cogs');
        $this->assertNull($this->table($p, 'cogs')['totals']['cogs']);
        $this->assertContains('cost_unavailable', $p['data_quality']['gaps']);
        $this->assertFalse($p['data_quality']['complete']);
        $this->assertNull($this->table($this->report('financial.gross_profit'), 'profit')['rows'][0]['profit']);
        $exceptions = $this->table($this->report('financial.exceptions'), 'exceptions')['rows'];
        $this->assertContains('sale_without_cogs', array_column($exceptions, 'type'));
    }

    /** @test */
    public function payment_methods_report_the_receipts_by_method_and_links_show_full_linkage(): void
    {
        $sale = $this->finalizedSale();
        $this->collect($sale, 'cash', null, 'fin-collect');

        $methods = $this->table($this->report('financial.payment_methods'), 'methods');
        $this->assertCount(1, $methods['rows']);
        $this->assertSame((int) $sale->invoice->total, $methods['totals']['amount']);
        $this->assertSame(10_000, $methods['rows'][0]['share_bp']);

        $link = $this->table($this->report('financial.accounting_links'), 'links')['rows'][0];
        $this->assertSame([1, 1, 1, 1], [$link['has_invoice'], $link['has_entry'], $link['has_cogs'], $link['has_stock']]);
        $this->assertSame([], $this->table($this->report('financial.exceptions'), 'exceptions')['rows']); // بيع سليم بلا استثناء
    }

    /** @test */
    public function reconciliation_compares_the_three_sources_per_shift(): void
    {
        $sale = $this->finalizedSale();
        $rows = $this->table($this->report('financial.reconciliations'), 'reconciliation')['rows'];
        $this->assertSame((int) $sale->gross_minor, $rows[0]['formal']);
        $this->assertNull($rows[0]['meter']);      // لا إقرار تحصيل ⇒ لا لقطة مبيعات عدادات
        $this->assertNull($rows[0]['collected']);
        $this->assertNull($rows[0]['meter_minus_formal']);
    }

    /** @test */
    public function financial_reports_require_permission_and_are_isolated_per_tenant(): void
    {
        $this->finalizedSale();
        foreach (['revenue', 'vat', 'cogs', 'gross_profit', 'payment_methods', 'reconciliations', 'accounting_links', 'exceptions'] as $name) {
            $this->withToken($this->token('seller'))->getJson(self::BASE.'/financial.'.$name)->assertNotFound();
        }
        $ours = $this->f;
        \Illuminate\Support\Facades\Cache::flush();
        config(['fuel_stations.shift_cash_receipts_enabled' => true]);
        $this->f = $this->fixture('b');
        config(['fuel_stations.shift_cash_receipts_enabled' => false]);
        $token = $this->f['actor']->createToken('t')->plainTextToken;
        $this->f = $ours;
        $foreign = $this->withToken($token)->getJson(self::BASE.'/financial.revenue')->assertOk()->json('data');
        $this->assertSame([], $this->table($foreign, 'revenue')['rows']);
    }
}
