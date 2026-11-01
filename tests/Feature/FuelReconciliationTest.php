<?php

namespace Tests\Feature;

use App\Models\Account;
use App\Models\Branch;
use App\Models\FuelInventoryCostState;
use App\Models\FuelOperationalLedger;
use App\Models\FuelStation;
use App\Models\FuelStationConfigurationEvent;
use App\Models\FuelTank;
use App\Models\JournalLine;
use App\Models\Product;
use App\Models\User;
use App\Models\Warehouse;
use App\Services\Accounting\AccountRoutingService;
use App\Services\Accounting\InventoryService;
use App\Services\FuelCostBasisService;
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
    use CapturesThrowable;

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
        Product::findOrFail($fixture['product_id'])->update(['avg_cost' => 999]);
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
        $this->assertCount(2, $lines); // لا GRNI ولا دائن المورد في زيادة الجرد.
        $this->assertSame(100000, (int) $approved->financial_variance_minor);
        $state = FuelInventoryCostState::where('warehouse_id', $fixture['warehouse']->id)->firstOrFail();
        $this->assertSame(110000, (int) $state->quantity_milliliters);
        $this->assertSame(1100000, (int) $state->cost_pool_minor);
    }

    /** @test */
    public function inventory_gain_from_zero_stock_requires_a_trusted_fuel_cost_basis(): void
    {
        $fixture = $this->fixture(assignWarehouse: true, openingQuantity: 0);
        $reading = $fixture['service']->recordReading([
            'fuel_station_id' => $fixture['station']->id,
            'fuel_tank_id' => $fixture['tank']->id,
            'reading_type' => 'physical',
            'quantity_liters' => '1.000',
            'evidence_key' => 'physical-zero-gain-1',
            'recorded_by' => $fixture['owner_id'],
        ]);
        $draft = $fixture['service']->createDraft([
            'fuel_station_id' => $fixture['station']->id,
            'fuel_tank_id' => $fixture['tank']->id,
            'physical_reading_id' => $reading->id,
            'created_by' => $fixture['owner_id'],
        ]);

        $this->expectException(RuntimeException::class);
        $this->expectExceptionMessage('FUEL_GAIN_COST_BASIS_REQUIRED');
        $fixture['service']->approve($draft, $fixture['owner_id']);
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

    /** @test FS-01: خزانان لمنتج واحد — قراءة خزان صحيحة لا تُنتج فقداً كاذباً بل تُرفض. */
    public function a_second_tank_of_the_same_product_makes_reconciliation_fail_closed_instead_of_fabricating_a_loss(): void
    {
        $fixture = $this->fixture(); // 100 ل في المخزن
        $second = $this->secondTank($fixture, 'T-R2');
        // الخزانان 50 ل لكل منهما؛ قراءة الخزان الأول صحيحة 50 ل لكن الدفتر يقارنها بـ100 ل.
        $reading = $this->physicalReading($fixture, $fixture['tank'], '50.000', 'fs01-multi-1');

        $exception = $this->thrown(fn () => $fixture['service']->createDraft([
            'fuel_station_id' => $fixture['station']->id,
            'fuel_tank_id' => $fixture['tank']->id,
            'physical_reading_id' => $reading->id,
            'created_by' => $fixture['owner_id'],
        ]), 'كان يجب رفض تسوية خزان واحد مقابل رصيد مخزن يغذّيه أكثر من خزان.');
        $this->assertStringContainsString('FUEL_RECONCILIATION_MULTI_TANK_UNSUPPORTED', $exception->getMessage());

        $this->assertSame(0, \App\Models\FuelReconciliation::count());
        $this->assertSame(100000, (int) Product::findOrFail($fixture['product_id'])->quantity_on_hand);
        $this->assertNotNull($second->id);
    }

    /** @test FS-01: الخزان المعطّل لا يحجب التسوية (محطة بخزان فعّال وحيد). */
    public function an_inactive_second_tank_does_not_block_reconciliation(): void
    {
        $fixture = $this->fixture();
        $this->secondTank($fixture, 'T-OLD', 'inactive');
        $reading = $this->physicalReading($fixture, $fixture['tank'], '100.000', 'fs01-inactive-1');

        $draft = $fixture['service']->createDraft([
            'fuel_station_id' => $fixture['station']->id,
            'fuel_tank_id' => $fixture['tank']->id,
            'physical_reading_id' => $reading->id,
            'created_by' => $fixture['owner_id'],
        ]);

        $this->assertSame(0, $draft->variance_milliliters);
    }

    /** @test FS-01: خزان لمنتج وقود آخر (ديزل مقابل بنزين) لا يحجب — الكتاب مفصول بالمنتج. */
    public function a_tank_of_a_different_fuel_product_does_not_block_reconciliation(): void
    {
        $fixture = $this->fixture();
        $otherProductId = $this->withToken($fixture['token'])->postJson('/api/products', [
            'name' => 'ديزل mL', 'type' => 'good', 'unit' => 'mL',
            'sale_price' => 1000, 'purchase_price' => 10, 'track_inventory' => true,
        ])->assertCreated()['data']['id'];
        $otherFuel = \App\Models\FuelProduct::create(['product_id' => $otherProductId, 'code' => 'F-DSL', 'name' => 'ديزل']);
        $this->secondTank($fixture, 'T-DSL', 'active', $otherFuel->id);
        $reading = $this->physicalReading($fixture, $fixture['tank'], '90.000', 'fs01-other-product-1');

        $draft = $fixture['service']->createDraft([
            'fuel_station_id' => $fixture['station']->id,
            'fuel_tank_id' => $fixture['tank']->id,
            'physical_reading_id' => $reading->id,
            'created_by' => $fixture['owner_id'],
        ]);

        $this->assertSame(-10000, $draft->variance_milliliters);
    }

    /** @test FS-01: خزان يُضاف بعد المسودة يمنع الاعتماد دون أي أثر مخزني أو محاسبي. */
    public function a_tank_added_after_the_draft_blocks_approval_with_no_stock_or_ledger_effect(): void
    {
        $fixture = $this->fixture();
        $reading = $this->physicalReading($fixture, $fixture['tank'], '90.000', 'fs01-late-tank-1');
        $draft = $fixture['service']->createDraft([
            'fuel_station_id' => $fixture['station']->id,
            'fuel_tank_id' => $fixture['tank']->id,
            'physical_reading_id' => $reading->id,
            'created_by' => $fixture['owner_id'],
        ]);
        $this->secondTank($fixture, 'T-LATE');
        $entries = \App\Models\JournalEntry::count();
        $movements = \App\Models\StockMovement::count();

        $exception = $this->thrown(fn () => $fixture['service']->approve($draft, $fixture['owner_id']), 'كان يجب رفض الاعتماد بعد إضافة خزان ثانٍ لنفس الكتاب.');
        $this->assertStringContainsString('FUEL_RECONCILIATION_MULTI_TANK_UNSUPPORTED', $exception->getMessage());

        $this->assertSame('draft', $draft->fresh()->status);
        $this->assertSame($entries, \App\Models\JournalEntry::count());
        $this->assertSame($movements, \App\Models\StockMovement::count());
        $this->assertSame(100000, (int) Product::findOrFail($fixture['product_id'])->quantity_on_hand);
    }

    /** @test FS-32: سطور قيد التسوية تأخذ فرع المحطة لا فرع سياق الموافق. */
    public function reconciliation_journal_lines_carry_the_station_branch_not_the_approvers_active_branch(): void
    {
        $fixture = $this->fixture();
        $other = Branch::create(['code' => 'BR-OTHER', 'name' => 'فرع آخر']);
        $reading = $this->physicalReading($fixture, $fixture['tank'], '90.000', 'fs32-branch-1');
        $draft = $fixture['service']->createDraft([
            'fuel_station_id' => $fixture['station']->id,
            'fuel_tank_id' => $fixture['tank']->id,
            'physical_reading_id' => $reading->id,
            'created_by' => $fixture['owner_id'],
        ]);

        $context = app(\App\Tenancy\BranchContext::class);
        $context->set($other->id); // الموافق يعمل ضمن فرع آخر
        try {
            $approved = $fixture['service']->approve($draft, $fixture['owner_id']);
        } finally {
            $context->forget();
        }

        $lines = JournalLine::where('journal_entry_id', $approved->journal_entry_id)->get();
        $this->assertCount(2, $lines);
        foreach ($lines as $line) {
            $this->assertSame($fixture['station']->branch_id, $line->branch_id);
        }
        $this->assertSame($fixture['station']->branch_id, \App\Models\StockMovement::findOrFail($approved->stock_movement_id)->branch_id);
    }

    /** @test FS-34: قيد فقد التسوية يتبع دورَي inventory_count_variance وinventory_asset لا 5180/1140. */
    public function reconciliation_loss_follows_the_variance_and_inventory_roles(): void
    {
        $fixture = $this->fixture();
        $variance = Account::create(['code' => '5198', 'name' => 'فروق جرد بديلة', 'type' => 'expense', 'normal_balance' => 'debit', 'is_group' => false, 'is_active' => true]);
        $inventory = Account::create(['code' => '1199', 'name' => 'مخزون بديل', 'type' => 'asset', 'normal_balance' => 'debit', 'is_group' => false, 'is_active' => true]);
        $routing = app(AccountRoutingService::class);
        $routing->setMapping('inventory_count_variance', $variance->id, null);
        $routing->setMapping('inventory_asset', $inventory->id, null);
        $reading = $this->physicalReading($fixture, $fixture['tank'], '90.000', 'fs34-role-1');
        $approved = $fixture['service']->approve($fixture['service']->createDraft([
            'fuel_station_id' => $fixture['station']->id, 'fuel_tank_id' => $fixture['tank']->id,
            'physical_reading_id' => $reading->id, 'created_by' => $fixture['owner_id'],
        ]), $fixture['owner_id']);

        $lines = JournalLine::where('journal_entry_id', $approved->journal_entry_id)->get()->keyBy('account_id');
        $this->assertCount(2, $lines);
        $this->assertSame(100000, (int) $lines[$variance->id]->debit);
        $this->assertSame(100000, (int) $lines[$inventory->id]->credit);
    }

    /** @return array{service: FuelReconciliationService, station: FuelStation, tank: FuelTank, warehouse: Warehouse|null, branch: Branch, product_id: string, owner_id: string, token: string} */
    private function fixture(bool $assignWarehouse = true, int $openingQuantity = 100000): array
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
            $costBasis = app(FuelCostBasisService::class);
            // مسار الاستلام الحقيقي يهيئ state صفرياً قبل تحديث رصيد المخزن.
            $costBasis->assertReady($fuel, $warehouse);
            if ($openingQuantity > 0) {
                $openingMovement = app(InventoryService::class)->applyReceipt($product, $openingQuantity, 10, ['warehouse_id' => $warehouse->id]);
                // fixture موثوق: يثبت cost basis صريحاً بدلاً من اشتقاقه من avg_cost أثناء الاختبار.
                $costBasis->recordReceipt($fuel, $warehouse, $openingMovement, $openingQuantity, $openingQuantity * 10);
            }
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
            'token' => $auth['token'],
        ];
    }

    private function secondTank(array $fixture, string $code, string $status = 'active', ?string $fuelProductId = null): FuelTank
    {
        return FuelTank::create([
            'branch_id' => $fixture['branch']->id,
            'fuel_station_id' => $fixture['station']->id,
            'fuel_product_id' => $fuelProductId ?? $fixture['tank']->fuel_product_id,
            'code' => $code,
            'name' => 'خزان إضافي ' . $code,
            'capacity_milliliters' => 200000,
            'safe_capacity_milliliters' => 190000,
            'status' => $status,
        ]);
    }

    private function physicalReading(array $fixture, FuelTank $tank, string $liters, string $key): \App\Models\FuelTankReading
    {
        return $fixture['service']->recordReading([
            'fuel_station_id' => $fixture['station']->id,
            'fuel_tank_id' => $tank->id,
            'reading_type' => 'physical',
            'quantity_liters' => $liters,
            'evidence_key' => $key,
            'recorded_by' => $fixture['owner_id'],
        ]);
    }
}
