<?php

namespace App\Services;

use App\Models\Account;
use App\Models\FuelOperationalLedger;
use App\Models\FuelProduct;
use App\Models\FuelReconciliation;
use App\Models\FuelStation;
use App\Models\FuelTank;
use App\Models\FuelTankReading;
use App\Models\ProductWarehouseStock;
use App\Models\Warehouse;
use App\Services\Accounting\InventoryService;
use App\Services\Accounting\LedgerService;
use App\Services\Accounting\StocktakeService;
use App\Tenancy\BranchScope;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;
use RuntimeException;

/**
 * Cycle 2: يربط الدليل المادي بالكتاب عبر تسوية صريحة فقط.
 *
 * ATG/physical evidence لا يمس مخزون Nebrax. اعتماد مسودة مؤمنة هو المكان الوحيد
 * الذي ينشئ StockMovement ثم قيداً متوازناً عبر LedgerService في نفس المعاملة.
 */
class FuelReconciliationService
{
    public function __construct(
        private FuelQuantity $quantity,
        private FuelStationSettingsService $settings,
        private FuelCostBasisService $costBasis,
        private InventoryService $inventory,
        private LedgerService $ledger,
    ) {}

    /** @param array<string, mixed> $data */
    public function recordReading(array $data): FuelTankReading
    {
        try {
            return DB::transaction(function () use ($data) {
                $station = $this->station($data['fuel_station_id']);
                $tank = $this->tank($data['fuel_tank_id'], $station);
                $type = $data['reading_type'] ?? '';
                if (! in_array($type, FuelTankReading::TYPES, true)) {
                    throw new RuntimeException('نوع قراءة الخزان غير صالح.');
                }
                $milliliters = $this->quantity->litersToMilliliters($data['quantity_liters']);

                return FuelTankReading::create([
                    'branch_id' => $station->branch_id,
                    'fuel_station_id' => $station->id,
                    'fuel_tank_id' => $tank->id,
                    'reading_type' => $type,
                    'quantity_milliliters' => $milliliters,
                    'measured_at' => $data['measured_at'] ?? now(),
                    'evidence_key' => trim($data['evidence_key']),
                    'evidence' => $data['evidence'] ?? null,
                    'recorded_by' => $data['recorded_by'] ?? null,
                ]);
            });
        } catch (QueryException $exception) {
            if (str_contains($exception->getMessage(), 'fuel_reading_evidence_unique')) {
                throw new RuntimeException('مفتاح دليل القياس مستخدم مسبقاً ولا يمكن تسجيل القياس مرتين.', previous: $exception);
            }

            throw $exception;
        }
    }

    /** @param array<string, mixed> $data */
    public function createDraft(array $data): FuelReconciliation
    {
        try {
            return DB::transaction(function () use ($data) {
            $station = $this->station($data['fuel_station_id']);
            $warehouse = $this->warehouse($station);
            $tank = $this->tank($data['fuel_tank_id'], $station);
            $fuelProduct = $this->fuelProduct($tank->fuel_product_id);
            $product = $this->product($fuelProduct);
            $this->quantity->assertFuelUnitMapping($fuelProduct, $product);
            $settings = $this->settings->forStation($station);
            $this->assertNoUnsupportedSourceTotals($data);

            // Cycle 2 لا يستقبل إجماليات تسليم/بيع/تحويل من العميل: لا بد أن تأتي
            // هذه الحركات لاحقاً من مصادر تشغيلية موثقة. رصيد المخزن الرسمي هو
            // opening ويمتلك بالفعل أثر كل حركة معتمدة سابقة.
            $opening = $this->bookBalance($warehouse->id, $product->id);
            $deliveries = 0;
            $sales = 0;
            $transfers = 0;
            $adjustments = 0;
            $expected = $opening;
            if ($expected < 0) {
                throw new RuntimeException('الرصيد المتوقع للخزان لا يمكن أن يكون سالباً. راجع الحركات المرسلة.');
            }

            $physical = $this->reading($data['physical_reading_id'] ?? null, $station, $tank, FuelTankReading::TYPE_PHYSICAL);
            $atg = $this->reading($data['atg_reading_id'] ?? null, $station, $tank, FuelTankReading::TYPE_ATG);
            foreach ([$physical?->id, $atg?->id] as $readingId) {
                if ($readingId !== null && FuelReconciliation::where('physical_reading_id', $readingId)->orWhere('atg_reading_id', $readingId)->exists()) {
                    throw new RuntimeException('لا يمكن إعادة استخدام دليل القياس في تسوية أخرى.');
                }
            }
            $variance = $physical ? $physical->quantity_milliliters - $expected : null;
            $basisPoints = $this->varianceBasisPoints($variance, $expected);

            return FuelReconciliation::create([
                'branch_id' => $station->branch_id,
                'fuel_station_id' => $station->id,
                'fuel_tank_id' => $tank->id,
                'fuel_product_id' => $fuelProduct->id,
                'warehouse_id' => $warehouse->id,
                'opening_book_milliliters' => $opening,
                'deliveries_milliliters' => $deliveries,
                'sales_milliliters' => $sales,
                'transfers_milliliters' => $transfers,
                'prior_adjustments_milliliters' => $adjustments,
                'expected_closing_milliliters' => $expected,
                'physical_closing_milliliters' => $physical?->quantity_milliliters,
                'atg_closing_milliliters' => $atg?->quantity_milliliters,
                'variance_milliliters' => $variance,
                'variance_basis_points' => $basisPoints,
                'tolerance_absolute_milliliters' => (int) $settings['reconciliation_tolerance_absolute_milliliters'],
                'tolerance_basis_points' => (int) $settings['reconciliation_tolerance_basis_points'],
                // Explicit approval remains required even inside tolerance; tolerance is audit metadata, never erasure.
                'requires_approval' => true,
                'physical_reading_id' => $physical?->id,
                'atg_reading_id' => $atg?->id,
                'created_by' => $data['created_by'] ?? null,
                'reason' => $this->nullableTrim($data['reason'] ?? null),
            ]);
            });
        } catch (QueryException $exception) {
            if (str_contains($exception->getMessage(), 'fuel_reconciliations_physical_reading_unique') || str_contains($exception->getMessage(), 'fuel_reconciliations_atg_reading_unique')) {
                throw new RuntimeException('لا يمكن إعادة استخدام دليل القياس في تسوية أخرى.', previous: $exception);
            }

            throw $exception;
        }
    }

    public function approve(FuelReconciliation $reconciliation, string $approverId, ?string $reason = null): FuelReconciliation
    {
        if (! $reconciliation->isDraft()) {
            throw new RuntimeException('لا يمكن اعتماد تسوية غير مسودة.');
        }
        if (! \App\Models\User::whereKey($approverId)->exists()) {
            throw new RuntimeException('الموافق لا ينتمي إلى المستأجر.');
        }

        return DB::transaction(function () use ($reconciliation, $approverId, $reason) {
            $reconciliation = FuelReconciliation::lockForUpdate()->findOrFail($reconciliation->id);
            if (! $reconciliation->isDraft()) {
                throw new RuntimeException('لا يمكن اعتماد تسوية غير مسودة.');
            }
            if ($reconciliation->physical_closing_milliliters === null || $reconciliation->variance_milliliters === null) {
                throw new RuntimeException('لا يمكن اعتماد تسوية بلا قراءة مادية Physical. قراءة ATG دليل مستقل ولا تعدل الكتاب.');
            }

            $station = $this->station($reconciliation->fuel_station_id);
            $warehouse = $this->warehouse($station);
            if ($warehouse->id !== $reconciliation->warehouse_id) {
                throw new RuntimeException('تغير تكوين مخزن المحطة بعد إنشاء المسودة. أنشئ تسوية جديدة حتى يبقى التاريخ صادقاً.');
            }
            $fuelProduct = $this->fuelProduct($reconciliation->fuel_product_id);
            $product = $this->product($fuelProduct);
            $this->quantity->assertFuelUnitMapping($fuelProduct, $product);
            $this->lockBookStock($warehouse->id, $product->id);
            $difference = (int) $reconciliation->variance_milliliters;
            $unitCost = 0; // توافق StockMovement فقط؛ Fuel Cost Basis هو مصدر القيمة.
            $value = 0;
            $stockMovement = null;
            $entry = null;

            if ($difference > 0) {
                $quote = $this->costBasis->quoteGain($fuelProduct, $warehouse, $difference);
                $value = $quote['posted_cost_minor'];
                $unitCost = intdiv($value, $difference);
                $stockMovement = $this->inventory->applyReceipt($product, $difference, $unitCost, $this->movementMeta($reconciliation, $warehouse), $value);
                $entry = $this->postEntry($reconciliation, $station, $value, true, $approverId);
                $this->costBasis->recordGain($fuelProduct, $warehouse, $stockMovement, $difference, $value, $entry);
            } elseif ($difference < 0) {
                $lossQuantity = -$difference;
                $this->assertWarehouseAvailable($warehouse->id, $product->id, $lossQuantity);
                $quote = $this->costBasis->quoteIssue($fuelProduct, $warehouse, $lossQuantity);
                $lossValue = $quote['posted_cost_minor'];
                $value = -$lossValue;
                $unitCost = intdiv($lossValue, $lossQuantity);
                $stockMovement = $this->inventory->applyIssue($product, $lossQuantity, $unitCost, $this->movementMeta($reconciliation, $warehouse) + ['enforce_stock' => true], $lossValue);
                $entry = $this->postEntry($reconciliation, $station, $lossValue, false, $approverId);
                $this->costBasis->recordIssue($fuelProduct, $warehouse, $stockMovement, $lossQuantity, $lossValue, $entry);
            }

            $balance = $this->bookBalance($warehouse->id, $product->id);
            FuelOperationalLedger::create([
                'branch_id' => $station->branch_id,
                'fuel_station_id' => $station->id,
                'fuel_tank_id' => $reconciliation->fuel_tank_id,
                'fuel_product_id' => $fuelProduct->id,
                'warehouse_id' => $warehouse->id,
                'fuel_reconciliation_id' => $reconciliation->id,
                'stock_movement_id' => $stockMovement?->id,
                'movement_type' => $difference > 0
                    ? FuelOperationalLedger::TYPE_ADJUSTMENT_GAIN
                    : ($difference < 0 ? FuelOperationalLedger::TYPE_ADJUSTMENT_LOSS : FuelOperationalLedger::TYPE_RECONCILIATION_MATCHED),
                'quantity_milliliters' => $difference,
                'book_balance_milliliters' => $balance,
                'unit_cost_minor' => $unitCost,
                'value_minor' => $value,
                'idempotency_key' => 'reconciliation:' . $reconciliation->id,
                'source_type' => FuelReconciliation::class,
                'source_id' => $reconciliation->id,
                'occurred_at' => now(),
                'notes' => $reason ?? $reconciliation->reason,
            ]);

            $reconciliation->update([
                'status' => FuelReconciliation::STATUS_APPROVED,
                'unit_cost_minor' => $unitCost,
                'financial_variance_minor' => $value,
                'stock_movement_id' => $stockMovement?->id,
                'journal_entry_id' => $entry?->id,
                'approved_by' => $approverId,
                'approved_at' => now(),
                'reason' => $reason ?? $reconciliation->reason,
            ]);

            return $reconciliation->fresh();
        });
    }

    private function station(string $id): FuelStation
    {
        return FuelStation::findOrFail($id);
    }

    private function tank(string $id, FuelStation $station): FuelTank
    {
        $tank = FuelTank::whereKey($id)->first();
        if (! $tank || $tank->fuel_station_id !== $station->id || $tank->branch_id !== $station->branch_id) {
            throw new RuntimeException('الخزان لا ينتمي إلى المحطة وفرعها.');
        }
        return $tank;
    }

    private function warehouse(FuelStation $station): Warehouse
    {
        if ($station->warehouse_id === null) {
            throw new RuntimeException('المحطة بلا مخزن معيّن. عيّن مخزناً صريحاً قبل أي حركة وقود رسمية.');
        }
        $warehouse = Warehouse::whereKey($station->warehouse_id)->first();
        if (! $warehouse || $warehouse->tenant_id !== $station->tenant_id || ! $warehouse->is_active || ($warehouse->branch_id !== null && $warehouse->branch_id !== $station->branch_id)) {
            throw new RuntimeException('مخزن المحطة غير صالح أو لا يطابق المستأجر/الفرع.');
        }
        return $warehouse;
    }

    private function fuelProduct(string $id): FuelProduct
    {
        $fuelProduct = FuelProduct::find($id);
        if (! $fuelProduct || ! $fuelProduct->is_active) throw new RuntimeException('منتج الوقود غير صالح أو معطل.');
        return $fuelProduct;
    }

    private function product(FuelProduct $fuelProduct): \App\Models\Product
    {
        $product = BranchScope::reference(\App\Models\Product::class)->find($fuelProduct->product_id);
        if (! $product || ! $product->is_active || ! $product->track_inventory) throw new RuntimeException('منتج Nebrax المرتبط يجب أن يكون نشطاً ومتابعاً مخزنياً.');
        return $product;
    }

    private function reading(?string $id, FuelStation $station, FuelTank $tank, string $type): ?FuelTankReading
    {
        if ($id === null) return null;
        $reading = FuelTankReading::whereKey($id)->first();
        if (! $reading || $reading->fuel_station_id !== $station->id || $reading->fuel_tank_id !== $tank->id || $reading->reading_type !== $type) {
            throw new RuntimeException('دليل القراءة لا يطابق المحطة أو الخزان أو النوع المطلوب.');
        }
        return $reading;
    }

    /** @param array<string,mixed> $data */
    private function liters(array $data, string $key): int { return array_key_exists($key, $data) ? $this->quantity->litersToMilliliters($data[$key]) : 0; }
    /** @param array<string,mixed> $data */
    private function signedLiters(array $data, string $key): int
    {
        if (! array_key_exists($key, $data)) return 0;
        $raw = trim((string) $data[$key]);
        $negative = str_starts_with($raw, '-');
        return ($negative ? -1 : 1) * $this->quantity->litersToMilliliters(ltrim($raw, '+-'));
    }

    private function bookBalance(string $warehouseId, string $productId): int
    {
        return (int) (ProductWarehouseStock::where('warehouse_id', $warehouseId)->where('product_id', $productId)->value('quantity') ?? 0);
    }

    private function lockBookStock(string $warehouseId, string $productId): void
    {
        // يقفل المنتج حتى حين لا يوجد صف رصيد بعد، ثم يقفل صف الرصيد إن وُجد.
        // هكذا لا تعتمد تسويتان متزامنتان لقطة تكلفة/رصيد متنافرتين.
        BranchScope::reference(\App\Models\Product::class)->lockForUpdate()->findOrFail($productId);
        ProductWarehouseStock::where('warehouse_id', $warehouseId)
            ->where('product_id', $productId)
            ->lockForUpdate()
            ->first();
    }

    private function assertWarehouseAvailable(string $warehouseId, string $productId, int $quantity): void
    {
        if ($this->bookBalance($warehouseId, $productId) < $quantity) throw new RuntimeException('فرق الفقد يتجاوز رصيد الوقود المتاح في مخزن المحطة.');
    }

    private function multiply(int $quantity, int $unitCost): int
    {
        if ($quantity !== 0 && abs($unitCost) > intdiv(PHP_INT_MAX, abs($quantity))) throw new RuntimeException('قيمة فرق الوقود تتجاوز الحد المسموح به.');
        return $quantity * $unitCost;
    }

    /** @return array<string,mixed> */
    private function movementMeta(FuelReconciliation $r, Warehouse $warehouse): array
    {
        return ['warehouse_id' => $warehouse->id, 'date' => now()->toDateString(), 'source_type' => FuelReconciliation::class, 'source_id' => $r->id, 'notes' => 'تسوية وقود معتمدة'];
    }

    private function postEntry(FuelReconciliation $r, FuelStation $station, int $amount, bool $gain, string $approverId): ?\App\Models\JournalEntry
    {
        if ($amount === 0) return null;
        $settings = $this->settings->forStation($station);
        $variance = $this->account(
            $settings[$gain ? 'inventory_gain_account_id' : 'inventory_variance_account_id'] ?? null,
            StocktakeService::VARIANCE_ACCOUNT_CODE,
            $gain ? ['expense', 'revenue'] : ['expense'],
        );
        $inventory = $this->account($station->default_inventory_account_id, StocktakeService::INVENTORY_ACCOUNT_CODE, ['asset']);
        $lines = $gain ? [['account_id' => $inventory->id, 'debit' => $amount], ['account_id' => $variance->id, 'credit' => $amount]] : [['account_id' => $variance->id, 'debit' => $amount], ['account_id' => $inventory->id, 'credit' => $amount]];
        return $this->ledger->post($lines, ['entry_date' => now()->toDateString(), 'description' => $gain ? 'زيادة تسوية وقود' : 'فقد تسوية وقود', 'source_type' => FuelReconciliation::class, 'source_id' => $r->id, 'created_by' => $approverId]);
    }

    /** @param array<int, string> $allowedTypes */
    private function account(?string $id, string $fallbackCode, array $allowedTypes): Account
    {
        $account = $id ? Account::whereKey($id)->first() : Account::where('code', $fallbackCode)->first();
        if (! $account || $account->is_group || ! $account->is_active || ! in_array($account->type, $allowedTypes, true)) {
            throw new RuntimeException('حساب فرق أو مخزون الوقود غير صالح للترحيل أو لا يملك الاتجاه المحاسبي المطلوب.');
        }
        return $account;
    }

    /** @param array<string, mixed> $data */
    private function assertNoUnsupportedSourceTotals(array $data): void
    {
        foreach (['deliveries_liters', 'sales_liters', 'transfers_liters', 'prior_adjustments_liters'] as $key) {
            if (! array_key_exists($key, $data) || trim((string) $data[$key]) === '') {
                continue;
            }
            $quantity = in_array($key, ['transfers_liters', 'prior_adjustments_liters'], true)
                ? $this->signedLiters($data, $key)
                : $this->liters($data, $key);
            if ($quantity !== 0) {
                throw new RuntimeException('لا تقبل تسوية Cycle 2 إجماليات حركات يدوية. استخدم مصدراً تشغيلياً موثقاً عند بناء دورة التسليم أو البيع أو التحويل.');
            }
        }
    }

    private function varianceBasisPoints(?int $variance, int $expected): ?int
    {
        if ($variance === null || $expected === 0) {
            return null;
        }
        if (abs($variance) > intdiv(PHP_INT_MAX, 10000)) {
            throw new RuntimeException('نسبة فرق الوقود تتجاوز الحد المسموح به.');
        }

        return intdiv($variance * 10000, $expected);
    }

    private function nullableTrim(?string $value): ?string { $value = trim((string) $value); return $value === '' ? null : $value; }
}
