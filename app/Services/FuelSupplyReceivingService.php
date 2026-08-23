<?php

namespace App\Services;

use App\Models\Account;
use App\Models\FuelDelivery;
use App\Models\FuelOperationalLedger;
use App\Models\FuelProduct;
use App\Models\FuelSupplierInvoice;
use App\Models\FuelSupplierInvoiceLine;
use App\Models\FuelSupplierInvoiceMatch;
use App\Models\FuelTank;
use App\Models\FuelTankReading;
use App\Models\JournalEntry;
use App\Models\Partner;
use App\Models\ProcurementDocument;
use App\Models\Product;
use App\Models\Purchase;
use App\Models\Warehouse;
use App\Services\Accounting\InventoryService;
use App\Services\Accounting\LedgerService;
use App\Tenancy\TenantContext;
use Illuminate\Support\Facades\DB;
use RuntimeException;

/**
 * Cycle 3: استلام الوقود يثبت الكمية المستلمة فعلياً في المخزون ويقيد
 * Dr Inventory / Cr GRNI. لا تنشئ مطابقة الفاتورة حركة مخزون ثانية؛ إنها
 * تسوّي الجزء الآمن فقط من GRNI إلى المورد، وتترك فرق القيمة pending بلا حساب مفترض.
 */
class FuelSupplyReceivingService
{
    private const PAYABLE_CODE = '2110';

    public function __construct(
        private InventoryService $inventory,
        private LedgerService $ledger,
        private FuelStationSettingsService $settings,
        private FuelCostBasisService $costBasis,
        private FuelQuantity $quantity,
    ) {}

    /** @param array<string, mixed> $data */
    public function createDelivery(array $data): FuelDelivery
    {
        return DB::transaction(function () use ($data) {
            [$station, $tank, $fuelProduct, $warehouse, $supplier] = $this->resolveDeliveryReferences($data);
            $this->assertFuelProduct($fuelProduct);
            $dispatched = $this->liters($data['dispatched_liters'] ?? null, 'الكمية المرسلة');
            $received = $this->liters($data['received_liters'] ?? null, 'الكمية المستلمة');
            if ($received <= 0) {
                throw new RuntimeException('الكمية المستلمة فعلياً يجب أن تكون موجبة.');
            }
            $totalCost = $this->positiveInteger($data['received_total_cost_minor'] ?? null, 'قيمة الاستلام بالهللات');
            $key = trim((string) ($data['idempotency_key'] ?? ''));
            if ($key === '') {
                throw new RuntimeException('مفتاح idempotency مطلوب لاستلام الوقود.');
            }

            $existing = FuelDelivery::where('idempotency_key', $key)->first();
            if ($existing !== null) {
                return $existing;
            }

            $order = $this->resolveOrder($data['procurement_order_id'] ?? null, $supplier, $station->branch_id);
            $this->assertReadings($data, $station->id, $tank->id);
            $unitCompatibilityCost = intdiv($totalCost, $received);

            return FuelDelivery::create([
                'branch_id' => $station->branch_id,
                'fuel_station_id' => $station->id,
                'fuel_tank_id' => $tank->id,
                'fuel_product_id' => $fuelProduct->id,
                'warehouse_id' => $warehouse->id,
                'supplier_id' => $supplier->id,
                'procurement_order_id' => $order?->id,
                'purchase_reference' => $this->nullableString($data['purchase_reference'] ?? null, 128),
                'delivery_note_number' => $this->nullableString($data['delivery_note_number'] ?? null, 128),
                'tanker_identifier' => $this->nullableString($data['tanker_identifier'] ?? null, 128),
                'driver_name' => $this->nullableString($data['driver_name'] ?? null, 255),
                'compartments' => $data['compartments'] ?? null,
                'dispatched_milliliters' => $dispatched,
                'received_milliliters' => $received,
                'transit_variance_milliliters' => $received - $dispatched,
                'temperature_milli_celsius' => $this->nullableInteger($data['temperature_milli_celsius'] ?? null),
                'density_kg_per_m3' => $this->nullableInteger($data['density_kg_per_m3'] ?? null),
                'before_physical_reading_id' => $data['before_physical_reading_id'] ?? null,
                'after_physical_reading_id' => $data['after_physical_reading_id'] ?? null,
                'before_atg_reading_id' => $data['before_atg_reading_id'] ?? null,
                'after_atg_reading_id' => $data['after_atg_reading_id'] ?? null,
                'evidence' => $data['evidence'] ?? null,
                'status' => FuelDelivery::STATUS_DRAFT,
                // توافق فقط؛ Cost Pool هو مصدر الحقيقة لمنتجات الوقود.
                'received_unit_cost_minor' => $unitCompatibilityCost,
                'received_total_cost_minor' => $totalCost,
                'idempotency_key' => $key,
                'received_at' => $data['received_at'] ?? now(),
                'created_by' => $data['created_by'] ?? null,
                'notes' => $this->nullableString($data['notes'] ?? null, 1000),
            ]);
        });
    }

    public function approveDelivery(FuelDelivery $delivery, string $actorId): FuelDelivery
    {
        return DB::transaction(function () use ($delivery, $actorId) {
            $delivery = FuelDelivery::lockForUpdate()->findOrFail($delivery->id);
            if ($delivery->status !== FuelDelivery::STATUS_DRAFT) {
                throw new RuntimeException('لا يمكن اعتماد استلام وقود غير مسوّد أو معتمد سابقاً.');
            }

            $delivery->loadMissing(['station', 'tank', 'fuelProduct.product', 'warehouse', 'supplier']);
            $station = $delivery->station;
            $tank = $delivery->tank;
            $fuelProduct = $delivery->fuelProduct;
            $warehouse = $delivery->warehouse;
            if (! $station || ! $tank || ! $fuelProduct || ! $warehouse || ! $delivery->supplier) {
                throw new RuntimeException('علاقات استلام الوقود غير مكتملة.');
            }
            $this->assertStationTankProductWarehouse($station->id, $tank, $fuelProduct, $warehouse);
            $this->assertFuelProduct($fuelProduct, $fuelProduct->product);
            $grni = $this->settings->grniAccountFor($station);
            // هذا الحارس يرفض الرصيد التاريخي الذي لا نعرف pool تكلفته؛ لا fallback.
            $this->costBasis->assertReady($fuelProduct, $warehouse);

            $product = $fuelProduct->product;
            $movement = $this->inventory->applyReceipt(
                $product,
                (int) $delivery->received_milliliters,
                (int) $delivery->received_unit_cost_minor,
                [
                    'warehouse_id' => $warehouse->id,
                    'branch_id' => $station->branch_id,
                    'source_type' => FuelDelivery::class,
                    'source_id' => $delivery->id,
                    'date' => $delivery->received_at->toDateString(),
                    'notes' => "استلام وقود {$delivery->delivery_note_number}",
                ],
                (int) $delivery->received_total_cost_minor,
            );
            $value = (int) $delivery->received_total_cost_minor;
            $entry = $this->ledger->post([
                ['account_id' => $this->inventoryAccountId(), 'debit' => $value, 'branch_id' => $station->branch_id],
                ['account_id' => $grni->id, 'credit' => $value, 'branch_id' => $station->branch_id],
            ], [
                'entry_date' => $delivery->received_at->toDateString(),
                'description' => "استلام وقود معتمد {$delivery->delivery_note_number}",
                'source_type' => FuelDelivery::class,
                'source_id' => $delivery->id,
                'created_by' => $actorId,
            ]);
            $costMovement = $this->costBasis->recordReceipt(
                $fuelProduct,
                $warehouse,
                $movement,
                (int) $delivery->received_milliliters,
                $value,
                $entry,
                $delivery,
            );
            $operational = FuelOperationalLedger::create([
                'branch_id' => $station->branch_id,
                'fuel_station_id' => $station->id,
                'fuel_tank_id' => $tank->id,
                'fuel_product_id' => $fuelProduct->id,
                'warehouse_id' => $warehouse->id,
                'stock_movement_id' => $movement->id,
                'movement_type' => FuelOperationalLedger::TYPE_DELIVERY,
                'quantity_milliliters' => $delivery->received_milliliters,
                'book_balance_milliliters' => $movement->balance_quantity,
                'unit_cost_minor' => $delivery->received_unit_cost_minor,
                'value_minor' => $value,
                'idempotency_key' => "delivery:{$delivery->id}",
                'source_type' => FuelDelivery::class,
                'source_id' => $delivery->id,
                'occurred_at' => $delivery->received_at,
                'notes' => "استلام وقود معتمد؛ حركة تكلفة {$costMovement->id}",
            ]);
            $delivery->update([
                'status' => FuelDelivery::STATUS_APPROVED,
                'grni_account_id' => $grni->id,
                'stock_movement_id' => $movement->id,
                'journal_entry_id' => $entry->id,
                'fuel_operational_ledger_id' => $operational->id,
                'approved_by' => $actorId,
                'approved_at' => now(),
            ]);

            return $delivery->fresh();
        });
    }

    /** @param array<string, mixed> $data */
    public function createSupplierInvoice(array $data): FuelSupplierInvoice
    {
        $lines = $data['lines'] ?? [];
        if (! is_array($lines) || $lines === []) {
            throw new RuntimeException('فاتورة مورد الوقود تحتاج سطراً واحداً على الأقل.');
        }

        return DB::transaction(function () use ($data, $lines) {
            $supplier = Partner::findOrFail($data['supplier_id'] ?? '');
            $order = $this->resolveOrder($data['procurement_order_id'] ?? null, $supplier, null);
            $purchase = $this->resolvePurchase($data['purchase_id'] ?? null, $supplier);
            $number = trim((string) ($data['invoice_number'] ?? ''));
            if ($number === '') {
                throw new RuntimeException('رقم فاتورة المورد مطلوب.');
            }
            $existing = FuelSupplierInvoice::where('supplier_id', $supplier->id)->where('invoice_number', $number)->first();
            if ($existing !== null) {
                return $existing;
            }

            $invoice = FuelSupplierInvoice::create([
                'supplier_id' => $supplier->id,
                'procurement_order_id' => $order?->id,
                'purchase_id' => $purchase?->id,
                'invoice_number' => $number,
                'invoice_date' => $data['invoice_date'] ?? now()->toDateString(),
                'currency' => $data['currency'] ?? 'SAR',
                'status' => FuelSupplierInvoice::STATUS_UNMATCHED,
                'created_by' => $data['created_by'] ?? null,
                'evidence' => $data['evidence'] ?? null,
                'notes' => $this->nullableString($data['notes'] ?? null, 1000),
            ]);
            $totalQuantity = $totalValue = 0;
            foreach (array_values($lines) as $index => $line) {
                $fuelProduct = FuelProduct::findOrFail($line['fuel_product_id'] ?? '');
                $this->assertFuelProduct($fuelProduct);
                $quantity = $this->liters($line['quantity_liters'] ?? null, 'كمية سطر الفاتورة');
                $value = $this->positiveInteger($line['value_minor'] ?? null, 'قيمة سطر الفاتورة');
                if ($quantity <= 0) {
                    throw new RuntimeException('كمية سطر فاتورة المورد يجب أن تكون موجبة.');
                }
                $totalQuantity = $this->safeAdd($totalQuantity, $quantity, 'إجمالي كمية فاتورة المورد');
                $totalValue = $this->safeAdd($totalValue, $value, 'إجمالي قيمة فاتورة المورد');
                FuelSupplierInvoiceLine::create([
                    'fuel_supplier_invoice_id' => $invoice->id,
                    'fuel_product_id' => $fuelProduct->id,
                    'line_number' => $index + 1,
                    'quantity_milliliters' => $quantity,
                    'value_minor' => $value,
                ]);
            }
            $invoice->update(['total_quantity_milliliters' => $totalQuantity, 'total_value_minor' => $totalValue]);

            return $invoice->fresh('lines');
        });
    }

    /** @param array<string, mixed> $data */
    public function matchSupplierInvoiceLine(FuelSupplierInvoice $invoice, array $data, string $actorId): FuelSupplierInvoiceMatch
    {
        return DB::transaction(function () use ($invoice, $data, $actorId) {
            $invoice = FuelSupplierInvoice::lockForUpdate()->findOrFail($invoice->id);
            $line = FuelSupplierInvoiceLine::where('fuel_supplier_invoice_id', $invoice->id)
                ->lockForUpdate()->findOrFail($data['fuel_supplier_invoice_line_id'] ?? '');
            $delivery = FuelDelivery::lockForUpdate()->findOrFail($data['fuel_delivery_id'] ?? '');
            if ($delivery->status !== FuelDelivery::STATUS_APPROVED) {
                throw new RuntimeException('لا يمكن مطابقة فاتورة مع استلام وقود غير معتمد.');
            }
            if ($delivery->supplier_id !== $invoice->supplier_id || $delivery->fuel_product_id !== $line->fuel_product_id) {
                throw new RuntimeException('المورد أو منتج الوقود في الفاتورة لا يطابق الاستلام.');
            }
            $key = trim((string) ($data['idempotency_key'] ?? ''));
            if ($key === '') {
                throw new RuntimeException('مفتاح idempotency مطلوب لمطابقة فاتورة المورد.');
            }
            $existing = FuelSupplierInvoiceMatch::where('idempotency_key', $key)->first();
            if ($existing !== null) {
                return $existing;
            }

            $quantity = $this->liters($data['quantity_liters'] ?? null, 'كمية المطابقة');
            if ($quantity <= 0) {
                throw new RuntimeException('كمية المطابقة يجب أن تكون موجبة.');
            }
            $deliveryMatchedQuantity = (int) FuelSupplierInvoiceMatch::where('fuel_delivery_id', $delivery->id)->sum('matched_quantity_milliliters');
            $lineMatchedQuantity = (int) $line->matched_quantity_milliliters;
            if ($quantity > $delivery->received_milliliters - $deliveryMatchedQuantity || $quantity > $line->quantity_milliliters - $lineMatchedQuantity) {
                throw new RuntimeException('كمية المطابقة تتجاوز الكمية المتاحة في الاستلام أو سطر الفاتورة.');
            }

            $receiptValue = $this->allocatePortion(
                (int) $delivery->received_total_cost_minor,
                $deliveryMatchedQuantity,
                $quantity,
                (int) $delivery->received_milliliters,
            );
            $invoiceValue = $this->allocatePortion(
                (int) $line->value_minor,
                $lineMatchedQuantity,
                $quantity,
                (int) $line->quantity_milliliters,
            );
            $variance = $invoiceValue - $receiptValue;
            $cleared = min($invoiceValue, $receiptValue);
            $direction = $variance === 0 ? 'none' : ($variance > 0 ? 'invoice_higher_than_receipt' : 'invoice_lower_than_receipt');
            $status = $variance === 0 ? FuelSupplierInvoiceMatch::STATUS_MATCHED : FuelSupplierInvoiceMatch::STATUS_VALUE_VARIANCE_PENDING;
            $entry = $cleared > 0 ? $this->postGrniClearing($invoice, $delivery, $cleared, $actorId) : null;

            $match = FuelSupplierInvoiceMatch::create([
                'branch_id' => $delivery->branch_id,
                'fuel_supplier_invoice_id' => $invoice->id,
                'fuel_supplier_invoice_line_id' => $line->id,
                'fuel_delivery_id' => $delivery->id,
                'supplier_id' => $delivery->supplier_id,
                'fuel_station_id' => $delivery->fuel_station_id,
                'fuel_tank_id' => $delivery->fuel_tank_id,
                'fuel_product_id' => $delivery->fuel_product_id,
                'warehouse_id' => $delivery->warehouse_id,
                'grni_account_id' => $delivery->grni_account_id,
                'matched_quantity_milliliters' => $quantity,
                'matched_receipt_value_minor' => $receiptValue,
                'matched_invoice_value_minor' => $invoiceValue,
                'value_variance_minor' => $variance,
                'quantity_variance_milliliters' => 0,
                'variance_direction' => $direction,
                'currency' => $invoice->currency,
                'status' => $status,
                'cleared_value_minor' => $cleared,
                'journal_entry_id' => $entry?->id,
                'idempotency_key' => $key,
                'created_by' => $actorId,
            ]);
            $line->update([
                'matched_quantity_milliliters' => $lineMatchedQuantity + $quantity,
                'matched_value_minor' => (int) $line->matched_value_minor + $invoiceValue,
            ]);
            $invoice->matched_quantity_milliliters = (int) $invoice->matched_quantity_milliliters + $quantity;
            $invoice->matched_value_minor = (int) $invoice->matched_value_minor + $invoiceValue;
            $invoice->status = $this->invoiceStatus($invoice);
            $invoice->save();

            return $match;
        });
    }

    /** @return array{0:\App\Models\FuelStation,1:FuelTank,2:FuelProduct,3:Warehouse,4:Partner} */
    private function resolveDeliveryReferences(array $data): array
    {
        $station = \App\Models\FuelStation::findOrFail($data['fuel_station_id'] ?? '');
        $tank = FuelTank::findOrFail($data['fuel_tank_id'] ?? '');
        $fuelProduct = FuelProduct::findOrFail($data['fuel_product_id'] ?? '');
        $warehouse = Warehouse::findOrFail($data['warehouse_id'] ?? '');
        $supplier = Partner::findOrFail($data['supplier_id'] ?? '');
        $this->assertStationTankProductWarehouse($station->id, $tank, $fuelProduct, $warehouse);

        return [$station, $tank, $fuelProduct, $warehouse, $supplier];
    }

    private function assertStationTankProductWarehouse(string $stationId, FuelTank $tank, FuelProduct $fuelProduct, Warehouse $warehouse): void
    {
        $station = \App\Models\FuelStation::findOrFail($stationId);
        if ($tank->fuel_station_id !== $station->id || $tank->fuel_product_id !== $fuelProduct->id) {
            throw new RuntimeException('الخزان أو منتج الوقود لا ينتمي إلى المحطة المحددة.');
        }
        if ($station->warehouse_id !== $warehouse->id || ! $warehouse->is_active || $warehouse->branch_id !== $station->branch_id) {
            throw new RuntimeException('استلام الوقود يتطلب مخزن المحطة الصريح والنشط والمتوافق مع الفرع؛ لا fallback مسموح.');
        }
    }

    private function assertFuelProduct(FuelProduct $fuelProduct, ?Product $product = null): void
    {
        $product ??= Product::findOrFail($fuelProduct->product_id);
        if (! $product->track_inventory || ! $fuelProduct->is_active) {
            throw new RuntimeException('منتج الوقود يجب أن يكون نشطاً ومتابعاً مخزنياً.');
        }
        $this->quantity->assertFuelUnitMapping($fuelProduct, $product);
    }

    private function assertReadings(array $data, string $stationId, string $tankId): void
    {
        foreach (['before_physical_reading_id', 'after_physical_reading_id', 'before_atg_reading_id', 'after_atg_reading_id'] as $key) {
            if (empty($data[$key])) {
                continue;
            }
            $reading = FuelTankReading::findOrFail($data[$key]);
            if ($reading->fuel_station_id !== $stationId || $reading->fuel_tank_id !== $tankId) {
                throw new RuntimeException('دليل قراءة الاستلام لا ينتمي إلى المحطة والخزان المحددين.');
            }
            $requiredType = str_contains($key, 'physical') ? 'physical' : 'atg';
            if ($reading->reading_type !== $requiredType) {
                throw new RuntimeException('نوع دليل القراءة لا يطابق حقل الاستلام.');
            }
        }
    }

    private function resolveOrder(?string $id, Partner $supplier, ?string $branchId): ?ProcurementDocument
    {
        if ($id === null || $id === '') {
            return null;
        }
        $order = ProcurementDocument::findOrFail($id);
        if ($order->type !== 'order' || $order->partner_id !== $supplier->id || ($branchId !== null && $order->branch_id !== $branchId)) {
            throw new RuntimeException('مرجع أمر الشراء لا يطابق المورد أو فرع الاستلام.');
        }

        return $order;
    }

    private function resolvePurchase(?string $id, Partner $supplier): ?Purchase
    {
        if ($id === null || $id === '') {
            return null;
        }
        $purchase = Purchase::findOrFail($id);
        if ($purchase->partner_id !== $supplier->id || ! $purchase->isDraft()) {
            throw new RuntimeException('فاتورة الشراء المرتبطة يجب أن تكون مسودة وتخص المورد نفسه.');
        }

        return $purchase;
    }

    private function postGrniClearing(FuelSupplierInvoice $invoice, FuelDelivery $delivery, int $value, string $actorId): JournalEntry
    {
        $grni = Account::findOrFail($delivery->grni_account_id);
        $payable = Account::where('code', self::PAYABLE_CODE)->first();
        if (! $payable || ! $payable->is_active || $payable->is_group || $payable->type !== 'liability') {
            throw new RuntimeException('حساب الموردين القياسي غير صالح لترحيل مطابقة GRNI.');
        }

        return $this->ledger->post([
            ['account_id' => $grni->id, 'debit' => $value, 'branch_id' => $delivery->branch_id],
            ['account_id' => $payable->id, 'credit' => $value, 'branch_id' => $delivery->branch_id, 'partner_type' => Partner::class, 'partner_id' => $delivery->supplier_id],
        ], [
            'entry_date' => now()->toDateString(),
            'description' => "تسوية GRNI لاستلام الوقود {$delivery->delivery_note_number}",
            'source_type' => FuelSupplierInvoice::class,
            'source_id' => $invoice->id,
            'created_by' => $actorId,
        ]);
    }

    private function inventoryAccountId(): string
    {
        $account = Account::where('code', '1140')->first();
        if (! $account || ! $account->is_active || $account->is_group || $account->type !== 'asset') {
            throw new RuntimeException('حساب مخزون الوقود غير صالح للترحيل.');
        }

        return $account->id;
    }

    private function invoiceStatus(FuelSupplierInvoice $invoice): string
    {
        if ($invoice->matches()->where('status', FuelSupplierInvoiceMatch::STATUS_VALUE_VARIANCE_PENDING)->exists()) {
            return FuelSupplierInvoice::STATUS_VALUE_VARIANCE_PENDING;
        }

        return $invoice->matched_quantity_milliliters >= $invoice->total_quantity_milliliters
            && $invoice->matched_value_minor >= $invoice->total_value_minor
            ? FuelSupplierInvoice::STATUS_MATCHED
            : FuelSupplierInvoice::STATUS_PARTIALLY_MATCHED;
    }

    private function allocatePortion(int $totalValue, int $alreadyMatchedQuantity, int $quantity, int $totalQuantity): int
    {
        if ($totalQuantity <= 0 || $alreadyMatchedQuantity < 0 || $quantity <= 0 || $alreadyMatchedQuantity + $quantity > $totalQuantity) {
            throw new RuntimeException('بيانات تخصيص المطابقة غير صالحة.');
        }
        [$atEnd] = $this->mulDiv($totalValue, $alreadyMatchedQuantity + $quantity, $totalQuantity);
        [$before] = $this->mulDiv($totalValue, $alreadyMatchedQuantity, $totalQuantity);

        return $atEnd - $before;
    }

    /** @return array{0:int,1:int} */
    private function mulDiv(int $a, int $b, int $divisor): array
    {
        if ($a < 0 || $b < 0 || $divisor <= 0) {
            throw new RuntimeException('حساب قيمة المطابقة غير صالح.');
        }
        $quotient = 0;
        $remainder = 0;
        $whole = intdiv($a, $divisor);
        $fraction = $a % $divisor;
        while ($b > 0) {
            if ($b % 2 === 1) {
                $quotient = $this->safeAdd($quotient, $whole, 'قيمة المطابقة');
                if ($fraction > 0) {
                    if ($remainder >= $divisor - $fraction) {
                        $quotient = $this->safeAdd($quotient, 1, 'قيمة المطابقة');
                        $remainder -= $divisor - $fraction;
                    } else {
                        $remainder += $fraction;
                    }
                }
            }
            $b = intdiv($b, 2);
            if ($b === 0) {
                break;
            }
            $whole = $this->safeAdd($whole, $whole, 'عامل قيمة المطابقة');
            if ($fraction > 0) {
                if ($fraction >= $divisor - $fraction) {
                    $whole = $this->safeAdd($whole, 1, 'عامل قيمة المطابقة');
                    $fraction -= $divisor - $fraction;
                } else {
                    $fraction += $fraction;
                }
            }
        }

        return [$quotient, $remainder];
    }

    private function liters(mixed $value, string $label): int
    {
        if (! is_string($value) && ! is_int($value)) {
            throw new RuntimeException("{$label} مطلوب باللترات.");
        }

        return $this->quantity->litersToMilliliters($value);
    }

    private function positiveInteger(mixed $value, string $label): int
    {
        if (! is_int($value) || $value < 0) {
            throw new RuntimeException("{$label} يجب أن تكون هللات صحيحة غير سالبة.");
        }

        return $value;
    }

    private function nullableInteger(mixed $value): ?int
    {
        if ($value === null || $value === '') {
            return null;
        }
        if (! is_int($value)) {
            throw new RuntimeException('القيمة الرقمية يجب أن تكون عدداً صحيحاً.');
        }

        return $value;
    }

    private function nullableString(mixed $value, int $limit): ?string
    {
        if ($value === null) {
            return null;
        }
        $value = trim((string) $value);
        if ($value === '') {
            return null;
        }
        if (mb_strlen($value) > $limit) {
            throw new RuntimeException('النص يتجاوز الحد المسموح به.');
        }

        return $value;
    }

    private function safeAdd(int $left, int $right, string $label): int
    {
        if ($right > PHP_INT_MAX - $left) {
            throw new RuntimeException("{$label} يتجاوز الحد المسموح به.");
        }

        return $left + $right;
    }
}
