<?php

namespace Tests\Feature;

use App\Models\Account;
use App\Models\Branch;
use App\Models\FuelDelivery;
use App\Models\FuelInventoryCostState;
use App\Models\FuelProduct;
use App\Models\FuelStation;
use App\Models\FuelSupplierInvoiceMatch;
use App\Models\FuelTank;
use App\Models\JournalLine;
use App\Models\Partner;
use App\Models\Product;
use App\Models\StockMovement;
use App\Models\User;
use App\Models\Warehouse;
use App\Services\Accounting\InventoryService;
use App\Services\FuelCostBasisService;
use App\Services\FuelStationSettingsService;
use App\Services\FuelSupplyReceivingService;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use RuntimeException;
use Tests\TestCase;

class FuelSupplyReceivingTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    /** @test */
    public function approved_fuel_receipt_posts_inventory_to_explicit_grni_and_records_exact_cost_pool(): void
    {
        $fixture = $this->fixture();
        $delivery = $fixture['service']->createDelivery($this->deliveryData($fixture, 'receipt-1', 2345));
        $approved = $fixture['service']->approveDelivery($delivery, $fixture['owner_id']);

        $this->assertSame(FuelDelivery::STATUS_APPROVED, $approved->status);
        $this->assertSame(10000, (int) Product::findOrFail($fixture['product']->id)->quantity_on_hand);
        $movement = StockMovement::findOrFail($approved->stock_movement_id);
        $this->assertSame(10000, (int) $movement->quantity);
        $this->assertSame(2345, (int) $movement->total_cost);
        $this->assertSame($fixture['warehouse']->id, $movement->warehouse_id);

        $costState = FuelInventoryCostState::where('warehouse_id', $fixture['warehouse']->id)->where('fuel_product_id', $fixture['fuel']->id)->firstOrFail();
        $this->assertSame(10000, (int) $costState->quantity_milliliters);
        $this->assertSame(2345, (int) $costState->cost_pool_minor);
        $this->assertSame(0, (int) $costState->carry_remainder_numerator);

        $inventory = Account::where('code', '1140')->firstOrFail();
        $lines = JournalLine::where('journal_entry_id', $approved->journal_entry_id)->get()->keyBy('account_id');
        $this->assertSame(2345, (int) $lines[$inventory->id]->debit);
        $this->assertSame(2345, (int) $lines[$fixture['grni']->id]->credit);
    }

    /** @test */
    public function receipt_requires_an_explicit_grni_mapping_and_never_falls_back_to_a_payable_account(): void
    {
        $fixture = $this->fixture(configureGrni: false);
        $delivery = $fixture['service']->createDelivery($this->deliveryData($fixture, 'receipt-no-grni', 2345));

        $this->expectException(RuntimeException::class);
        $this->expectExceptionMessage('GRNI');
        $fixture['service']->approveDelivery($delivery, $fixture['owner_id']);
    }

    /** @test */
    public function preexisting_fuel_stock_without_an_exact_cost_baseline_blocks_receipt_without_using_product_average_cost(): void
    {
        $fixture = $this->fixture();
        app(InventoryService::class)->applyReceipt($fixture['product'], 500, 99, ['warehouse_id' => $fixture['warehouse']->id]);
        $delivery = $fixture['service']->createDelivery($this->deliveryData($fixture, 'receipt-baseline-required', 2345));

        $this->expectException(RuntimeException::class);
        $this->expectExceptionMessage('FUEL_COST_BASELINE_REQUIRED');
        $fixture['service']->approveDelivery($delivery, $fixture['owner_id']);
    }

    /** @test */
    public function exact_supplier_invoice_match_clears_grni_to_payable_without_second_stock_movement(): void
    {
        $fixture = $this->fixture();
        $approved = $fixture['service']->approveDelivery(
            $fixture['service']->createDelivery($this->deliveryData($fixture, 'receipt-exact-match', 2345)),
            $fixture['owner_id'],
        );
        $invoice = $fixture['service']->createSupplierInvoice([
            'supplier_id' => $fixture['supplier']->id,
            'invoice_number' => 'SUP-EXACT-1',
            'invoice_date' => '2026-08-23',
            'currency' => 'SAR',
            'created_by' => $fixture['owner_id'],
            'lines' => [[
                'fuel_product_id' => $fixture['fuel']->id,
                'quantity_liters' => '10.000',
                'value_minor' => 2345,
            ]],
        ]);
        $match = $fixture['service']->matchSupplierInvoiceLine($invoice, [
            'fuel_supplier_invoice_line_id' => $invoice->lines->first()->id,
            'fuel_delivery_id' => $approved->id,
            'quantity_liters' => '10.000',
            'idempotency_key' => 'match-exact-1',
        ], $fixture['owner_id']);

        $this->assertSame(FuelSupplierInvoiceMatch::STATUS_MATCHED, $match->status);
        $this->assertSame(2345, (int) $match->cleared_value_minor);
        $this->assertSame(1, StockMovement::where('source_type', FuelDelivery::class)->where('source_id', $approved->id)->count());
        $this->assertSame(10000, (int) Product::findOrFail($fixture['product']->id)->quantity_on_hand);

        $payable = Account::where('code', '2110')->firstOrFail();
        $lines = JournalLine::where('journal_entry_id', $match->journal_entry_id)->get()->keyBy('account_id');
        $this->assertSame(2345, (int) $lines[$fixture['grni']->id]->debit);
        $this->assertSame(2345, (int) $lines[$payable->id]->credit);
    }

    /** @test */
    public function value_variance_clears_only_the_safe_part_and_never_revalues_inventory_or_posts_to_5180(): void
    {
        $fixture = $this->fixture();
        $approved = $fixture['service']->approveDelivery(
            $fixture['service']->createDelivery($this->deliveryData($fixture, 'receipt-variance-match', 2345)),
            $fixture['owner_id'],
        );
        $invoice = $fixture['service']->createSupplierInvoice([
            'supplier_id' => $fixture['supplier']->id,
            'invoice_number' => 'SUP-VARIANCE-1',
            'invoice_date' => '2026-08-23',
            'currency' => 'SAR',
            'created_by' => $fixture['owner_id'],
            'lines' => [[
                'fuel_product_id' => $fixture['fuel']->id,
                'quantity_liters' => '10.000',
                'value_minor' => 2400,
            ]],
        ]);
        $match = $fixture['service']->matchSupplierInvoiceLine($invoice, [
            'fuel_supplier_invoice_line_id' => $invoice->lines->first()->id,
            'fuel_delivery_id' => $approved->id,
            'quantity_liters' => '10.000',
            'idempotency_key' => 'match-variance-1',
        ], $fixture['owner_id']);

        $this->assertSame(FuelSupplierInvoiceMatch::STATUS_VALUE_VARIANCE_PENDING, $match->status);
        $this->assertSame(55, (int) $match->value_variance_minor);
        $this->assertSame(2345, (int) $match->cleared_value_minor);
        $this->assertSame(2345, (int) FuelInventoryCostState::where('warehouse_id', $fixture['warehouse']->id)->value('cost_pool_minor'));
        $this->assertSame(0, JournalLine::whereHas('account', fn ($query) => $query->where('code', '5180'))->where('journal_entry_id', $match->journal_entry_id)->count());
    }

    /** @test */
    public function rational_cost_basis_carries_fractional_halala_deterministically_until_full_depletion(): void
    {
        $fixture = $this->fixture();
        $approved = $fixture['service']->approveDelivery(
            $fixture['service']->createDelivery($this->deliveryData($fixture, 'receipt-remainder', 2345)),
            $fixture['owner_id'],
        );
        $basis = app(FuelCostBasisService::class);
        $firstQuote = $basis->quoteIssue($fixture['fuel'], $fixture['warehouse'], 1);
        $this->assertSame(0, $firstQuote['posted_cost_minor']);
        $this->assertSame('469', $firstQuote['remainder_numerator']);
        $this->assertSame('2000', $firstQuote['remainder_denominator']);
        $firstMovement = app(InventoryService::class)->applyIssue($fixture['product']->fresh(), 1, 0, ['warehouse_id' => $fixture['warehouse']->id]);
        $basis->recordIssue($fixture['fuel'], $fixture['warehouse'], $firstMovement, 1, 0);

        $finalQuote = $basis->quoteIssue($fixture['fuel'], $fixture['warehouse'], 9999);
        $this->assertSame(2345, $finalQuote['posted_cost_minor']);
        $finalMovement = app(InventoryService::class)->applyIssue($fixture['product']->fresh(), 9999, 0, ['warehouse_id' => $fixture['warehouse']->id], 2345);
        $basis->recordIssue($fixture['fuel'], $fixture['warehouse'], $finalMovement, 9999, 2345);

        $state = FuelInventoryCostState::where('warehouse_id', $fixture['warehouse']->id)->where('fuel_product_id', $fixture['fuel']->id)->firstOrFail();
        $this->assertSame(0, (int) $state->quantity_milliliters);
        $this->assertSame(0, (int) $state->cost_pool_minor);
        $this->assertSame('0', (string) $state->carry_remainder_numerator);
        $this->assertSame($approved->stock_movement_id, StockMovement::whereKey($approved->stock_movement_id)->value('id'));
    }

    /** @test */
    public function multiple_exactly_priced_receipts_keep_a_rational_cost_pool_without_rounding_their_average(): void
    {
        $fixture = $this->fixture();
        $first = $fixture['service']->approveDelivery(
            $fixture['service']->createDelivery($this->deliveryData($fixture, 'receipt-166', 1660)),
            $fixture['owner_id'],
        );
        $secondData = $this->deliveryData($fixture, 'receipt-168', 1680);
        $secondData['delivery_note_number'] = 'DN-RECEIPT-168';
        $second = $fixture['service']->approveDelivery($fixture['service']->createDelivery($secondData), $fixture['owner_id']);

        $state = FuelInventoryCostState::where('warehouse_id', $fixture['warehouse']->id)->where('fuel_product_id', $fixture['fuel']->id)->firstOrFail();
        $this->assertSame(20000, (int) $state->quantity_milliliters);
        $this->assertSame(3340, (int) $state->cost_pool_minor);
        $quote = app(FuelCostBasisService::class)->quoteIssue($fixture['fuel'], $fixture['warehouse'], 10000);
        $this->assertSame(1670, $quote['posted_cost_minor']);
        $this->assertNotSame($first->stock_movement_id, $second->stock_movement_id);
    }

    /** @return array{service:FuelSupplyReceivingService, station:FuelStation, tank:FuelTank, fuel:FuelProduct, product:Product, warehouse:Warehouse, supplier:Partner, grni:Account, owner_id:string} */
    private function fixture(bool $configureGrni = true): array
    {
        $auth = $this->registerTenant();
        app(TenantContext::class)->set($auth['tenant_id']);
        $branch = Branch::where('is_main', true)->firstOrFail();
        $warehouse = Warehouse::where('is_default', true)->firstOrFail();
        $productId = $this->withToken($auth['token'])->postJson('/api/products', [
            'name' => 'وقود Cycle 3 mL',
            'type' => 'good',
            'unit' => 'mL',
            'sale_price' => 1000,
            'purchase_price' => 10,
            'track_inventory' => true,
        ])->assertCreated()['data']['id'];
        $product = Product::findOrFail($productId);
        $station = FuelStation::create([
            'branch_id' => $branch->id,
            'warehouse_id' => $warehouse->id,
            'code' => 'FS-C3',
            'name' => 'محطة استلام Cycle 3',
        ]);
        $fuel = FuelProduct::create(['product_id' => $product->id, 'code' => 'F-C3', 'name' => 'وقود Cycle 3']);
        $tank = FuelTank::create([
            'branch_id' => $branch->id,
            'fuel_station_id' => $station->id,
            'fuel_product_id' => $fuel->id,
            'code' => 'T-C3',
            'name' => 'خزان استلام Cycle 3',
            'capacity_milliliters' => 200000,
            'safe_capacity_milliliters' => 190000,
        ]);
        $supplier = Partner::create([
            'branch_id' => $branch->id,
            'type' => 'supplier',
            'name' => 'مورد الوقود Cycle 3',
            'is_active' => true,
        ]);
        $grni = Account::create([
            'code' => '2199',
            'name' => 'مخزون مستلم غير مفوتر',
            'type' => 'liability',
            'normal_balance' => 'credit',
            'is_group' => false,
            'is_active' => true,
        ]);
        $ownerId = User::query()->value('id');
        $this->assertNotNull($ownerId);
        if ($configureGrni) {
            app(FuelStationSettingsService::class)->putTenant(['grni_account_id' => $grni->id], User::findOrFail($ownerId), 'تهيئة GRNI للاختبار');
        }

        return compact('station', 'tank', 'fuel', 'product', 'warehouse', 'supplier', 'grni', 'ownerId') + [
            'owner_id' => $ownerId,
            'service' => app(FuelSupplyReceivingService::class),
        ];
    }

    /** @param array<string, mixed> $fixture @return array<string, mixed> */
    private function deliveryData(array $fixture, string $idempotencyKey, int $totalCost): array
    {
        return [
            'fuel_station_id' => $fixture['station']->id,
            'fuel_tank_id' => $fixture['tank']->id,
            'fuel_product_id' => $fixture['fuel']->id,
            'warehouse_id' => $fixture['warehouse']->id,
            'supplier_id' => $fixture['supplier']->id,
            'dispatched_liters' => '10.000',
            'received_liters' => '10.000',
            'received_total_cost_minor' => $totalCost,
            'delivery_note_number' => "DN-{$idempotencyKey}",
            'idempotency_key' => $idempotencyKey,
            'received_at' => '2026-08-23 10:00:00',
            'created_by' => $fixture['owner_id'],
        ];
    }
}
