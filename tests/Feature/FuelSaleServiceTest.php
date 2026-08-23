<?php

namespace Tests\Feature;

use App\Models\Branch;
use App\Models\FuelNozzle;
use App\Models\FuelProduct;
use App\Models\FuelPump;
use App\Models\FuelSale;
use App\Models\FuelShiftEvent;
use App\Models\Payment;
use App\Models\PaymentMethod;
use App\Models\FuelShift;
use App\Models\FuelStation;
use App\Models\FuelStationProductPrice;
use App\Models\FuelTank;
use App\Models\Product;
use App\Models\Warehouse;
use App\Services\Accounting\CashBankAccountService;
use App\Services\Accounting\InventoryService;
use App\Services\Accounting\InvoiceService;
use App\Services\FuelCostBasisService;
use App\Services\FuelSaleService;
use App\Services\FuelShiftService;
use App\Services\FuelStationProductPriceService;
use App\Services\FuelStationSettingsService;
use App\Tenancy\BranchContext;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use RuntimeException;
use Tests\TestCase;

class FuelSaleServiceTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    /** @test */
    public function it_finalizes_a_fractional_fuel_sale_once_to_a_credit_invoice_and_exact_fuel_cogs(): void
    {
        $fixture = $this->fixture();
        $prices = app(FuelStationProductPriceService::class);
        $prices->create([
            'fuel_station_id' => $fixture['station']->id,
            'fuel_product_id' => $fixture['fuelProduct']->id,
            'price_per_liter_minor' => 230,
            'effective_from' => now()->subMinute()->toIso8601String(),
            'reason' => 'سعر مضخة اختبار معتمد',
        ], $fixture['actor']);
        $shift = app(FuelShiftService::class)->open([
            'fuel_station_id' => $fixture['station']->id,
            'opening_float_minor' => 0,
            'idempotency_key' => 'sale-open-shift',
        ], $fixture['actor']);

        $service = app(FuelSaleService::class);
        $sale = $service->createDraft([
            'fuel_station_id' => $fixture['station']->id,
            'fuel_nozzle_id' => $fixture['nozzle']->id,
            'fuel_shift_id' => $shift->id,
            'partner_id' => $fixture['customer_id'],
            'quantity_milliliters' => 1234,
            'meter_start_milliliters' => 100000,
            'meter_end_milliliters' => 101234,
            'idempotency_key' => 'fuel-sale-draft-1',
        ], $fixture['actor']);
        $this->assertSame(FuelSale::STATUS_DRAFT, $sale->status);
        $this->assertNull($sale->invoice_id);

        $finalized = $service->finalize($sale, $fixture['actor']);
        $this->assertSame(FuelSale::STATUS_FINALIZED, $finalized->status);
        $this->assertSame(230, $finalized->price_per_liter_minor);
        $this->assertSame('283820', $finalized->pricing_numerator);
        $this->assertSame(284, $finalized->gross_minor);
        $this->assertSame('half_up', $finalized->rounding_policy);
        $this->assertNotNull($finalized->invoice_id);
        $this->assertNotNull($finalized->stock_movement_id);
        $this->assertSame(0, $finalized->paid_minor);
        $this->assertSame(FuelSale::PAYMENT_UNPAID, $finalized->payment_status);

        $invoice = $finalized->invoice()->with('lines')->firstOrFail();
        $this->assertSame('credit', $invoice->payment_type);
        $this->assertSame('posted', $invoice->status);
        $this->assertSame(284, $invoice->lines->sole()->rounded_gross_minor);
        $this->assertSame(1234, $invoice->lines->sole()->quantity_numerator);
        $this->assertSame(1000, $invoice->lines->sole()->quantity_denominator);
        $this->assertSame(1234, $finalized->stockMovement()->firstOrFail()->quantity);
        $this->assertSame(-1234, $finalized->fresh()->stockMovement()->firstOrFail()->quantity * -1);

        $same = $service->finalize($finalized, $fixture['actor']);
        $this->assertSame($finalized->id, $same->id);
        $this->assertSame(1, FuelSale::count());
        $this->assertSame(1, \App\Models\Invoice::count());
        $this->assertSame(1, \App\Models\StockMovement::where('source_type', FuelSale::class)->count());
    }

    /** @test */
    public function it_snapshots_the_station_tax_mode_and_uses_invoice_vat_without_reinterpreting_history(): void
    {
        $fixture = $this->fixture('vat');
        $prices = app(FuelStationProductPriceService::class);
        $prices->create([
            'fuel_station_id' => $fixture['station']->id,
            'fuel_product_id' => $fixture['fuelProduct']->id,
            'price_per_liter_minor' => 230,
            'effective_from' => now()->subMinute()->toIso8601String(),
        ], $fixture['actor']);
        $settings = app(FuelStationSettingsService::class);
        $settings->putTenant(['fuel_price_tax_mode' => 'tax_exclusive'], $fixture['actor'], 'سياسة مستأجر اختبار VAT');
        $settings->putStationValues($fixture['station'], ['fuel_price_tax_mode' => 'tax_inclusive'], $fixture['actor'], 'سعر مضخة شامل VAT');
        $this->assertSame('tax_inclusive', $settings->fuelPriceTaxMode($fixture['station']));
        $this->assertDatabaseHas('fuel_station_configuration_events', [
            'fuel_station_id' => $fixture['station']->id,
            'setting_key' => 'fuel_price_tax_mode',
        ]);

        $shift = app(FuelShiftService::class)->open([
            'fuel_station_id' => $fixture['station']->id,
            'opening_float_minor' => 0,
            'idempotency_key' => 'vat-shift',
        ], $fixture['actor']);
        $service = app(FuelSaleService::class);
        $inclusive = $service->finalize($service->createDraft([
            'fuel_station_id' => $fixture['station']->id,
            'fuel_nozzle_id' => $fixture['nozzle']->id,
            'fuel_shift_id' => $shift->id,
            'partner_id' => $fixture['customer_id'],
            'quantity_milliliters' => 1000,
            'idempotency_key' => 'vat-inclusive-sale',
        ], $fixture['actor']), $fixture['actor']);
        $inclusiveInvoice = $inclusive->invoice()->firstOrFail();
        $this->assertSame('tax_inclusive', $inclusive->fuel_price_tax_mode);
        $this->assertTrue($inclusiveInvoice->tax_inclusive);
        $this->assertSame($inclusive->gross_minor, $inclusiveInvoice->total, 'السعر الشامل لا يضيف VAT فوق سعر المضخة مرة ثانية.');
        $duplicate = app(InvoiceService::class)->duplicate($inclusiveInvoice, $fixture['actor']->id);
        $duplicateLine = $duplicate->lines()->sole();
        $this->assertSame(1000, $duplicateLine->quantity_numerator);
        $this->assertSame(1000, $duplicateLine->quantity_denominator);
        $this->assertSame($inclusiveInvoice->total, $duplicate->total);

        $settings->putStationValues($fixture['station'], ['fuel_price_tax_mode' => 'tax_exclusive'], $fixture['actor'], 'سعر مضخة قبل VAT');
        $this->assertSame('tax_inclusive', $inclusive->fresh()->fuel_price_tax_mode, 'تغيير الإعداد لا يعيد تفسير البيع النهائي.');
        $this->assertTrue($inclusiveInvoice->fresh()->tax_inclusive, 'رأس الفاتورة يحتفظ بلقطة inclusion الأصلية.');

        $exclusive = $service->finalize($service->createDraft([
            'fuel_station_id' => $fixture['station']->id,
            'fuel_nozzle_id' => $fixture['nozzle']->id,
            'fuel_shift_id' => $shift->id,
            'partner_id' => $fixture['customer_id'],
            'quantity_milliliters' => 1000,
            'idempotency_key' => 'vat-exclusive-sale',
        ], $fixture['actor']), $fixture['actor']);
        $exclusiveInvoice = $exclusive->invoice()->firstOrFail();
        $this->assertSame('tax_exclusive', $exclusive->fuel_price_tax_mode);
        $this->assertFalse($exclusiveInvoice->tax_inclusive);
        $this->assertGreaterThan($exclusive->gross_minor, $exclusiveInvoice->total, 'السعر قبل VAT يضيف الضريبة عبر InvoiceService.');
    }

    /** @test */
    public function it_collects_an_official_cash_receipt_without_mutating_cycle_four_operational_cash(): void
    {
        $fixture = $this->fixture('receipt');
        $prices = app(FuelStationProductPriceService::class);
        $prices->create([
            'fuel_station_id' => $fixture['station']->id,
            'fuel_product_id' => $fixture['fuelProduct']->id,
            'price_per_liter_minor' => 230,
            'effective_from' => now()->subMinute()->toIso8601String(),
        ], $fixture['actor']);
        app(CashBankAccountService::class)->bootstrapDefaults();
        $cash = PaymentMethod::where('settlement_type', 'cash')->where('is_active', true)->sole();
        app(FuelStationSettingsService::class)->putStationValues($fixture['station'], [
            'fuel_sales_allowed_payment_method_ids' => [$cash->id],
            'fuel_sales_allow_deferred_payment' => false,
        ], $fixture['actor'], 'تهيئة قبض الوقود');
        $shift = app(FuelShiftService::class)->open([
            'fuel_station_id' => $fixture['station']->id,
            'opening_float_minor' => 0,
            'idempotency_key' => 'receipt-shift',
        ], $fixture['actor']);
        $service = app(FuelSaleService::class);
        $sale = $service->finalize($service->createDraft([
            'fuel_station_id' => $fixture['station']->id,
            'fuel_nozzle_id' => $fixture['nozzle']->id,
            'fuel_shift_id' => $shift->id,
            'partner_id' => $fixture['customer_id'],
            'quantity_milliliters' => 1000,
            'idempotency_key' => 'receipt-sale',
        ], $fixture['actor']), $fixture['actor']);

        $payment = $service->collectPayment($sale, [
            'payment_method_id' => $cash->id,
            'amount_minor' => $sale->invoice->total,
            'idempotency_key' => 'receipt-payment-1',
            'reference' => 'CASH-TEST-1',
        ], $fixture['actor']);
        $this->assertSame('posted', $payment->status);
        $this->assertSame(1, Payment::count());
        $this->assertSame(FuelSale::PAYMENT_PAID, $sale->fresh()->payment_status);
        $this->assertSame($sale->invoice->total, $sale->fresh()->paid_minor);
        $this->assertSame(1, $sale->paymentReceipts()->count());
        $this->assertDatabaseHas('fuel_shift_events', [
            'fuel_shift_id' => $shift->id,
            'type' => FuelShiftEvent::TYPE_OFFICIAL_CASH_PAYMENT_RECORDED,
        ]);
        $this->assertSame(0, $shift->cashMovements()->count());

        $again = $service->collectPayment($sale->fresh(), [
            'payment_method_id' => $cash->id,
            'amount_minor' => $sale->invoice->total,
            'idempotency_key' => 'receipt-payment-1',
        ], $fixture['actor']);
        $this->assertSame($payment->id, $again->id);
        $this->assertSame(1, Payment::count());
    }

    /** @test */
    public function it_resolves_station_price_before_tenant_default_and_fails_closed_without_a_price(): void
    {
        $fixture = $this->fixture();
        $prices = app(FuelStationProductPriceService::class);
        $prices->create([
            'fuel_product_id' => $fixture['fuelProduct']->id,
            'price_per_liter_minor' => 200,
            'effective_from' => now()->subMinute()->toIso8601String(),
        ], $fixture['actor']);
        $prices->create([
            'fuel_station_id' => $fixture['station']->id,
            'fuel_product_id' => $fixture['fuelProduct']->id,
            'price_per_liter_minor' => 230,
            'effective_from' => now()->subMinute()->toIso8601String(),
        ], $fixture['actor']);
        $this->assertSame(230, $prices->effective($fixture['station'], $fixture['fuelProduct'], now())->price_per_liter_minor);

        $other = $this->fixture('other');
        $this->expectException(RuntimeException::class);
        $prices->effective($other['station'], $other['fuelProduct'], now());
    }

    /** @return array<string,mixed> */
    private function fixture(string $suffix = 'main'): array
    {
        $auth = $this->registerTenant('fuel-sale-' . $suffix, "fuel-sale-{$suffix}@example.test");
        app(TenantContext::class)->set($auth['tenant_id']);
        $branch = Branch::where('tenant_id', $auth['tenant_id'])->sole();
        app(BranchContext::class)->set($branch->id);
        \App\Models\Tenant::findOrFail($auth['tenant_id'])->update(['country' => 'SA']);
        $actor = \App\Models\User::where('tenant_id', $auth['tenant_id'])->where('role', 'owner')->sole();
        $warehouse = Warehouse::where('tenant_id', $auth['tenant_id'])->where('branch_id', $branch->id)->sole();
        $customer = \App\Models\Partner::create(['tenant_id' => $auth['tenant_id'], 'branch_id' => $branch->id, 'name' => 'عميل بيع وقود', 'type' => 'customer']);
        $product = Product::create([
            'tenant_id' => $auth['tenant_id'], 'branch_id' => $branch->id, 'sku' => 'FUEL-SALE-' . $suffix,
            'name' => 'بنزين بيع اختبار', 'unit' => 'mL', 'track_inventory' => true,
        ]);
        $fuelProduct = FuelProduct::create([
            'tenant_id' => $auth['tenant_id'], 'product_id' => $product->id, 'code' => 'FS-' . $suffix, 'name' => 'بنزين 95',
        ]);
        $station = FuelStation::create([
            'tenant_id' => $auth['tenant_id'], 'branch_id' => $branch->id, 'warehouse_id' => $warehouse->id,
            'code' => 'FSS-' . $suffix, 'name' => 'محطة بيع اختبار',
        ]);
        $tank = FuelTank::create([
            'tenant_id' => $auth['tenant_id'], 'branch_id' => $branch->id, 'fuel_station_id' => $station->id,
            'fuel_product_id' => $fuelProduct->id, 'code' => 'FST-' . $suffix, 'name' => 'خزان بيع اختبار',
            'capacity_milliliters' => 1000000, 'safe_capacity_milliliters' => 900000,
        ]);
        $pump = FuelPump::create([
            'tenant_id' => $auth['tenant_id'], 'branch_id' => $branch->id, 'fuel_station_id' => $station->id, 'pump_number' => 'FSP-' . $suffix,
        ]);
        $nozzle = FuelNozzle::create([
            'tenant_id' => $auth['tenant_id'], 'branch_id' => $branch->id, 'fuel_station_id' => $station->id, 'fuel_pump_id' => $pump->id,
            'fuel_tank_id' => $tank->id, 'fuel_product_id' => $fuelProduct->id, 'nozzle_number' => 'FSN-' . $suffix,
        ]);
        app(FuelCostBasisService::class)->assertReady($fuelProduct, $warehouse);
        $movement = app(InventoryService::class)->applyReceipt($product, 10000, 100, [
            'warehouse_id' => $warehouse->id, 'source_type' => FuelProduct::class, 'source_id' => $fuelProduct->id, 'notes' => 'رصيد اختبار للبيع',
        ], 1000000);
        app(FuelCostBasisService::class)->recordReceipt($fuelProduct, $warehouse, $movement, 10000, 1000000);

        return compact('actor', 'branch', 'warehouse', 'customer', 'product', 'fuelProduct', 'station', 'tank', 'pump', 'nozzle') + [
            'tenant_id' => $auth['tenant_id'], 'customer_id' => $customer->id,
        ];
    }
}
