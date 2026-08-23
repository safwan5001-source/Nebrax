<?php

namespace Tests\Feature;

use App\Models\Branch;
use App\Models\CorporateFuelContract;
use App\Models\FuelAviAuthorization;
use App\Models\FuelAviIdentityTag;
use App\Models\FuelFleetDriver;
use App\Models\FuelFleetVehicle;
use App\Models\FuelNozzle;
use App\Models\FuelProduct;
use App\Models\FuelPump;
use App\Models\FuelStation;
use App\Models\FuelStationProductPrice;
use App\Models\FuelTank;
use App\Models\Partner;
use App\Models\Product;
use App\Models\Tenant;
use App\Models\User;
use App\Models\Warehouse;
use App\Services\Accounting\InventoryService;
use App\Services\CorporateFuelContractService;
use App\Services\FuelAviAuthorizationService;
use App\Services\FuelAviIdentityTagService;
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

class FuelAviRfidServiceTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    /** @test */
    public function approved_vehicle_identity_is_auditable_and_can_feed_the_existing_sale_invoice_and_cogs_flow_once(): void
    {
        $fixture = $this->fixture('approved');
        $tags = app(FuelAviIdentityTagService::class);
        $tag = $tags->create([
            'public_identifier' => 'VEH-APPROVED-01',
            'credential' => 'vehicle-rfid-approved-01',
            'identity_type' => FuelAviIdentityTag::TYPE_VEHICLE_RFID,
            'partner_id' => $fixture['customer']->id,
            'corporate_fuel_contract_id' => $fixture['contract']->id,
            'fuel_fleet_vehicle_id' => $fixture['vehicle']->id,
            'effective_from' => now()->subMinute()->toIso8601String(),
            'reason' => 'ربط وسم مركبة اختبار',
        ], $fixture['actor']);

        $avi = app(FuelAviAuthorizationService::class);
        $authorization = $avi->authorize($this->authorizationPayload($fixture, 'vehicle-rfid-approved-01', 'approved-auth'), $fixture['actor']);
        $this->assertTrue($authorization->isApproved());
        $this->assertSame($tag->id, $authorization->vehicle_identity_tag_id);
        $this->assertNull($authorization->reason_code);
        $this->assertSame(0, \App\Models\Invoice::count());
        $this->assertSame(1, \App\Models\StockMovement::count(), 'يبقى أثر رصيد الاختبار وحده؛ قرار AVI لا ينشئ حركة.');

        $same = $avi->authorize($this->authorizationPayload($fixture, 'vehicle-rfid-approved-01', 'approved-auth'), $fixture['actor']);
        $this->assertSame($authorization->id, $same->id, 'يعيد مفتاح idempotency القرار ذاته عند نفس الحمولة.');

        $shift = app(FuelShiftService::class)->open([
            'fuel_station_id' => $fixture['station']->id,
            'opening_float_minor' => 0,
            'idempotency_key' => 'avi-approved-shift',
        ], $fixture['actor']);
        $sale = app(FuelSaleService::class)->createDraft([
            'fuel_station_id' => $fixture['station']->id,
            'fuel_nozzle_id' => $fixture['nozzle']->id,
            'fuel_shift_id' => $shift->id,
            'fuel_avi_authorization_id' => $authorization->id,
            'quantity_milliliters' => 1000,
            'idempotency_key' => 'avi-approved-sale',
        ], $fixture['actor']);
        $this->assertSame($fixture['customer']->id, $sale->partner_id);
        $this->assertSame($fixture['contract']->id, $sale->corporate_fuel_contract_id);
        $this->assertSame($authorization->id, $sale->fuel_avi_authorization_id);
        $this->assertSame($sale->id, $authorization->fresh()->fuel_sale_id);

        $final = app(FuelSaleService::class)->finalize($sale, $fixture['actor']);
        $this->assertNotNull($final->invoice_id);
        $this->assertNotNull($final->stock_movement_id);
        $this->assertSame($final->id, $authorization->fresh()->fuel_sale_id);
        $this->assertNotNull($authorization->fresh()->finalization_checked_at);
        $this->assertSame(1, \App\Models\Invoice::count());
        $this->assertSame(2, \App\Models\StockMovement::count(), 'يبقى الرصيد الافتتاحي وتضاف حركة البيع الرسمية الوحيدة بعد الإنهاء.');
    }

    /** @test */
    public function the_engine_records_explicit_denials_for_dual_identity_blacklist_and_capacity_without_creating_official_effects(): void
    {
        $fixture = $this->fixture('denials');
        $tags = app(FuelAviIdentityTagService::class);
        $vehicleTag = $tags->create([
            'public_identifier' => 'VEH-DENY-01',
            'credential' => 'vehicle-rfid-deny-01',
            'identity_type' => FuelAviIdentityTag::TYPE_VEHICLE_RFID,
            'partner_id' => $fixture['customer']->id,
            'corporate_fuel_contract_id' => $fixture['contract']->id,
            'fuel_fleet_vehicle_id' => $fixture['vehicle']->id,
            'effective_from' => now()->subMinute()->toIso8601String(),
        ], $fixture['actor']);

        app(FuelStationSettingsService::class)->putStationValues($fixture['station'], [
            'avi_driver_identity_required' => true,
        ], $fixture['actor'], 'فرض هوية السائق في الاختبار');
        $avi = app(FuelAviAuthorizationService::class);
        $dualDenied = $avi->authorize($this->authorizationPayload($fixture, 'vehicle-rfid-deny-01', 'dual-denied'), $fixture['actor']);
        $this->assertSame(FuelAviAuthorization::DECISION_DENIED, $dualDenied->decision);
        $this->assertSame('AVI_DUAL_IDENTITY_REQUIRED', $dualDenied->reason_code);

        $driverTag = $tags->create([
            'public_identifier' => 'DRIVER-DENY-01',
            'credential' => 'driver-card-deny-01',
            'identity_type' => FuelAviIdentityTag::TYPE_DRIVER_CARD,
            'partner_id' => $fixture['customer']->id,
            'corporate_fuel_contract_id' => $fixture['contract']->id,
            'fuel_fleet_driver_id' => $fixture['driver']->id,
            'effective_from' => now()->subMinute()->toIso8601String(),
        ], $fixture['actor']);
        $tags->update($vehicleTag, ['status' => FuelAviIdentityTag::STATUS_BLACKLISTED], $fixture['actor']);
        $blacklisted = $avi->authorize($this->authorizationPayload($fixture, 'vehicle-rfid-deny-01', 'blacklisted', ['driver_credential' => 'driver-card-deny-01']), $fixture['actor']);
        $this->assertSame('AVI_TAG_BLACKLISTED', $blacklisted->reason_code);

        $tags->update($vehicleTag, ['status' => FuelAviIdentityTag::STATUS_ACTIVE], $fixture['actor']);
        $capacity = $avi->authorize($this->authorizationPayload($fixture, 'vehicle-rfid-deny-01', 'capacity-denied', [
            'driver_credential' => 'driver-card-deny-01',
            'quantity_milliliters' => 6001,
        ]), $fixture['actor']);
        $this->assertSame('AVI_VEHICLE_CAPACITY_EXCEEDED', $capacity->reason_code);
        $this->assertContains('quantity_exceeds_vehicle_capacity', $capacity->suspicion_signals);
        $this->assertSame(0, \App\Models\Invoice::count());
        $this->assertSame(1, \App\Models\StockMovement::count(), 'يبقى أثر رصيد الاختبار وحده؛ قرار AVI لا ينشئ حركة.');
    }

    /** @test */
    public function an_authorization_cannot_be_reused_or_overridden_by_client_references(): void
    {
        $fixture = $this->fixture('reuse');
        $tag = app(FuelAviIdentityTagService::class)->create([
            'public_identifier' => 'VEH-REUSE-01',
            'credential' => 'vehicle-rfid-reuse-01',
            'identity_type' => FuelAviIdentityTag::TYPE_VEHICLE_RFID,
            'partner_id' => $fixture['customer']->id,
            'corporate_fuel_contract_id' => $fixture['contract']->id,
            'fuel_fleet_vehicle_id' => $fixture['vehicle']->id,
            'effective_from' => now()->subMinute()->toIso8601String(),
        ], $fixture['actor']);
        $authorization = app(FuelAviAuthorizationService::class)->authorize($this->authorizationPayload($fixture, 'vehicle-rfid-reuse-01', 'reuse-auth'), $fixture['actor']);
        $sale = app(FuelSaleService::class)->createDraft([
            'fuel_station_id' => $fixture['station']->id,
            'fuel_nozzle_id' => $fixture['nozzle']->id,
            'fuel_avi_authorization_id' => $authorization->id,
            'quantity_milliliters' => 1000,
            'idempotency_key' => 'reuse-first-sale',
        ], $fixture['actor']);
        $this->assertSame($tag->id, $authorization->vehicle_identity_tag_id);

        try {
            app(FuelSaleService::class)->createDraft([
                'fuel_station_id' => $fixture['station']->id,
                'fuel_nozzle_id' => $fixture['nozzle']->id,
                'fuel_avi_authorization_id' => $authorization->id,
                'partner_id' => '00000000-0000-0000-0000-000000000000',
                'quantity_milliliters' => 1000,
                'idempotency_key' => 'reuse-second-sale',
            ], $fixture['actor']);
            $this->fail('لا يجوز إعادة استخدام قرار التفويض أو تبديل مراجعه من العميل.');
        } catch (RuntimeException $exception) {
            $this->assertContains($exception->getMessage(), ['AVI_AUTHORIZATION_ALREADY_USED', 'AVI_AUTHORIZATION_REFERENCE_OVERRIDE']);
        }
        $this->assertSame($sale->id, $authorization->fresh()->fuel_sale_id);
    }

    /** @return array<string,mixed> */
    private function fixture(string $suffix): array
    {
        $auth = $this->registerTenant('fuel-avi-' . $suffix, "fuel-avi-{$suffix}@example.test");
        app(TenantContext::class)->set($auth['tenant_id']);
        Tenant::findOrFail($auth['tenant_id'])->update(['country' => 'SA']);
        $branch = Branch::where('tenant_id', $auth['tenant_id'])->sole();
        app(BranchContext::class)->set($branch->id);
        $actor = User::where('tenant_id', $auth['tenant_id'])->where('role', 'owner')->sole();
        $warehouse = Warehouse::where('tenant_id', $auth['tenant_id'])->where('branch_id', $branch->id)->sole();
        $customer = Partner::create(['tenant_id' => $auth['tenant_id'], 'branch_id' => $branch->id, 'name' => 'عميل AVI', 'type' => 'customer']);
        $product = Product::create(['tenant_id' => $auth['tenant_id'], 'branch_id' => $branch->id, 'sku' => 'AVI-' . $suffix, 'name' => 'بنزين AVI', 'unit' => 'mL', 'track_inventory' => true]);
        $fuelProduct = FuelProduct::create(['tenant_id' => $auth['tenant_id'], 'product_id' => $product->id, 'code' => 'AVI-' . $suffix, 'name' => 'بنزين AVI']);
        $station = FuelStation::create(['tenant_id' => $auth['tenant_id'], 'branch_id' => $branch->id, 'warehouse_id' => $warehouse->id, 'code' => 'AVI-ST-' . $suffix, 'name' => 'محطة AVI']);
        $tank = FuelTank::create(['tenant_id' => $auth['tenant_id'], 'branch_id' => $branch->id, 'fuel_station_id' => $station->id, 'fuel_product_id' => $fuelProduct->id, 'code' => 'AVI-TN-' . $suffix, 'name' => 'خزان AVI', 'capacity_milliliters' => 1000000, 'safe_capacity_milliliters' => 900000]);
        $pump = FuelPump::create(['tenant_id' => $auth['tenant_id'], 'branch_id' => $branch->id, 'fuel_station_id' => $station->id, 'pump_number' => 'AVI-P-' . $suffix]);
        $nozzle = FuelNozzle::create(['tenant_id' => $auth['tenant_id'], 'branch_id' => $branch->id, 'fuel_station_id' => $station->id, 'fuel_pump_id' => $pump->id, 'fuel_tank_id' => $tank->id, 'fuel_product_id' => $fuelProduct->id, 'nozzle_number' => 'AVI-N-' . $suffix]);
        app(FuelStationSettingsService::class)->putStationValues($station, [
            'corporate_credit_enabled' => true,
            'fuel_price_tax_mode' => 'tax_inclusive',
            'avi_rfid_enabled' => true,
            'shift_opening_meter_reading_required' => false,
            'shift_opening_tank_reading_required' => false,
            'shift_closing_meter_reading_required' => false,
            'shift_closing_tank_reading_required' => false,
            'shift_mandatory_staff_assignment' => false,
            'shift_supervisor_approval_required' => false,
        ], $actor, 'تهيئة Cycle 7');
        app(FuelStationProductPriceService::class)->create([
            'fuel_station_id' => $station->id,
            'fuel_product_id' => $fuelProduct->id,
            'price_per_liter_minor' => 200,
            'effective_from' => now()->subMinute()->toIso8601String(),
        ], $actor);
        $contract = app(CorporateFuelContractService::class)->create([
            'partner_id' => $customer->id,
            'effective_from' => now()->subMinute()->toIso8601String(),
            'credit_limit_minor' => 1000000,
            'payment_terms_days' => 15,
            'station_restriction_mode' => 'selected',
            'station_ids' => [$station->id],
            'fuel_restriction_mode' => 'selected',
            'fuel_product_ids' => [$fuelProduct->id],
        ], $actor);
        $contract = app(CorporateFuelContractService::class)->activate($contract, $actor, 'اعتماد عقد AVI');
        $vehicle = FuelFleetVehicle::create([
            'tenant_id' => $auth['tenant_id'], 'partner_id' => $customer->id, 'corporate_fuel_contract_id' => $contract->id,
            'plate_number' => 'AVI-' . $suffix, 'tank_capacity_milliliters' => 6000, 'status' => FuelFleetVehicle::STATUS_ACTIVE,
        ]);
        $driver = FuelFleetDriver::create([
            'tenant_id' => $auth['tenant_id'], 'partner_id' => $customer->id, 'corporate_fuel_contract_id' => $contract->id,
            'name' => 'سائق AVI', 'identifier' => 'DRV-' . $suffix, 'status' => FuelFleetDriver::STATUS_ACTIVE,
        ]);
        app(FuelCostBasisService::class)->assertReady($fuelProduct, $warehouse);
        $movement = app(InventoryService::class)->applyReceipt($product, 20000, 100, ['warehouse_id' => $warehouse->id, 'source_type' => FuelProduct::class, 'source_id' => $fuelProduct->id], 2000000);
        app(FuelCostBasisService::class)->recordReceipt($fuelProduct, $warehouse, $movement, 20000, 2000000);

        return compact('actor', 'branch', 'warehouse', 'customer', 'product', 'fuelProduct', 'station', 'tank', 'pump', 'nozzle', 'contract', 'vehicle', 'driver');
    }

    /** @param array<string,mixed> $overrides @return array<string,mixed> */
    private function authorizationPayload(array $fixture, string $vehicleCredential, string $idempotencyKey, array $overrides = []): array
    {
        return array_merge([
            'fuel_station_id' => $fixture['station']->id,
            'fuel_nozzle_id' => $fixture['nozzle']->id,
            'vehicle_credential' => $vehicleCredential,
            'quantity_milliliters' => 1000,
            'idempotency_key' => $idempotencyKey,
        ], $overrides);
    }
}
