<?php

namespace Tests\Feature;

use App\Models\Branch;
use App\Models\FuelNozzle;
use App\Models\FuelProduct;
use App\Models\FuelPump;
use App\Models\FuelSale;
use App\Models\FuelSalePaymentReceipt;
use App\Models\FuelShift;
use App\Models\FuelShiftCashMovement;
use App\Models\FuelShiftCashVariance;
use App\Models\FuelShiftEvent;
use App\Models\FuelStation;
use App\Models\FuelTank;
use App\Models\JournalEntry;
use App\Models\Partner;
use App\Models\Payment;
use App\Models\PaymentMethod;
use App\Models\Product;
use App\Models\Role;
use App\Models\Tenant;
use App\Models\User;
use App\Models\Warehouse;
use App\Services\Accounting\CashBankAccountService;
use App\Services\Accounting\InventoryService;
use App\Services\Accounting\PaymentReversalService;
use App\Services\CorporateFuelContractService;
use App\Services\EntitlementGrantService;
use App\Support\EntitlementAccessMode;
use App\Support\EntitlementSourceType;
use Carbon\CarbonImmutable;
use App\Services\FuelCostBasisService;
use App\Services\FuelSaleService;
use App\Services\FuelShiftCashExpectationService;
use App\Services\FuelShiftService;
use App\Services\FuelStationProductPriceService;
use App\Services\FuelStationSettingsService;
use App\Tenancy\BranchContext;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/**
 * #2021 — بيانات اصطناعية معزولة لمحطة وقود (مستأجر + فرع + مخزن + خزان + فوهة + رصيد + سعر + طرق دفع نقد/بنك + مشرف وبائع).
 * يستعمله اختبار الخدمة (SQLite/PostgreSQL) واختبار التزامن الحقيقي على PostgreSQL. لا بيانات محطات حقيقية.
 */
trait BuildsFuelCashFixture
{
    private const FLOAT = 20000;

    private array $f;

    /** يتوقّع رفضاً (RuntimeException) ويعيده؛ يفشل الاختبار إن نجحت العملية. */
    private function rejects(callable $operation): \Throwable
    {
        return $this->thrown($operation, 'كان يجب أن تُرفض العملية.');
    }

    private function setBasis(string $basis): void
    {
        app(FuelStationSettingsService::class)->putStationValues($this->f['station'], ['shift_expected_cash_basis' => $basis], $this->f['actor'], 'أساس النقد');
    }

    private function open(string $key, int $float = self::FLOAT): FuelShift
    {
        return app(FuelShiftService::class)->open([
            'fuel_station_id' => $this->f['station']->id, 'opening_float_minor' => $float, 'idempotency_key' => "shift-{$key}",
        ], $this->f['actor']);
    }

    private function sale(string $key, FuelShift $shift): FuelSale
    {
        $service = app(FuelSaleService::class);

        return $service->finalize($service->createDraft([
            'fuel_station_id' => $this->f['station']->id, 'fuel_nozzle_id' => $this->f['nozzle']->id, 'fuel_shift_id' => $shift->id,
            'partner_id' => $this->f['customer']->id, 'quantity_milliliters' => 1000, 'idempotency_key' => $key,
        ], $this->f['actor']), $this->f['actor']);
    }

    private function collect(FuelSale $sale, string $type, ?int $amount, string $key): Payment
    {
        $method = $type === 'cash' ? $this->f['cash'] : $this->f['bank'];

        return app(FuelSaleService::class)->collectPayment($sale->fresh(), [
            'payment_method_id' => $method->id,
            'amount_minor' => $amount ?? ((int) $sale->invoice->total - (int) $sale->invoice->fresh()->paid_amount),
            'idempotency_key' => $key,
        ], $this->f['actor']);
    }

    /** @return array<string,mixed> */
    private function handoverPayload(FuelShift $shift, int $amount, string $key): array
    {
        return [
            'type' => 'cash_out', 'amount_minor' => $amount, 'reason' => 'تسليم للخزنة', 'idempotency_key' => $key,
            'purpose' => 'treasury_handover', 'received_by_user_id' => $this->f['supervisor']->id,
            'evidence' => ['proof_reference' => 'RCPT-1'],
        ];
    }

    private function handover(FuelShift $shift, int $amount, string $key): FuelShiftCashMovement
    {
        return app(FuelShiftService::class)->recordCashMovement($shift->fresh(), $this->handoverPayload($shift, $amount, $key), $this->f['actor']);
    }

    private function corporateSale(string $key, FuelShift $shift): FuelSale
    {
        $f = $this->f;
        $contracts = app(CorporateFuelContractService::class);
        app(FuelStationSettingsService::class)->putStationValues($f['station'], ['corporate_credit_enabled' => true], $f['actor'], 'عقود');
        $contract = $contracts->create([
            'partner_id' => $f['customer']->id, 'effective_from' => now()->subMinute()->toIso8601String(), 'credit_limit_minor' => 100000000,
            'payment_terms_days' => 30, 'station_restriction_mode' => 'selected', 'station_ids' => [$f['station']->id],
            'fuel_restriction_mode' => 'selected', 'fuel_product_ids' => [$f['fuelProduct']->id], 'reason' => 'عقد اختبار',
        ], $f['actor']);
        $contract = $contracts->activate($contract, $f['actor'], 'اعتماد');
        $contracts->createPrice($contract, [
            'fuel_product_id' => $f['fuelProduct']->id, 'price_per_liter_minor' => 200, 'tax_mode' => 'tax_inclusive',
            'effective_from' => now()->subMinute()->toIso8601String(), 'reason' => 'سعر عقد',
        ], $f['actor']);
        $service = app(FuelSaleService::class);

        return $service->finalize($service->createDraft([
            'fuel_station_id' => $f['station']->id, 'fuel_nozzle_id' => $f['nozzle']->id, 'fuel_shift_id' => $shift->id,
            'partner_id' => $f['customer']->id, 'corporate_fuel_contract_id' => $contract->id, 'quantity_milliliters' => 1000,
            'idempotency_key' => $key,
        ], $f['actor']), $f['actor']);
    }

    /** @return array<string,mixed> */
    private function fixture(string $sfx = ''): array
    {
        $foreign = $this->registerTenant('fuel-cash-foreign' . $sfx, 'owner@fuel-cash-foreign' . $sfx . '.test');
        $foreignSupervisor = $this->roleUser($foreign['tenant_id'], 'foreign-sup', 'foreign-sup' . $sfx . '@x.test', ['fuel.shift.approve']);

        $auth = $this->registerTenant('fuel-cash-d1' . $sfx, 'owner@fuel-cash-d1' . $sfx . '.test');
        $tenantId = $auth['tenant_id'];
        app(TenantContext::class)->set($tenantId);
        Tenant::findOrFail($tenantId)->update(['country' => 'SA']);
        app(EntitlementGrantService::class)->grant(
            Tenant::findOrFail($tenantId), 'fuel_stations.core', EntitlementAccessMode::FULL, EntitlementSourceType::MANUAL,
            CarbonImmutable::now('UTC'), grantReasonCode: 'test_2021_cash', reason: 'اختبار نقد الوردية D1/D2/D5.',
        );
        $branch = Branch::where('tenant_id', $tenantId)->sole();
        app(BranchContext::class)->set($branch->id);
        $actor = User::where('tenant_id', $tenantId)->where('role', 'owner')->sole();
        $warehouse = Warehouse::where('tenant_id', $tenantId)->where('branch_id', $branch->id)->sole();
        $customer = Partner::create(['tenant_id' => $tenantId, 'branch_id' => $branch->id, 'name' => 'عميل بيع وقود', 'type' => 'customer']);
        $product = Product::create(['tenant_id' => $tenantId, 'branch_id' => $branch->id, 'sku' => 'FUEL-CASH-1' . $sfx, 'name' => 'بنزين اختبار نقد', 'unit' => 'mL', 'track_inventory' => true]);
        $fuelProduct = FuelProduct::create(['tenant_id' => $tenantId, 'product_id' => $product->id, 'code' => 'FC-1' . $sfx, 'name' => 'بنزين 95']);
        $station = FuelStation::create(['tenant_id' => $tenantId, 'branch_id' => $branch->id, 'warehouse_id' => $warehouse->id, 'code' => 'FCS-1' . $sfx, 'name' => 'محطة نقد اختبار']);
        $tank = FuelTank::create([
            'tenant_id' => $tenantId, 'branch_id' => $branch->id, 'fuel_station_id' => $station->id, 'fuel_product_id' => $fuelProduct->id,
            'code' => 'FCT-1' . $sfx, 'name' => 'خزان', 'capacity_milliliters' => 10000000, 'safe_capacity_milliliters' => 9000000,
        ]);
        $pump = FuelPump::create(['tenant_id' => $tenantId, 'branch_id' => $branch->id, 'fuel_station_id' => $station->id, 'pump_number' => 'FCP-1' . $sfx]);
        $nozzle = FuelNozzle::create([
            'tenant_id' => $tenantId, 'branch_id' => $branch->id, 'fuel_station_id' => $station->id, 'fuel_pump_id' => $pump->id,
            'fuel_tank_id' => $tank->id, 'fuel_product_id' => $fuelProduct->id, 'nozzle_number' => 'FCN-1' . $sfx,
        ]);
        app(FuelCostBasisService::class)->assertReady($fuelProduct, $warehouse);
        $movement = app(InventoryService::class)->applyReceipt($product, 1000000, 100, [
            'warehouse_id' => $warehouse->id, 'source_type' => FuelProduct::class, 'source_id' => $fuelProduct->id,
            'notes' => 'رصيد اختبار', InventoryService::FUEL_POOL_META => true,
        ], 100000000);
        app(FuelCostBasisService::class)->recordReceipt($fuelProduct, $warehouse, $movement, 1000000, 100000000);
        app(FuelStationProductPriceService::class)->create([
            'fuel_station_id' => $station->id, 'fuel_product_id' => $fuelProduct->id, 'price_per_liter_minor' => 230,
            'effective_from' => now()->subMinute()->toIso8601String(),
        ], $actor);

        app(CashBankAccountService::class)->bootstrapDefaults();
        $cash = PaymentMethod::where('settlement_type', 'cash')->where('is_active', true)->sole();
        $bank = PaymentMethod::where('settlement_type', 'bank')->where('is_active', true)->orderBy('name')->firstOrFail();
        app(FuelStationSettingsService::class)->putStationValues($station, [
            'fuel_sales_allowed_payment_method_ids' => [$cash->id, $bank->id],
            'fuel_sales_allow_deferred_payment' => false,
            'shift_opening_meter_reading_required' => false, 'shift_closing_meter_reading_required' => false,
            'shift_opening_tank_reading_required' => false, 'shift_closing_tank_reading_required' => false,
            'shift_mandatory_staff_assignment' => false, 'shift_supervisor_approval_required' => false,
            'shift_allow_close_with_pending_cash_variance' => true,
            'shift_expected_cash_basis' => 'receiving_shift_receipts',
        ], $actor, 'تهيئة اختبار D1/D2/D5');

        $seller = $this->roleUser($tenantId, 'seller', 'seller@fuel-cash-d1' . $sfx . '.test', ['fuel.shift.view', 'fuel.shift.open', 'fuel.shift.cash_count', 'fuel.shift.close', 'fuel.sale.collect']);
        $supervisor = $this->roleUser($tenantId, 'supervisor', 'supervisor@fuel-cash-d1' . $sfx . '.test', ['fuel.shift.view', 'fuel.shift.approve']);
        $inactive = $this->roleUser($tenantId, 'inactive-sup', 'inactive-sup@fuel-cash-d1' . $sfx . '.test', ['fuel.shift.approve']);
        $inactive->forceFill(['is_active' => false])->save();
        app(TenantContext::class)->set($tenantId);

        return compact('actor', 'branch', 'warehouse', 'customer', 'product', 'fuelProduct', 'station', 'nozzle', 'cash', 'bank', 'seller', 'supervisor') + [
            'inactive_supervisor' => $inactive, 'foreign_supervisor' => $foreignSupervisor, 'tenant_id' => $tenantId, 'foreign_tenant_id' => $foreign['tenant_id'],
        ];
    }

    /** @param array<int,string> $permissions */
    private function roleUser(string $tenantId, string $slug, string $email, array $permissions): User
    {
        app(TenantContext::class)->set($tenantId);
        $role = Role::create(['tenant_id' => $tenantId, 'slug' => "fuel-{$slug}", 'name' => $slug, 'permissions' => $permissions, 'is_system' => false]);

        return User::create(['tenant_id' => $tenantId, 'name' => $slug, 'email' => $email, 'password' => 'password123', 'role' => $role->slug]);
    }
}
