<?php

namespace Tests\Feature;

use App\Models\Account;
use App\Models\Branch;
use App\Models\FuelOperationalLedger;
use App\Models\FuelStation;
use App\Models\FuelStationConfigurationEvent;
use App\Models\FuelTank;
use App\Models\JournalLine;
use App\Models\Product;
use App\Models\User;
use App\Models\Warehouse;
use App\Services\Accounting\InventoryService;
use App\Services\FuelQuantity;
use App\Services\FuelReconciliationService;
use App\Services\FuelStationMasterDataService;
use App\Services\FuelStationSettingsService;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use LogicException;
use RuntimeException;
use Tests\TestCase;

class FuelReconciliationTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    /** @test */
    public function fuel_quantity_conversion_is_exact_without_rounding(): void
    {
        $quantity = app(FuelQuantity::class);
        $this->assertSame(1, $quantity->litersToMilliliters('0.001'));
        $this->assertSame(750, $quantity->litersToMilliliters('0.75'));
        $this->assertSame(10125, $quantity->litersToMilliliters('10.125'));
        $this->assertSame(30000500, $quantity->litersToMilliliters('30000.500'));
        $this->expectException(RuntimeException::class);
        $quantity->litersToMilliliters('0.0001');
    }

    /** @test */
    public function physical_evidence_is_separate_until_explicit_approval_then_creates_stock_movement_ledger_and_balanced_loss_entry(): void
    {
        $fixture = $this->fixture();
        $service = $fixture['service'];
        $reading = $service->recordReading([
            'fuel_station_id' => $fixture['station']->id,
            'fuel_tank_id' => $fixture['tank']->id,
            'reading_type' => 'physical',
            'quantity_liters' => '90.000',
            'evidence_key' => 'physical-r-1',
            'recorded_by' => $fixture['owner_id'],
        ]);
        $this->assertSame(100000, (int) Product::findOrFail($fixture['product_id'])->quantity_on_hand);

        $draft = $service->createDraft([
            'fuel_station_id' => $fixture['station']->id,
            'fuel_tank_id' => $fixture['tank']->id,
            'physical_reading_id' => $reading->id,
            'created_by' => $fixture['owner_id'],
            'reason' => 'فقد مقاس',
        ]);
        $this->assertSame(-10000, $draft->variance_milliliters);
        $this->assertNull($draft->stock_movement_id);
        $approved = $service->approve($draft, $fixture['owner_id'], 'اعتماد الفقد');

        $this->assertSame('approved', $approved->status);
        $this->assertNotNull($approved->stock_movement_id);
        $this->assertNotNull($approved->journal_entry_id);
        $this->assertSame(90000, (int) Product::findOrFail($fixture['product_id'])->quantity_on_hand);
        $ledger = FuelOperationalLedger::where('fuel_reconciliation_id', $approved->id)->firstOrFail();
        $this->assertSame($fixture['warehouse']->id, $ledger->warehouse_id);
        $this->assertSame(-10000, $ledger->quantity_milliliters);
        $this->assertSame(FuelOperationalLedger::TYPE_ADJUSTMENT_LOSS, $ledger->movement_type);

        $inventory = Account::where('code', '1140')->firstOrFail();
        $variance = Account::where('code', '5180')->firstOrFail();
        $lines = JournalLine::where('journal_entry_id', $approved->journal_entry_id)->get()->keyBy('account_id');
        $this->assertSame(100000, (int) $lines[$inventory->id]->credit);
        $this->assertSame(100000, (int) $lines[$variance->id]->debit);
    }

    /** @test */
    public function explicit_approval_of_a_surplus_uses_the_opposite_inventory_variance_direction(): void
    {
        $fixture = $this->fixture();
        $reading = $fixture['service']->recordReading([
            'fuel_station_id' => $fixture['station']->id,
            'fuel_tank_id' => $fixture['tank']->id,
            'reading_type' => 'physical',
            'quantity_liters' => '110',
            'evidence_key' => 'physical-gain-1',
            'recorded_by' => $fixture['owner_id'],
        ]);
        $approved = $fixture['service']->approve($fixture['service']->createDraft([
            'fuel_station_id' => $fixture['station']->id,
            'fuel_tank_id' => $fixture['tank']->id,
            'physical_reading_id' => $reading->id,
            'created_by' => $fixture['owner_id'],
        ]), $fixture['owner_id']);

        $this->assertSame(110000, (int) Product::findOrFail($fixture['product_id'])->quantity_on_hand);
        $ledger = FuelOperationalLedger::where('fuel_reconciliation_id', $approved->id)->firstOrFail();
        $this->assertSame(FuelOperationalLedger::TYPE_ADJUSTMENT_GAIN, $ledger->movement_type);
        $inventory = Account::where('code', '1140')->firstOrFail();
        $variance = Account::where('code', '5180')->firstOrFail();
        $lines = JournalLine::where('journal_entry_id', $approved->journal_entry_id)->get()->keyBy('account_id');
        $this->assertSame(100000, (int) $lines[$inventory->id]->debit);
        $this->assertSame(100000, (int) $lines[$variance->id]->credit);
    }

    /** @test */
    public function official_reconciliation_requires_an_explicit_station_warehouse(): void
    {
        $fixture = $this->fixture(assignWarehouse: false);

        $this->expectException(RuntimeException::class);
        $fixture['service']->createDraft([
            'fuel_station_id' => $fixture['station']->id,
            'fuel_tank_id' => $fixture['tank']->id,
            'created_by' => $fixture['owner_id'],
        ]);
    }

    /** @test */
    public function official_reconciliation_rejects_a_fuel_product_not_mapped_to_milliliters(): void
    {
        $fixture = $this->fixture();
        Product::findOrFail($fixture['product_id'])->update(['unit' => 'liter']);

        $this->expectException(RuntimeException::class);
        $fixture['service']->createDraft([
            'fuel_station_id' => $fixture['station']->id,
            'fuel_tank_id' => $fixture['tank']->id,
            'created_by' => $fixture['owner_id'],
        ]);
    }

    /** @test */
    public function source_totals_cannot_be_injected_before_delivery_sale_or_transfer_cycles_exist(): void
    {
        $fixture = $this->fixture();

        $this->expectException(RuntimeException::class);
        $fixture['service']->createDraft([
            'fuel_station_id' => $fixture['station']->id,
            'fuel_tank_id' => $fixture['tank']->id,
            'deliveries_liters' => '1',
            'created_by' => $fixture['owner_id'],
        ]);
    }

    /** @test */
    public function a_measurement_cannot_be_reused_for_a_second_reconciliation(): void
    {
        $fixture = $this->fixture();
        $reading = $fixture['service']->recordReading([
            'fuel_station_id' => $fixture['station']->id,
            'fuel_tank_id' => $fixture['tank']->id,
            'reading_type' => 'physical',
            'quantity_liters' => '100',
            'evidence_key' => 'physical-once-1',
            'recorded_by' => $fixture['owner_id'],
        ]);
        $fixture['service']->createDraft([
            'fuel_station_id' => $fixture['station']->id,
            'fuel_tank_id' => $fixture['tank']->id,
            'physical_reading_id' => $reading->id,
            'created_by' => $fixture['owner_id'],
        ]);

        $this->expectException(RuntimeException::class);
        $fixture['service']->createDraft([
            'fuel_station_id' => $fixture['station']->id,
            'fuel_tank_id' => $fixture['tank']->id,
            'physical_reading_id' => $reading->id,
            'created_by' => $fixture['owner_id'],
        ]);
    }

    /** @test */
    public function approved_reconciliation_and_operational_ledger_are_immutable(): void
    {
        $fixture = $this->fixture();
        $reading = $fixture['service']->recordReading([
            'fuel_station_id' => $fixture['station']->id,
            'fuel_tank_id' => $fixture['tank']->id,
            'reading_type' => 'physical',
            'quantity_liters' => '100',
            'evidence_key' => 'physical-immutable-1',
            'recorded_by' => $fixture['owner_id'],
        ]);
        $approved = $fixture['service']->approve($fixture['service']->createDraft([
            'fuel_station_id' => $fixture['station']->id,
            'fuel_tank_id' => $fixture['tank']->id,
            'physical_reading_id' => $reading->id,
            'created_by' => $fixture['owner_id'],
        ]), $fixture['owner_id']);

        $this->expectException(LogicException::class);
        $approved->update(['reason' => 'محاولة تعديل غير صالحة']);
    }

    /** @test */
    public function station_warehouse_cannot_change_once_it_has_operational_ledger_history(): void
    {
        $fixture = $this->fixture();
        $reading = $fixture['service']->recordReading([
            'fuel_station_id' => $fixture['station']->id,
            'fuel_tank_id' => $fixture['tank']->id,
            'reading_type' => 'physical',
            'quantity_liters' => '100',
            'evidence_key' => 'physical-warehouse-lock-1',
            'recorded_by' => $fixture['owner_id'],
        ]);
        $fixture['service']->approve($fixture['service']->createDraft([
            'fuel_station_id' => $fixture['station']->id,
            'fuel_tank_id' => $fixture['tank']->id,
            'physical_reading_id' => $reading->id,
            'created_by' => $fixture['owner_id'],
        ]), $fixture['owner_id']);
        $otherWarehouse = Warehouse::create([
            'branch_id' => $fixture['branch']->id,
            'code' => 'FUEL-SECOND',
            'name' => 'مخزن وقود ثانٍ',
            'is_active' => true,
        ]);

        $this->expectException(LogicException::class);
        $fixture['station']->update(['warehouse_id' => $otherWarehouse->id]);
    }

    /** @test */
    public function tenant_defaults_and_station_overrides_are_resolved_and_audited(): void
    {
        $fixture = $this->fixture();
        $settings = app(FuelStationSettingsService::class);
        $actor = User::findOrFail($fixture['owner_id']);
        $settings->putTenant([
            'reconciliation_tolerance_absolute_milliliters' => 500,
            'reconciliation_tolerance_basis_points' => 25,
        ], $actor, 'سياسة المستأجر');
        $settings->putStationValues($fixture['station'], [
            'reconciliation_tolerance_absolute_milliliters' => 125,
        ], $actor, 'سياسة المحطة');

        $resolved = $settings->forStation($fixture['station']);
        $this->assertSame(125, $resolved['reconciliation_tolerance_absolute_milliliters']);
        $this->assertSame(25, $resolved['reconciliation_tolerance_basis_points']);
        $this->assertSame(3, FuelStationConfigurationEvent::count());
    }

    /** @return array{service: FuelReconciliationService, station: FuelStation, tank: FuelTank, warehouse: Warehouse|null, branch: Branch, product_id: string, owner_id: string} */
    private function fixture(bool $assignWarehouse = true): array
    {
        $auth = $this->registerTenant();
        app(TenantContext::class)->set($auth['tenant_id']);
        $branch = Branch::where('is_main', true)->firstOrFail();
        $warehouse = Warehouse::where('is_default', true)->firstOrFail();
        $productId = $this->withToken($auth['token'])->postJson('/api/products', [
            'name' => 'وقود mL',
            'type' => 'good',
            'unit' => 'mL',
            'sale_price' => 1000,
            'purchase_price' => 10,
            'track_inventory' => true,
        ])->assertCreated()['data']['id'];
        $station = FuelStation::create([
            'branch_id' => $branch->id,
            'warehouse_id' => $assignWarehouse ? $warehouse->id : null,
            'code' => $assignWarehouse ? 'FS-R' : 'FS-NO-WH',
            'name' => 'محطة التسوية',
        ]);
        $fuel = \App\Models\FuelProduct::create(['product_id' => $productId, 'code' => 'F-ML', 'name' => 'وقود mL']);
        $tank = FuelTank::create([
            'branch_id' => $branch->id,
            'fuel_station_id' => $station->id,
            'fuel_product_id' => $fuel->id,
            'code' => 'T-R',
            'name' => 'خزان التسوية',
            'capacity_milliliters' => 200000,
            'safe_capacity_milliliters' => 190000,
        ]);
        $product = Product::findOrFail($productId);
        if ($assignWarehouse) {
            app(InventoryService::class)->applyReceipt($product, 100000, 10, ['warehouse_id' => $warehouse->id]);
        }
        $ownerId = User::query()->value('id');
        $this->assertNotNull($ownerId);

        return [
            'service' => app(FuelReconciliationService::class),
            'station' => $station,
            'tank' => $tank,
            'warehouse' => $assignWarehouse ? $warehouse : null,
            'branch' => $branch,
            'product_id' => $productId,
            'owner_id' => $ownerId,
        ];
    }
}
