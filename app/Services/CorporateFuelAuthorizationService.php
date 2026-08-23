<?php

namespace App\Services;

use App\Models\Account;
use App\Models\CorporateFuelContract;
use App\Models\CorporateFuelCreditLock;
use App\Models\FuelCard;
use App\Models\FuelCardUsage;
use App\Models\FuelFleetDriver;
use App\Models\FuelFleetVehicle;
use App\Models\FuelProduct;
use App\Models\FuelSale;
use App\Models\FuelStation;
use App\Models\JournalLine;
use App\Models\Partner;
use App\Models\User;
use App\Tenancy\TenantContext;
use Carbon\Carbon;
use Carbon\CarbonInterface;
use Illuminate\Support\Facades\DB;
use RuntimeException;

/**
 * يقرر هذا المحرك تفويض البيع المؤسسي فقط. لا ينشئ Invoice أو Payment أو قيداً؛
 * FuelSaleService يبقى مالك تسلسل Cycle 5 بعد نجاح القرار.
 */
class CorporateFuelAuthorizationService
{
    private const RECEIVABLE_ACCOUNT = '1130';

    public function __construct(
        protected CorporateFuelContractService $contracts,
        protected FuelStationSettingsService $settings,
    ) {}

    /**
     * @return array{contract:CorporateFuelContract,card:?FuelCard,vehicle:?FuelFleetVehicle,driver:?FuelFleetDriver,price_per_liter_minor:int,tax_mode:string,price_source:string,contract_price_id:?string,odometer:?int}|null
     */
    public function resolve(FuelSale $sale, FuelStation $station, FuelProduct $fuelProduct, CarbonInterface $at): ?array
    {
        $requested = $sale->corporate_fuel_contract_id !== null || $sale->fuel_card_id !== null
            || $sale->fuel_fleet_vehicle_id !== null || $sale->fuel_fleet_driver_id !== null;
        if (! $requested) {
            return null;
        }
        if (! (bool) $this->settings->get($station, 'corporate_credit_enabled')) {
            throw new RuntimeException('CORPORATE_CREDIT_DISABLED');
        }
        if ($sale->partner_id === null) {
            throw new RuntimeException('CORPORATE_CONTRACT_REQUIRES_CUSTOMER');
        }
        $partner = Partner::find($sale->partner_id);
        if ($partner === null || ! $partner->isCustomer() || ! $partner->is_active) {
            throw new RuntimeException('CORPORATE_CUSTOMER_INVALID');
        }

        $card = $sale->fuel_card_id === null ? null : FuelCard::lockForUpdate()->find($sale->fuel_card_id);
        if ($sale->fuel_card_id !== null && $card === null) {
            throw new RuntimeException('FUEL_CARD_NOT_FOUND');
        }
        $contractId = $sale->corporate_fuel_contract_id ?? $card?->corporate_fuel_contract_id;
        if ($contractId === null) {
            throw new RuntimeException('CORPORATE_CONTRACT_REQUIRED');
        }
        $contract = CorporateFuelContract::lockForUpdate()->find($contractId);
        if ($contract === null || $contract->partner_id !== $partner->id) {
            throw new RuntimeException('CORPORATE_CONTRACT_CUSTOMER_MISMATCH');
        }
        if (! $contract->isActiveAt($at)) {
            throw new RuntimeException('CORPORATE_CONTRACT_NOT_ACTIVE');
        }
        if ((bool) $this->settings->get($station, 'require_active_contract') && $contract->status !== CorporateFuelContract::STATUS_ACTIVE) {
            throw new RuntimeException('CORPORATE_CONTRACT_NOT_ACTIVE');
        }
        $this->assertContractRestrictions($contract, $station, $fuelProduct);

        $vehicle = $this->vehicle($sale, $partner, $contract);
        $driver = $this->driver($sale, $partner, $contract);
        $this->assertRequiredFleetData($contract, $station, $vehicle, $driver);
        $odometer = $this->assertOdometer($contract, $station, $vehicle, $sale->odometer_snapshot);

        if ($card !== null) {
            $this->assertCard($card, $partner, $contract, $station, $fuelProduct, $vehicle, $driver, $at);
        } elseif ($this->boolPolicy($contract->fuel_card_required, (bool) $this->settings->get($station, 'fuel_card_required'))) {
            throw new RuntimeException('FUEL_CARD_REQUIRED');
        }

        $contractPrice = $this->contracts->effectivePrice($contract, $fuelProduct, $at);
        if ($contractPrice !== null) {
            return [
                'contract' => $contract,
                'card' => $card,
                'vehicle' => $vehicle,
                'driver' => $driver,
                'price_per_liter_minor' => (int) $contractPrice->price_per_liter_minor,
                'tax_mode' => $contractPrice->tax_mode,
                'price_source' => 'contract_special_price',
                'contract_price_id' => $contractPrice->id,
                'odometer' => $odometer,
            ];
        }

        return [
            'contract' => $contract,
            'card' => $card,
            'vehicle' => $vehicle,
            'driver' => $driver,
            'price_per_liter_minor' => 0,
            'tax_mode' => '',
            'price_source' => 'station_price',
            'contract_price_id' => null,
            'odometer' => $odometer,
        ];
    }

    /**
     * يستدعى بعد أن يحسب InvoiceService إجمالي الفاتورة المسودة، وقبل post().
     * يقفل صف العميل ثم البطاقة؛ لا تترك المعاملة فاصل read→write في حد الائتمان.
     */
    public function assertFinancialLimits(array $authorization, FuelSale $sale, FuelStation $station, int $invoiceTotal): void
    {
        $contract = $authorization['contract'];
        $this->lockCredit($contract->partner_id);
        $exposure = $this->officialExposure($contract->partner_id);
        $limit = (int) $contract->credit_limit_minor;
        if ($invoiceTotal > $limit - $exposure) {
            throw new RuntimeException('CORPORATE_CREDIT_LIMIT_EXCEEDED');
        }

        if (($card = $authorization['card']) !== null) {
            $card = FuelCard::lockForUpdate()->findOrFail($card->id);
            $this->assertCardLimits($card, $sale, $station, $invoiceTotal);
        }
    }

    /** يسجل الاستهلاك فقط بعد نجاح InvoiceService::post ومسار المخزون. */
    public function recordApprovedUsage(array $authorization, FuelSale $sale, FuelStation $station, int $invoiceTotal): void
    {
        $card = $authorization['card'];
        if ($card === null) {
            return;
        }
        FuelCardUsage::create([
            'branch_id' => $station->branch_id,
            'fuel_card_id' => $card->id,
            'fuel_sale_id' => $sale->id,
            'corporate_fuel_contract_id' => $authorization['contract']->id,
            'partner_id' => $authorization['contract']->partner_id,
            'fuel_station_id' => $station->id,
            'fuel_product_id' => $sale->fuel_product_id,
            'quantity_milliliters' => (int) $sale->quantity_milliliters,
            'invoice_total_minor' => $invoiceTotal,
            'occurred_at' => now(),
        ]);
    }

    public function officialExposure(string $partnerId): int
    {
        $account = Account::where('code', self::RECEIVABLE_ACCOUNT)->first();
        if ($account === null) {
            throw new RuntimeException('لا يمكن فحص ائتمان الشركات قبل تعيين حساب العملاء 1130.');
        }
        $balance = JournalLine::where('account_id', $account->id)
            ->where('partner_type', Partner::class)
            ->where('partner_id', $partnerId)
            ->selectRaw('COALESCE(SUM(debit - credit), 0) AS balance')
            ->value('balance');

        return max(0, (int) $balance);
    }

    private function vehicle(FuelSale $sale, Partner $partner, CorporateFuelContract $contract): ?FuelFleetVehicle
    {
        if ($sale->fuel_fleet_vehicle_id === null) {
            return null;
        }
        $vehicle = FuelFleetVehicle::lockForUpdate()->find($sale->fuel_fleet_vehicle_id);
        if ($vehicle === null || ! $vehicle->isActive()) {
            throw new RuntimeException('FLEET_VEHICLE_NOT_ACTIVE');
        }
        if (($vehicle->partner_id !== null && $vehicle->partner_id !== $partner->id)
            || ($vehicle->corporate_fuel_contract_id !== null && $vehicle->corporate_fuel_contract_id !== $contract->id)) {
            throw new RuntimeException('FLEET_VEHICLE_CUSTOMER_OR_CONTRACT_MISMATCH');
        }
        if ($vehicle->allowedFuelProducts()->exists() && ! $vehicle->allowedFuelProducts()->where('fuel_product_id', $sale->fuel_product_id)->exists()) {
            throw new RuntimeException('FLEET_VEHICLE_FUEL_RESTRICTED');
        }

        return $vehicle;
    }

    private function driver(FuelSale $sale, Partner $partner, CorporateFuelContract $contract): ?FuelFleetDriver
    {
        if ($sale->fuel_fleet_driver_id === null) {
            return null;
        }
        $driver = FuelFleetDriver::lockForUpdate()->find($sale->fuel_fleet_driver_id);
        if ($driver === null || ! $driver->isActive()) {
            throw new RuntimeException('FLEET_DRIVER_NOT_ACTIVE');
        }
        if (($driver->partner_id !== null && $driver->partner_id !== $partner->id)
            || ($driver->corporate_fuel_contract_id !== null && $driver->corporate_fuel_contract_id !== $contract->id)) {
            throw new RuntimeException('FLEET_DRIVER_CUSTOMER_OR_CONTRACT_MISMATCH');
        }

        return $driver;
    }

    private function assertRequiredFleetData(CorporateFuelContract $contract, FuelStation $station, ?FuelFleetVehicle $vehicle, ?FuelFleetDriver $driver): void
    {
        if ($this->boolPolicy($contract->vehicle_required, (bool) $this->settings->get($station, 'vehicle_required')) && $vehicle === null) {
            throw new RuntimeException('FLEET_VEHICLE_REQUIRED');
        }
        if ($this->boolPolicy($contract->driver_required, (bool) $this->settings->get($station, 'driver_required')) && $driver === null) {
            throw new RuntimeException('FLEET_DRIVER_REQUIRED');
        }
    }

    private function assertOdometer(CorporateFuelContract $contract, FuelStation $station, ?FuelFleetVehicle $vehicle, ?int $odometer): ?int
    {
        $policy = $contract->odometer_policy ?? $this->settings->get($station, 'odometer_policy');
        if ($policy === 'disabled') {
            return null;
        }
        if ($policy === 'required' && ($vehicle === null || $odometer === null)) {
            throw new RuntimeException('FLEET_ODOMETER_REQUIRED');
        }
        if ($odometer !== null && $vehicle === null) {
            throw new RuntimeException('FLEET_ODOMETER_REQUIRES_VEHICLE');
        }
        if ($odometer !== null && $odometer < (int) ($vehicle?->odometer ?? 0)) {
            throw new RuntimeException('FLEET_ODOMETER_DECREASED');
        }

        return $odometer;
    }

    private function assertContractRestrictions(CorporateFuelContract $contract, FuelStation $station, FuelProduct $fuelProduct): void
    {
        if ($contract->station_restriction_mode === CorporateFuelContract::RESTRICTION_SELECTED
            && ! $contract->stations()->where('fuel_station_id', $station->id)->exists()) {
            throw new RuntimeException('CORPORATE_CONTRACT_STATION_RESTRICTED');
        }
        if ($contract->fuel_restriction_mode === CorporateFuelContract::RESTRICTION_SELECTED
            && ! $contract->fuelProducts()->where('fuel_product_id', $fuelProduct->id)->exists()) {
            throw new RuntimeException('CORPORATE_CONTRACT_FUEL_RESTRICTED');
        }
    }

    private function assertCard(FuelCard $card, Partner $partner, CorporateFuelContract $contract, FuelStation $station, FuelProduct $fuelProduct, ?FuelFleetVehicle $vehicle, ?FuelFleetDriver $driver, CarbonInterface $at): void
    {
        if (! $card->isActiveAt($at)) {
            throw new RuntimeException('FUEL_CARD_NOT_ACTIVE');
        }
        if ($card->partner_id !== $partner->id || $card->corporate_fuel_contract_id !== $contract->id) {
            throw new RuntimeException('FUEL_CARD_CUSTOMER_OR_CONTRACT_MISMATCH');
        }
        if ($card->fuel_fleet_vehicle_id !== null && $card->fuel_fleet_vehicle_id !== $vehicle?->id) {
            throw new RuntimeException('FUEL_CARD_VEHICLE_MISMATCH');
        }
        if ($card->fuel_fleet_driver_id !== null && $card->fuel_fleet_driver_id !== $driver?->id) {
            throw new RuntimeException('FUEL_CARD_DRIVER_MISMATCH');
        }
        if ($card->station_restriction_mode === FuelCard::RESTRICTION_SELECTED && ! $card->stations()->where('fuel_station_id', $station->id)->exists()) {
            throw new RuntimeException('FUEL_CARD_STATION_RESTRICTED');
        }
        if ($card->fuel_restriction_mode === FuelCard::RESTRICTION_SELECTED && ! $card->fuelProducts()->where('fuel_product_id', $fuelProduct->id)->exists()) {
            throw new RuntimeException('FUEL_CARD_FUEL_RESTRICTED');
        }
        $this->assertTimeWindow($card, $station, $at);
    }

    private function assertTimeWindow(FuelCard $card, FuelStation $station, CarbonInterface $at): void
    {
        $windows = $card->allowed_time_windows;
        if ($windows === null || $windows === []) {
            return;
        }
        $local = $at->copy()->setTimezone($station->timezone ?: 'UTC');
        $time = $local->format('H:i');
        $day = $local->isoWeekday();
        foreach ($windows as $window) {
            if (! in_array($day, $window['days'], true)) {
                continue;
            }
            $start = $window['start'];
            $end = $window['end'];
            $allowed = $start <= $end ? ($time >= $start && $time < $end) : ($time >= $start || $time < $end);
            if ($allowed) {
                return;
            }
        }
        throw new RuntimeException('FUEL_CARD_TIME_RESTRICTED');
    }

    private function assertCardLimits(FuelCard $card, FuelSale $sale, FuelStation $station, int $invoiceTotal): void
    {
        $this->assertLimit($card->per_transaction_milliliters, (int) $sale->quantity_milliliters, 0, 'FUEL_CARD_TRANSACTION_LITERS_LIMIT');
        $this->assertLimit($card->per_transaction_value_minor, $invoiceTotal, 0, 'FUEL_CARD_TRANSACTION_VALUE_LIMIT');

        $timezone = $station->timezone ?: 'UTC';
        $now = now()->setTimezone($timezone);
        $this->assertWindowLimit($card, $now->copy()->startOfDay(), $now->copy()->endOfDay(), (int) $sale->quantity_milliliters, $invoiceTotal, $card->daily_milliliters, $card->daily_value_minor, $card->daily_transaction_count, 'daily');
        $this->assertWindowLimit($card, $now->copy()->startOfWeek(), $now->copy()->endOfWeek(), (int) $sale->quantity_milliliters, $invoiceTotal, $card->weekly_milliliters, $card->weekly_value_minor, null, 'weekly');
        $this->assertWindowLimit($card, $now->copy()->startOfMonth(), $now->copy()->endOfMonth(), (int) $sale->quantity_milliliters, $invoiceTotal, $card->monthly_milliliters, $card->monthly_value_minor, null, 'monthly');
    }

    private function assertWindowLimit(FuelCard $card, CarbonInterface $start, CarbonInterface $end, int $quantity, int $value, ?int $quantityLimit, ?int $valueLimit, ?int $countLimit, string $window): void
    {
        $query = FuelCardUsage::where('fuel_card_id', $card->id)
            ->whereBetween('occurred_at', [$start->copy()->utc(), $end->copy()->utc()]);
        $usedQuantity = (int) (clone $query)->sum('quantity_milliliters');
        $usedValue = (int) (clone $query)->sum('invoice_total_minor');
        $usedCount = (int) (clone $query)->count();
        $this->assertLimit($quantityLimit, $quantity, $usedQuantity, "FUEL_CARD_{$window}_LITERS_LIMIT");
        $this->assertLimit($valueLimit, $value, $usedValue, "FUEL_CARD_{$window}_VALUE_LIMIT");
        if ($countLimit !== null && $usedCount >= $countLimit) {
            throw new RuntimeException("FUEL_CARD_{$window}_TRANSACTION_COUNT_LIMIT");
        }
    }

    private function assertLimit(?int $limit, int $newValue, int $usedValue, string $code): void
    {
        if ($limit !== null && $newValue > $limit - $usedValue) {
            throw new RuntimeException($code);
        }
    }

    private function lockCredit(string $partnerId): CorporateFuelCreditLock
    {
        $tenantId = app(TenantContext::class)->id();
        CorporateFuelCreditLock::firstOrCreate(['tenant_id' => $tenantId, 'partner_id' => $partnerId]);

        return CorporateFuelCreditLock::where('tenant_id', $tenantId)->where('partner_id', $partnerId)->lockForUpdate()->firstOrFail();
    }

    private function boolPolicy(?bool $contractValue, bool $fallback): bool
    {
        return $contractValue ?? $fallback;
    }
}
