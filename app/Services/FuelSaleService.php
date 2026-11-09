<?php

namespace App\Services;

use App\Models\Account;
use App\Models\Invoice;
use App\Models\FuelNozzle;
use App\Models\FuelOperationalLedger;
use App\Models\FuelProduct;
use App\Models\FuelPump;
use App\Models\FuelTank;
use App\Models\FuelSale;
use App\Models\FuelSalePaymentReceipt;
use App\Models\FuelShift;
use App\Models\FuelStation;
use App\Models\Product;
use App\Models\Payment;
use App\Models\PaymentMethod;
use App\Models\ProductWarehouseStock;
use App\Models\User;
use App\Models\FuelShiftEvent;
use App\Models\Warehouse;
use App\Services\Accounting\AccountRoleResolver;
use App\Services\Accounting\InventoryService;
use App\Services\Accounting\InvoiceLinePrecision;
use App\Services\Accounting\InvoiceService;
use App\Services\Accounting\PaymentService;
use App\Services\Accounting\LedgerService;
use App\Tenancy\BranchContext;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;
use RuntimeException;

/**
 * Cycle 5: FuelSale هو مصدر عملية البيع؛ الفاتورة وسند القبض والمخزون محركات
 * Nebrax القائمة. لا تتحول قراءات Cycle 4 ولا حركات نقده إلى مبيعات أو دفعات.
 */
class FuelSaleService
{
    public function __construct(
        private FuelStationProductPriceService $prices,
        private FuelCostBasisService $costBasis,
        private FuelQuantity $quantity,
        private InventoryService $inventory,
        private InvoiceLinePrecision $linePrecision,
        private InvoiceService $invoices,
        private PaymentService $payments,
        private FuelStationSettingsService $settings,
        private LedgerService $ledger,
        private CorporateFuelAuthorizationService $corporateAuthorizations,
        private FuelAviAuthorizationService $aviAuthorizations,
        private FuelFleetService $fleet,
        private AccountRoleResolver $roles,
        private FuelShiftCashExpectationService $cashExpectation,
    ) {}

    /** @param array<string,mixed> $attributes */
    public function createDraft(array $attributes, User $actor): FuelSale
    {
        $stationId = $this->requiredString($attributes, 'fuel_station_id');
        $nozzleId = $this->requiredString($attributes, 'fuel_nozzle_id');
        $idempotencyKey = $this->requiredString($attributes, 'idempotency_key');
        $quantity = $this->positiveInteger($attributes['quantity_milliliters'] ?? null, 'quantity_milliliters');

        try {
            return DB::transaction(function () use ($attributes, $actor, $stationId, $nozzleId, $idempotencyKey, $quantity) {
                $station = $this->lockStation($stationId);
                $this->assertStationBranch($station);
                // #2016: نطاق الفاعل قبل أي قفل/قراءة لتفويض AVI أو فوهة أو وردية (ترتيب الأقفال: المحطة ← AVI كما في finalize).
                $this->assertActorStationScope($actor, $station);
                $attributes = $this->aviAuthorizations->prepareDraftAttributes($attributes);
                $nozzle = FuelNozzle::lockForUpdate()->findOrFail($nozzleId);
                $this->assertNozzleForStation($nozzle, $station);
                $this->lockReferencedRows($nozzle, $attributes['fuel_shift_id'] ?? null);
                $this->assertNozzleEquipmentOperational($nozzle, $station);
                $warehouse = $this->warehouse($station);
                $fuelProduct = FuelProduct::findOrFail($nozzle->fuel_product_id);
                $product = Product::findOrFail($fuelProduct->product_id);
                $this->quantity->assertFuelUnitMapping($fuelProduct, $product);
                $this->assertMeterRange($attributes, $quantity);
                $this->assertOptionalPartner($attributes['partner_id'] ?? null);
                $this->assertOptionalShift($attributes['fuel_shift_id'] ?? null, $station);

                $existing = FuelSale::where('idempotency_key', $idempotencyKey)->first();
                if ($existing !== null) {
                    if ($existing->fuel_station_id !== $station->id || (int) $existing->quantity_milliliters !== $quantity) {
                        throw new RuntimeException('مفتاح منع التكرار استُخدم سابقاً لبيع وقود مختلف.');
                    }
                    return $existing;
                }

                $sale = FuelSale::create([
                    'branch_id' => $station->branch_id,
                    'number' => FuelSale::nextDocumentNumber('FSL', $this->settings->businessDate($station), $station->branch_id),
                    'status' => FuelSale::STATUS_DRAFT,
                    'fuel_station_id' => $station->id,
                    'warehouse_id' => $warehouse->id,
                    'fuel_shift_id' => $attributes['fuel_shift_id'] ?? null,
                    'fuel_pump_id' => $nozzle->fuel_pump_id,
                    'fuel_nozzle_id' => $nozzle->id,
                    'fuel_tank_id' => $nozzle->fuel_tank_id,
                    'fuel_product_id' => $fuelProduct->id,
                    'product_id' => $product->id,
                    'partner_id' => $attributes['partner_id'] ?? null,
                    // Cycle 6: هذه مراجع طلب، وتتحول إلى snapshot مقفل فقط بعد
                    // أن ينجح التفويض الخادمي قبل أثر Invoice/Inventory/COGS.
                    'corporate_fuel_contract_id' => $attributes['corporate_fuel_contract_id'] ?? null,
                    'fuel_card_id' => $attributes['fuel_card_id'] ?? null,
                    'fuel_fleet_vehicle_id' => $attributes['fuel_fleet_vehicle_id'] ?? null,
                    'fuel_fleet_driver_id' => $attributes['fuel_fleet_driver_id'] ?? null,
                    'fuel_avi_authorization_id' => $attributes['fuel_avi_authorization_id'] ?? null,
                    'odometer_snapshot' => $attributes['odometer'] ?? null,
                    'quantity_milliliters' => $quantity,
                    'meter_start_milliliters' => $attributes['meter_start_milliliters'] ?? null,
                    'meter_end_milliliters' => $attributes['meter_end_milliliters'] ?? null,
                    'meter_source_reference' => $this->nullableText($attributes['meter_source_reference'] ?? null),
                    'source_references' => $attributes['source_references'] ?? null,
                    'payment_status' => FuelSale::PAYMENT_UNPAID,
                    'paid_minor' => 0,
                    'idempotency_key' => $idempotencyKey,
                    'created_by' => $actor->id,
                ]);
                $this->aviAuthorizations->attachToSale($sale);

                return $sale;
            });
        } catch (QueryException $exception) {
            throw new RuntimeException('تعذر إنشاء مسودة البيع بسبب تضارب متزامن؛ أعد المحاولة بالمفتاح نفسه.', previous: $exception);
        }
    }

    public function finalize(FuelSale $sale, User $actor): FuelSale
    {
        return DB::transaction(function () use ($sale, $actor) {
            $sale = FuelSale::lockForUpdate()->findOrFail($sale->id);
            // #2016: لا يرى فاعل خارج نطاق المحطة حتى حالة البيع (إعادة إنهاء نهائي أو رسالة «ملغى») — قبل أي إرجاع.
            $this->assertActorStationScope($actor, FuelStation::findOrFail($sale->fuel_station_id));
            if ($sale->isFinalized()) {
                return $sale->fresh(['invoice', 'stockMovement', 'cogsJournalEntry']);
            }
            if (! $sale->isDraft()) {
                throw new RuntimeException('لا يمكن إنهاء بيع وقود ملغى أو غير مسود.');
            }
            if ($sale->partner_id === null) {
                throw new RuntimeException('يتطلب إنهاء بيع الوقود عميلاً صريحاً للفواتير والذمم الرسمية.');
            }

            $station = $this->lockStation($sale->fuel_station_id);
            $this->assertStationBranch($station);
            $this->assertActorStationScope($actor, $station);
            $warehouse = $this->warehouse($station);
            if ($warehouse->id !== $sale->warehouse_id) {
                throw new RuntimeException('تغير مخزن المحطة بعد إنشاء مسودة البيع؛ أنشئ مسودة جديدة لحفظ التاريخ.');
            }
            $nozzle = FuelNozzle::lockForUpdate()->findOrFail($sale->fuel_nozzle_id);
            $this->assertNozzleForStation($nozzle, $station);
            if ($nozzle->fuel_product_id !== $sale->fuel_product_id || $nozzle->fuel_tank_id !== $sale->fuel_tank_id || $nozzle->fuel_pump_id !== $sale->fuel_pump_id) {
                throw new RuntimeException('تغير ربط الفوهة بالمنتج أو الخزان أو المضخة؛ لا يمكن إنهاء مسودة البيع الحالية.');
            }
            $this->lockReferencedRows($nozzle);
            // FUEL-P1-1: المضخة والخزان يجب أن يكونا نشطين وقت الإنهاء أيضاً (قراءة بلا قفل — انظر الدالة).
            $this->assertNozzleEquipmentOperational($nozzle, $station);
            $this->assertFinalizationShift($sale, $station);
            $this->aviAuthorizations->assertFinalizationAllowed($sale);

            $fuelProduct = FuelProduct::findOrFail($sale->fuel_product_id);
            $product = Product::findOrFail($sale->product_id);
            if ($fuelProduct->product_id !== $product->id || ! $fuelProduct->is_active) {
                throw new RuntimeException('منتج الوقود في المسودة لم يعد صالحاً للإنهاء.');
            }
            $this->quantity->assertFuelUnitMapping($fuelProduct, $product);
            $finalizationAt = now();
            // FS-19: تاريخ الفاتورة والاستحقاق والقيد بتقويم المحطة لا بمنطقة التطبيق.
            $businessMoment = $this->settings->businessMoment($station, $finalizationAt);
            $authorization = $this->corporateAuthorizations->resolve($sale, $station, $fuelProduct, $finalizationAt);
            if ($authorization !== null && $authorization['price_source'] === 'contract_special_price') {
                $pricePerLiter = $authorization['price_per_liter_minor'];
                $taxMode = $authorization['tax_mode'];
            } else {
                // يحافظ fallback على resolver Cycle 5 كاملاً: station override ثم
                // tenant default ثم fail-closed؛ لا يعيد Cycle 6 بناءه أو يقرأ Product.sale_price.
                $stationPrice = $this->prices->effective($station, $fuelProduct, $finalizationAt);
                $pricePerLiter = (int) $stationPrice->price_per_liter_minor;
                $taxMode = $this->settings->fuelPriceTaxMode($station);
            }
            $precision = $this->linePrecision->fromItem([
                'quantity_numerator' => $sale->quantity_milliliters,
                'quantity_denominator' => FuelQuantity::MILLILITERS_PER_LITER,
            ], $pricePerLiter) ?? throw new RuntimeException('تعذر بناء تسعير الوقود النسبي.');

            $invoice = $this->invoices->create([
                'partner_id' => $sale->partner_id,
                'branch_id' => $station->branch_id,
                'warehouse_id' => $warehouse->id,
                'payment_type' => 'credit',
                'is_paid' => false,
                'invoice_date' => $businessMoment->toDateString(),
                'due_date' => $authorization === null
                    ? $businessMoment->toDateString()
                    : $businessMoment->addDays((int) $authorization['contract']->payment_terms_days)->toDateString(),
                'tax_inclusive' => $taxMode === 'tax_inclusive',
                'notes' => "بيع وقود {$sale->number}",
                'created_by' => $actor->id,
            ], [[
                'product_id' => $product->id,
                'description' => $fuelProduct->name,
                'unit' => $fuelProduct->display_unit,
                'quantity_numerator' => $precision['quantity_numerator'],
                'quantity_denominator' => $precision['quantity_denominator'],
                'unit_price' => $pricePerLiter,
                'tax_rate' => (int) \App\Support\Settings::get('sales', 'default_tax_rate'),
            ]]);

            // لا يوجد read→write مفصول في الائتمان: تتحقق الخدمة بعد أن تحسب
            // الفاتورة المسودة الإجمالي الرسمي وقبل post()/المخزون/COGS.
            if ($authorization !== null) {
                $this->corporateAuthorizations->assertFinancialLimits($authorization, $sale, $station, (int) $invoice->total);
            }

            $stockMovement = null;
            $cogsEntry = null;
            $cogsMinor = 0;
            $invoice = $this->invoices->post($invoice, function ($postedInvoice) use ($sale, $station, $warehouse, $fuelProduct, $product, &$stockMovement, &$cogsEntry, &$cogsMinor, $actor) {
                $this->lockWarehouseStock($warehouse->id, $product->id);
                $quote = $this->costBasis->quoteIssue($fuelProduct, $warehouse, (int) $sale->quantity_milliliters);
                $cogsMinor = $quote['posted_cost_minor'];
                $unitCost = intdiv($cogsMinor, (int) $sale->quantity_milliliters);
                $stockMovement = $this->inventory->applyIssue($product, (int) $sale->quantity_milliliters, $unitCost, [
                    'warehouse_id' => $warehouse->id,
                    'branch_id' => $station->branch_id,
                    'source_type' => FuelSale::class,
                    'source_id' => $sale->id,
                    'date' => $postedInvoice->invoice_date->toDateString(),
                    'notes' => "صرف وقود عبر البيع {$sale->number}",
                    'enforce_stock' => true,
                    InventoryService::FUEL_POOL_META => true,
                ], $cogsMinor);
                $cogsEntry = $this->postFuelCogs($station, $cogsMinor, $postedInvoice, $actor);
                $this->costBasis->recordIssue($fuelProduct, $warehouse, $stockMovement, (int) $sale->quantity_milliliters, $cogsMinor, $cogsEntry);

                return $cogsEntry;
            });

            if ($stockMovement === null) {
                throw new RuntimeException('تعذر تثبيت حركة مخزون بيع الوقود.');
            }
            $bookBalance = (int) (ProductWarehouseStock::where('warehouse_id', $warehouse->id)
                ->where('product_id', $product->id)->value('quantity') ?? 0);
            FuelOperationalLedger::create([
                'branch_id' => $station->branch_id,
                'fuel_station_id' => $station->id,
                'fuel_tank_id' => $sale->fuel_tank_id,
                'fuel_product_id' => $fuelProduct->id,
                'warehouse_id' => $warehouse->id,
                'stock_movement_id' => $stockMovement->id,
                'movement_type' => FuelOperationalLedger::TYPE_SALE,
                'quantity_milliliters' => -(int) $sale->quantity_milliliters,
                'book_balance_milliliters' => $bookBalance,
                'unit_cost_minor' => intdiv($cogsMinor, (int) $sale->quantity_milliliters),
                'value_minor' => -$cogsMinor,
                'idempotency_key' => 'fuel-sale:' . $sale->id,
                'source_type' => FuelSale::class,
                'source_id' => $sale->id,
                'occurred_at' => now(),
                'notes' => "بيع وقود نهائي {$sale->number}",
            ]);

            if ($authorization !== null) {
                $this->corporateAuthorizations->recordApprovedUsage($authorization, $sale, $station, (int) $invoice->total);
                if ($authorization['odometer'] !== null && $authorization['vehicle'] !== null) {
                    $this->fleet->recordOdometer($authorization['vehicle'], $authorization['odometer'], $sale->id, $actor);
                }
            }

            $sale->update([
                'status' => FuelSale::STATUS_FINALIZED,
                'price_per_liter_minor' => $pricePerLiter,
                'fuel_price_tax_mode' => $taxMode,
                'pricing_numerator' => $precision['pricing_numerator'],
                'pricing_denominator' => $precision['pricing_denominator'],
                'gross_minor' => $precision['rounded_gross_minor'],
                'rounding_remainder_numerator' => $precision['rounding_remainder_numerator'],
                'rounding_remainder_denominator' => $precision['rounding_remainder_denominator'],
                'rounding_policy' => $precision['rounding_policy'],
                'invoice_id' => $invoice->id,
                'stock_movement_id' => $stockMovement->id,
                'cogs_journal_entry_id' => $cogsEntry?->id,
                'cogs_minor' => $cogsMinor,
                'corporate_fuel_contract_id' => $authorization === null ? null : $authorization['contract']->id,
                'corporate_fuel_contract_price_id' => $authorization === null ? null : $authorization['contract_price_id'],
                'fuel_card_id' => $authorization === null ? null : $authorization['card']?->id,
                'fuel_fleet_vehicle_id' => $authorization === null ? null : $authorization['vehicle']?->id,
                'fuel_fleet_driver_id' => $authorization === null ? null : $authorization['driver']?->id,
                'corporate_price_source' => $authorization === null ? null : $authorization['price_source'],
                'contract_payment_terms_days' => $authorization === null ? null : (int) $authorization['contract']->payment_terms_days,
                'odometer_snapshot' => $authorization === null ? null : $authorization['odometer'],
                'finalized_at' => $finalizationAt,
                'finalized_by' => $actor->id,
            ]);

            return $sale->fresh(['invoice.lines', 'stockMovement', 'cogsJournalEntry']);
        });
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  بيع التسوية (P1-3b-2b) — متغيّر **منفصل** عن finalize ولا يعدّله (مسار البيع المباشر القائم لم يتغيّر حرفياً)
    // ═══════════════════════════════════════════════════════════════════════
    //  الفروقات المقصودة عن finalize (التصميم §2.3): وردية مغلقة، تاريخ الفاتورة = تاريخ التوريد (لا اليوم)، السعر ووضع الضريبة من تقييم التسوية المثبَّت (لا now())،
    //  العميل = عميل المحطة النقدي، لا تفويض عقود شركات، لا شرط تشغيل الفوهة/المضخة/الخزان الآن (الوقود وُزِّع في الماضي)، `source = settlement`.
    //  مقسوم مرحلتين كي يبقى ترتيب الأقفال: كل **الترقيم** (فرع المستندات) قبل أي مِرساة محاسبة، ثم الترحيل بعدها:
    //    prepareSettlementSale()  ⇒ مسودة بيع + مسودة فاتورة (ترقيم فقط، بلا قيد ولا مخزون)
    //    postSettlementSale()     ⇒ ترحيل الفاتورة + COGS + حركة مخزون + سجل تشغيلي، ثم إنهاء البيع.

    /**
     * @param  array{nozzle_id:string,residual_milliliters:int,price_per_liter_minor:int}  $line
     * @return array{sale:FuelSale,invoice:Invoice}
     */
    public function prepareSettlementSale(array $line, FuelShift $shift, string $partnerId, string $supplyDate, ?string $taxMode, User $actor): array
    {
        $station = FuelStation::findOrFail($shift->fuel_station_id);          // المحطة والوردية مقفلتان من المستدعي
        $this->assertStationBranch($station);
        $this->assertActorStationScope($actor, $station);
        $nozzle = FuelNozzle::lockForUpdate()->findOrFail($line['nozzle_id']);
        if ($nozzle->fuel_station_id !== $station->id || $nozzle->branch_id !== $station->branch_id) {
            throw new RuntimeException('الفوهة لا تخص محطة/فرع التسوية.');
        }
        $this->lockReferencedRows($nozzle);
        $warehouse = $this->warehouse($station);
        $fuelProduct = FuelProduct::findOrFail($nozzle->fuel_product_id);
        $product = Product::findOrFail($fuelProduct->product_id);
        $this->quantity->assertFuelUnitMapping($fuelProduct, $product);
        $quantity = $this->positiveInteger($line['residual_milliliters'] ?? null, 'residual_milliliters');
        $price = $this->positiveInteger($line['price_per_liter_minor'] ?? null, 'price_per_liter_minor');
        $idempotencyKey = 'fuel-settle:'.$shift->id.':'.$nozzle->id;
        if (FuelSale::where('idempotency_key', $idempotencyKey)->exists()) {
            throw new RuntimeException('FUEL_SETTLEMENT_SALE_EXISTS: بيع التسوية لهذه الفوهة مسجَّل سابقاً.');
        }

        $sale = new FuelSale();
        $sale->forceFill([
            'branch_id' => $station->branch_id,
            'number' => FuelSale::nextDocumentNumber('FSL', $supplyDate, $station->branch_id),
            'status' => FuelSale::STATUS_DRAFT,
            'source' => 'settlement',
            'fuel_station_id' => $station->id,
            'warehouse_id' => $warehouse->id,
            'fuel_shift_id' => $shift->id,
            'fuel_pump_id' => $nozzle->fuel_pump_id,
            'fuel_nozzle_id' => $nozzle->id,
            'fuel_tank_id' => $nozzle->fuel_tank_id,
            'fuel_product_id' => $fuelProduct->id,
            'product_id' => $product->id,
            'partner_id' => $partnerId,
            'quantity_milliliters' => $quantity,
            'payment_status' => FuelSale::PAYMENT_UNPAID,
            'paid_minor' => 0,
            'idempotency_key' => $idempotencyKey,
            'created_by' => $actor->id,
        ])->save();

        $precision = $this->linePrecision->fromItem([
            'quantity_numerator' => $quantity,
            'quantity_denominator' => FuelQuantity::MILLILITERS_PER_LITER,
        ], $price) ?? throw new RuntimeException('تعذر بناء تسعير الوقود النسبي.');
        $invoice = $this->invoices->create([
            'partner_id' => $partnerId,
            'branch_id' => $station->branch_id,
            'warehouse_id' => $warehouse->id,
            'payment_type' => 'credit',
            'is_paid' => false,
            'invoice_date' => $supplyDate,
            'due_date' => $supplyDate,
            'tax_inclusive' => $taxMode === 'tax_inclusive',
            'notes' => "تسوية وردية {$shift->number} — فوهة {$nozzle->nozzle_number} ({$sale->number})",
            'created_by' => $actor->id,
        ], [[
            'product_id' => $product->id,
            'description' => $fuelProduct->name,
            'unit' => $fuelProduct->display_unit,
            'quantity_numerator' => $precision['quantity_numerator'],
            'quantity_denominator' => $precision['quantity_denominator'],
            'unit_price' => $price,
            'tax_rate' => (int) \App\Support\Settings::get('sales', 'default_tax_rate'),
        ]]);

        return ['sale' => $sale, 'invoice' => $invoice];
    }

    /**
     * أقفال صفوف التسوية الخارجية بترتيب معرّفات ثابت، **بلا أي إدراج** (يستدعيه محرك التسوية قبل المِرساة).
     * كل فوهة في الأسطر (لا المرحَّلة وحدها: يُدرَج لكل سطر صف بعد المِرساة فيأخذ KEY SHARE على فوهته) بـFOR UPDATE ثم مضختها وخزانها، ثم منتجات الوقود والمخزن
     * وطرق الدفع بـKEY SHARE (الأصول التي تُشير إليها صفوف التسوية).
     *
     * @param  list<array<string,mixed>>  $lines
     * @param  list<string>  $paymentMethodIds
     */
    public function lockSettlementRows(FuelShift $shift, array $lines, array $paymentMethodIds = []): void
    {
        $nozzleIds = collect($lines)->pluck('nozzle_id')->unique()->sort()->values()->all();
        foreach ($nozzleIds as $nozzleId) {
            $nozzle = FuelNozzle::lockForUpdate()->findOrFail($nozzleId);
            $this->lockReferencedRows($nozzle);
        }
        $productIds = collect($lines)->pluck('fuel_product_id')->filter()->unique()->sort()->values()->all();
        if ($productIds !== []) {
            FuelProduct::query()->whereIn('id', $productIds)->orderBy('id')->lock('for key share')->get();
        }
        $station = FuelStation::findOrFail($shift->fuel_station_id);
        Warehouse::query()->whereKey($station->warehouse_id)->lock('for key share')->first();
        if ($paymentMethodIds !== []) {
            PaymentMethod::query()->whereIn('id', collect($paymentMethodIds)->filter()->sort()->values()->all())->orderBy('id')->lock('for key share')->get();
        }
    }

    public function postSettlementSale(FuelSale $sale, Invoice $invoice, FuelShift $shift, int $pricePerLiterMinor, ?string $taxMode, User $actor): FuelSale
    {
        $sale = FuelSale::lockForUpdate()->findOrFail($sale->id);
        if (! $sale->isDraft() || $sale->source !== 'settlement' || $sale->fuel_shift_id !== $shift->id) {
            throw new RuntimeException('FUEL_SETTLEMENT_SALE_INVALID: ليست مسودة بيع تسوية لهذه الوردية.');
        }
        $station = FuelStation::findOrFail($sale->fuel_station_id);
        $warehouse = $this->warehouse($station);
        if ($warehouse->id !== $sale->warehouse_id) {
            throw new RuntimeException('تغير مخزن المحطة بعد تجهيز بيع التسوية.');
        }
        $fuelProduct = FuelProduct::findOrFail($sale->fuel_product_id);
        $product = Product::findOrFail($sale->product_id);
        if ($fuelProduct->product_id !== $product->id || ! $fuelProduct->is_active) {
            throw new RuntimeException('منتج الوقود في بيع التسوية لم يعد صالحاً.');
        }
        $this->quantity->assertFuelUnitMapping($fuelProduct, $product);
        $precision = $this->linePrecision->fromItem([
            'quantity_numerator' => $sale->quantity_milliliters,
            'quantity_denominator' => FuelQuantity::MILLILITERS_PER_LITER,
        ], $pricePerLiterMinor) ?? throw new RuntimeException('تعذر بناء تسعير الوقود النسبي.');

        $stockMovement = null;
        $cogsEntry = null;
        $cogsMinor = 0;
        $invoice = $this->invoices->post($invoice, function ($postedInvoice) use ($sale, $station, $warehouse, $fuelProduct, $product, &$stockMovement, &$cogsEntry, &$cogsMinor, $actor) {
            $this->lockWarehouseStock($warehouse->id, $product->id);
            $quote = $this->costBasis->quoteIssue($fuelProduct, $warehouse, (int) $sale->quantity_milliliters, allowOpenHistory: true);   // التسوية تحجب بفحصها الخاص
            $cogsMinor = $quote['posted_cost_minor'];
            $unitCost = intdiv($cogsMinor, (int) $sale->quantity_milliliters);
            $stockMovement = $this->inventory->applyIssue($product, (int) $sale->quantity_milliliters, $unitCost, [
                'warehouse_id' => $warehouse->id,
                'branch_id' => $station->branch_id,
                'source_type' => FuelSale::class,
                'source_id' => $sale->id,
                'date' => $postedInvoice->invoice_date->toDateString(),
                'notes' => "صرف وقود عبر تسوية الوردية {$sale->number}",
                'enforce_stock' => true,
                InventoryService::FUEL_POOL_META => true,
            ], $cogsMinor);
            $cogsEntry = $this->postFuelCogs($station, $cogsMinor, $postedInvoice, $actor);
            $this->costBasis->recordIssue($fuelProduct, $warehouse, $stockMovement, (int) $sale->quantity_milliliters, $cogsMinor, $cogsEntry);

            return $cogsEntry;
        });
        if ($stockMovement === null) {
            throw new RuntimeException('تعذر تثبيت حركة مخزون بيع التسوية.');
        }

        $bookBalance = (int) (ProductWarehouseStock::where('warehouse_id', $warehouse->id)->where('product_id', $product->id)->value('quantity') ?? 0);
        FuelOperationalLedger::create([
            'branch_id' => $station->branch_id,
            'fuel_station_id' => $station->id,
            'fuel_tank_id' => $sale->fuel_tank_id,
            'fuel_product_id' => $fuelProduct->id,
            'warehouse_id' => $warehouse->id,
            'stock_movement_id' => $stockMovement->id,
            'movement_type' => FuelOperationalLedger::TYPE_SALE,
            'quantity_milliliters' => -(int) $sale->quantity_milliliters,
            'book_balance_milliliters' => $bookBalance,
            'unit_cost_minor' => intdiv($cogsMinor, (int) $sale->quantity_milliliters),
            'value_minor' => -$cogsMinor,
            'idempotency_key' => 'fuel-sale:'.$sale->id,
            'source_type' => FuelSale::class,
            'source_id' => $sale->id,
            'occurred_at' => now(),                       // لحظة الترحيل (D-E5)؛ «متى وُزّع الوقود» في رأس التسوية (supply_*)
            'notes' => "بيع تسوية وردية {$sale->number}",
        ]);

        $sale->update([
            'status' => FuelSale::STATUS_FINALIZED,
            'price_per_liter_minor' => $pricePerLiterMinor,
            'fuel_price_tax_mode' => $taxMode,
            'pricing_numerator' => $precision['pricing_numerator'],
            'pricing_denominator' => $precision['pricing_denominator'],
            'gross_minor' => $precision['rounded_gross_minor'],
            'rounding_remainder_numerator' => $precision['rounding_remainder_numerator'],
            'rounding_remainder_denominator' => $precision['rounding_remainder_denominator'],
            'rounding_policy' => $precision['rounding_policy'],
            'invoice_id' => $invoice->id,
            'stock_movement_id' => $stockMovement->id,
            'cogs_journal_entry_id' => $cogsEntry?->id,
            'cogs_minor' => $cogsMinor,
            'finalized_at' => now(),
            'finalized_by' => $actor->id,
        ]);

        return $sale->fresh(['invoice.lines', 'stockMovement', 'cogsJournalEntry']);
    }

    /** @param array<string,mixed> $attributes */
    public function collectPayment(FuelSale $sale, array $attributes, User $actor): Payment
    {
        $idempotencyKey = $this->requiredString($attributes, 'idempotency_key');
        $paymentMethodId = $this->requiredString($attributes, 'payment_method_id');
        $amount = $this->positiveInteger($attributes['amount_minor'] ?? null, 'amount_minor');

        return DB::transaction(function () use ($sale, $attributes, $actor, $idempotencyKey, $paymentMethodId, $amount) {
            // FUEL-LOCK-ORDER: الترتيب الموحَّد [المحطة] ← الوردية ← البيع ← الفاتورة. كان هنا البيع ثم الفاتورة ثم الوردية (FOR SHARE) فيعاكس
            // الإغلاق/التسوية (الوردية ثم البيع) ⇒ دورة. الآن: قراءة عادية للبيع والمحطة (بلا قفل) ← قفل الوردية المعنية FOR SHARE ← ثم البيع والفاتورة.
            $peek = FuelSale::findOrFail($sale->id);
            $station = FuelStation::findOrFail($peek->fuel_station_id);
            // #2016: نطاق الفاعل قبل كل شيء — بما فيه إعادة إرسال مفتاح التحصيل (لا يُرجَع سند محطة خارج النطاق).
            $this->assertActorStationScope($actor, $station);
            // بيع غير منتهٍ (كما تراه القراءة العادية) يُرفض **قبل أي قفل**: لا يمسك المحصِّل الوردية ثم ينتظر بيعاً يُنهيه `finalize` (البيع ← … ← الوردية FOR UPDATE).
            if (! $peek->isFinalized() || $peek->invoice_id === null || $peek->partner_id === null) {
                throw new RuntimeException('لا يمكن تحصيل سند قبل إنهاء بيع الوقود وفاتورته الرسمية.');
            }
            $basis = $this->cashExpectation->effectiveBasis($station);
            // P1-2: تحت `declared_collection` يُختم الإيصال بالوردية المفتوحة أيضاً (حين بوابة الإيصالات مفتوحة) ليعمل التحقق D ≥ R، لكن **لا يدخل E**
            // (المصدر الوحيد للمتوقع هو الإقرار) و**لا يُرفض التحصيل** لغياب وردية أو لعقد شركة — الختم هنا للمطابقة فقط.
            $strictStamp = $basis === FuelShiftCashExpectationService::BASIS_RECEIVING_SHIFT;
            $stampReceipt = $strictStamp
                || ($basis === FuelShiftCashExpectationService::BASIS_DECLARED_COLLECTION && (bool) config('fuel_stations.shift_cash_receipts_enabled', false));
            // الوردية المعنية بالأثر: تحت الأساس الجديد وردية المحطة المفتوحة (تستلم النقد)، وإلا وردية البيع (حدث المقارنة). قفل مشترك مبكر.
            $lockedShift = $stampReceipt
                ? FuelShift::where('fuel_station_id', $station->id)->where('status', FuelShift::STATUS_OPEN)->sharedLock()->first()
                : ($peek->fuel_shift_id !== null ? FuelShift::whereKey($peek->fuel_shift_id)->sharedLock()->first() : null);

            $sale = FuelSale::lockForUpdate()->findOrFail($sale->id);
            if (! $sale->isFinalized() || $sale->invoice_id === null || $sale->partner_id === null) {
                throw new RuntimeException('لا يمكن تحصيل سند قبل إنهاء بيع الوقود وفاتورته الرسمية.');
            }
            $existing = FuelSalePaymentReceipt::where('fuel_sale_id', $sale->id)
                ->where('idempotency_key', $idempotencyKey)
                ->first();
            if ($existing !== null) {
                $payment = $existing->payment()->firstOrFail();
                if ((int) $payment->amount !== $amount || $payment->payment_method_id !== $paymentMethodId) {
                    throw new RuntimeException('مفتاح منع التكرار استُخدم لتحصيل بيع وقود مختلف.');
                }
                return $payment;
            }

            $this->assertStationBranch($station);
            $settings = $this->settings->forStation($station);
            $allowed = $settings['fuel_sales_allowed_payment_method_ids'] ?? [];
            if (! is_array($allowed) || ! in_array($paymentMethodId, $allowed, true)) {
                throw new RuntimeException('طريقة الدفع غير مفعلة لبيع الوقود في هذه المحطة.');
            }
            $method = PaymentMethod::findOrFail($paymentMethodId);
            if (! $method->is_active || ! in_array($method->settlement_type, ['cash', 'bank'], true)) {
                throw new RuntimeException('طريقة الدفع غير صالحة للتحصيل الرسمي لبيع الوقود.');
            }

            $invoice = \App\Models\Invoice::lockForUpdate()->findOrFail($sale->invoice_id);
            $remaining = (int) $invoice->total - (int) $invoice->paid_amount;
            if ($amount > $remaining) {
                throw new RuntimeException('لا يمكن أن يتجاوز سند قبض الوقود المتبقي على فاتورته.');
            }
            if ($amount < $remaining && ! (bool) ($settings['fuel_sales_allow_deferred_payment'] ?? false)) {
                throw new RuntimeException('البيع المؤجل أو الجزئي غير مفعّل لمحطة الوقود؛ يجب تحصيل كامل متبقي الفاتورة.');
            }

            // #2021 (D1): تحت الأساس receiving_shift_receipts يُختم الإيصال بالوردية المفتوحة وقت التحصيل (لا وردية إنشاء البيع).
            // مغلقاً (الافتراضي) $stampReceipt = false فيعمل المسار القديم حرفياً. ترتيب الأقفال: البيع ← الفاتورة ← الوردية.
            $receivingShift = $stampReceipt ? $this->resolveReceivingShift($sale, $station, $method, $actor, $lockedShift, $strictStamp) : null;

            $payment = $this->payments->post($this->payments->create([
                'partner_id' => $sale->partner_id,
                'invoice_id' => $invoice->id,
                'branch_id' => $sale->branch_id,
                'direction' => 'received',
                'payment_method_id' => $method->id,
                'amount' => $amount,
                'reference' => $this->nullableText($attributes['reference'] ?? null),
                'payment_details' => $attributes['payment_details'] ?? null,
                'notes' => "تحصيل بيع وقود {$sale->number}",
                'created_by' => $actor->id,
            ]), $actor);
            $receipt = FuelSalePaymentReceipt::create([
                'branch_id' => $sale->branch_id,
                'fuel_sale_id' => $sale->id,
                'payment_id' => $payment->id,
                'idempotency_key' => $idempotencyKey,
                'recorded_at' => now(),
            ] + ($stampReceipt ? [
                'fuel_shift_id' => $receivingShift?->id,
                'settlement_type' => $method->settlement_type,
                'amount_minor' => $amount,
                'cash_account_id' => $payment->cash_account_id,
                'received_by_user_id' => $actor->id,
            ] : []));

            $invoice = $invoice->fresh();
            $paid = (int) $invoice->paid_amount;
            $sale->update([
                'paid_minor' => $paid,
                'payment_status' => $this->fuelPaymentStatus($paid, (int) $invoice->total),
            ]);
            if ($stampReceipt) {
                // D1: الحدث على الوردية التي استلمت النقد فعلاً، ويُحتسب في المتوقع (لا مقارنة فقط).
                if ($receivingShift !== null && $method->settlement_type === 'cash') {
                    FuelShiftEvent::create([
                        'branch_id' => $receivingShift->branch_id,
                        'fuel_shift_id' => $receivingShift->id,
                        'type' => FuelShiftEvent::TYPE_OFFICIAL_CASH_PAYMENT_RECORDED,
                        'payload' => [
                            'fuel_sale_id' => $sale->id,
                            'payment_id' => $payment->id,
                            'receipt_id' => $receipt->id,
                            'amount_minor' => $amount,
                            'sale_shift_id' => $sale->fuel_shift_id,
                            'comparison_only' => ! $strictStamp,
                            'counted_in_expected_cash' => $strictStamp,
                            'affects_operational_cash_movements' => false,
                        ],
                        'actor_id' => $actor->id,
                        'occurred_at' => now(),
                    ]);
                }
            } elseif ($sale->fuel_shift_id !== null && $method->settlement_type === 'cash') {
                FuelShiftEvent::create([
                    'branch_id' => $sale->branch_id,
                    'fuel_shift_id' => $sale->fuel_shift_id,
                    'type' => FuelShiftEvent::TYPE_OFFICIAL_CASH_PAYMENT_RECORDED,
                    'payload' => [
                        'fuel_sale_id' => $sale->id,
                        'payment_id' => $payment->id,
                        'amount_minor' => $amount,
                        'comparison_only' => true,
                        'affects_operational_cash_movements' => false,
                    ],
                    'actor_id' => $actor->id,
                    'occurred_at' => now(),
                ]);
            }

            return $payment->fresh();
        });
    }

    /**
     * D1: الوردية المفتوحة للمحطة وقت التحصيل تحت قفل مشترك (يتسلسل مع close ذي FOR UPDATE فلا يُختم إيصال بوردية تُغلق).
     * نقدي بلا وردية مفتوحة، أو بيع بعقد شركة (سداد آجل = D4 غير معتمد) ⇒ BLOCKED برفض كامل قبل أي سند.
     * الشبكة تُختم بالوردية إن وُجدت (للعرض) ولا تُرفض بغيابها ولا تدخل المتوقع.
     */
    /** الوردية المفتوحة تُمرَّر مقفولة مسبقاً (FOR SHARE) من `collectPayment` ضمن الترتيب الموحَّد؛ لا استعلام ولا قفل هنا. */
    private function resolveReceivingShift(FuelSale $sale, FuelStation $station, PaymentMethod $method, User $actor, ?FuelShift $shift, bool $strict = true): ?FuelShift
    {
        // نطاق الفاعل (فرع + مخزن) يُفحص في `collectPayment` نفسه (#2016) قبل هذه الدالة.
        $isCash = $method->settlement_type === 'cash';
        if (! $strict) {
            // ختم للمطابقة فقط (declared_collection): لا رفض. نقد بعقد شركة (سداد آجل غير معتمد) لا يُنسب لدرج الوردية فيبقى بلا ختم.
            return $isCash && $sale->corporate_fuel_contract_id !== null ? null : $shift;
        }
        if ($isCash && $sale->corporate_fuel_contract_id !== null) {
            throw new RuntimeException('FUEL_CASH_CORPORATE_SETTLEMENT_UNDECIDED: تحصيل نقدي لبيع بعقد شركة/أسطول غير معتمد بعد (سداد الآجل نقداً)؛ لا يُنسب لدرج الوردية.');
        }
        if ($isCash && $shift === null) {
            throw new RuntimeException('FUEL_CASH_RECEIPT_NO_OPEN_SHIFT: لا توجد وردية مفتوحة للمحطة لاستلام التحصيل النقدي؛ افتح وردية أولاً.');
        }

        return $shift;
    }

    private function fuelPaymentStatus(int $paid, int $total): string
    {
        if ($paid <= 0) {
            return FuelSale::PAYMENT_UNPAID;
        }

        return $paid >= $total ? FuelSale::PAYMENT_PAID : FuelSale::PAYMENT_PARTIAL;
    }

    private function postFuelCogs(FuelStation $station, int $amount, $invoice, User $actor)
    {
        if ($amount < 0) {
            throw new RuntimeException('قيمة تكلفة الوقود غير صالحة.');
        }
        if ($amount === 0) {
            return null;
        }
        $cogs = $this->account($station->default_cogs_account_id, 'cogs', ['expense']);
        $inventory = $this->account($station->default_inventory_account_id, 'inventory_asset', ['asset']);

        return $this->ledger->post([
            ['account_id' => $cogs->id, 'debit' => $amount],
            ['account_id' => $inventory->id, 'credit' => $amount],
        ], [
            'entry_date' => $invoice->invoice_date->toDateString(),
            'description' => "تكلفة بيع وقود {$invoice->number}",
            'source_type' => get_class($invoice),
            'source_id' => $invoice->id,
            'created_by' => $actor->id,
        ]);
    }

    /**
     * FS-11: تجاوز المحطة الصريح يتقدّم؛ وإلا يُحلّ الدور المحاسبي المعتمد للمستأجر (cogs / inventory_asset)
     * كما يفعل مسار الفوترة العامة، لا الكود الثابت. غياب التعيين = فشل مغلق من المحلِّل بلا سقوط.
     */
    private function account(?string $id, string $roleKey, array $allowedTypes): Account
    {
        $account = $id ? Account::whereKey($id)->first() : $this->roles->resolve($roleKey);
        if (! $account || $account->is_group || ! $account->is_active || ! in_array($account->type, $allowedTypes, true)) {
            throw new RuntimeException('تعيين حساب محطة الوقود غير صالح لعملية البيع.');
        }
        return $account;
    }

    private function assertStationBranch(FuelStation $station): void
    {
        $branchId = app(BranchContext::class)->id();
        if ($branchId !== null && $station->branch_id !== $branchId) {
            throw new RuntimeException('محطة الوقود لا تخص الفرع النشط.');
        }
        if ($station->status !== FuelStation::STATUS_ACTIVE) {
            throw new RuntimeException('محطة الوقود غير نشطة.');
        }
    }

    /**
     * #2016 — دفاع في العمق داخل القفل: نطاق **الفاعل** (فرع + مخزن) على المحطة، حتى لو تغيّر نطاقه بين حارس HTTP
     * (404 الموحّد في المتحكم) وبدء المعاملة أو استُدعيت الخدمة بلا المتحكم. القاعدة نفسها في `FuelShiftService` (#2014):
     * غير المقيَّد لا يتأثر، والمحطة بلا فرع/مخزن تبقى متاحة (عقد `AuthorizesFuelStationScope`). لا يمسّ سياسات الفرع النشط.
     */
    private function assertActorStationScope(User $actor, FuelStation $station): void
    {
        // FUEL-B3: فرع ∧ مخزن ∧ محطة مسنَدة (القاعدة الواحدة في User::canAccessFuelStation).
        if (! $actor->canAccessFuelStation($station)) {
            throw new RuntimeException('محطة البيع خارج نطاق صلاحياتك.');
        }
    }

    private function warehouse(FuelStation $station): Warehouse
    {
        if ($station->warehouse_id === null) {
            throw new RuntimeException('FUEL_STATION_WAREHOUSE_REQUIRED: محطة الوقود تحتاج مخزناً صريحاً قبل البيع الرسمي.');
        }
        $warehouse = Warehouse::findOrFail($station->warehouse_id);
        if ($warehouse->branch_id !== $station->branch_id) {
            throw new RuntimeException('مخزن محطة الوقود لا يطابق فرعها المحاسبي.');
        }
        return $warehouse;
    }

    private function assertNozzleForStation(FuelNozzle $nozzle, FuelStation $station): void
    {
        if ($nozzle->fuel_station_id !== $station->id || $nozzle->branch_id !== $station->branch_id || $nozzle->status !== FuelNozzle::STATUS_ACTIVE) {
            throw new RuntimeException('الفوهة لا تخص محطة/فرع البيع أو ليست نشطة.');
        }
    }

    /**
     * FUEL-LOCK-ORDER: `FOR KEY SHARE` على الصفوف الأب التي سيُدرَج بيع/فاتورة/حركة بمفتاح أجنبي إليها (المضخة، الخزان، الوردية)
     * **قبل** مِرساة ترقيم المستندات (`FOR UPDATE` على صف الفرع داخل `nextDocumentNumber`) لا بعدها.
     * السبب (مُثبَت بتزاحم فعلي على PostgreSQL): `recordReading`/`updateTank`/`updatePump`/الإغلاق تمسك الصف الأب `FOR UPDATE` ثم تحتاج `KEY SHARE` على الفرع
     * (FK صف الحدث/القراءة)، بينما البيع يمسك المِرساة `FOR UPDATE` ثم يحتاج `KEY SHARE` على الأب ⇒ دورة. بأخذه مبكراً يتسلسل الطرفان عند الصف الأب قبل أن يمسك أيٌّ منهما المِرساة.
     * `KEY SHARE` لا يتعارض إلا مع `FOR UPDATE`، فلا يحجب قارئاً آخر ولا بيعاً آخر.
     */
    private function lockReferencedRows(FuelNozzle $nozzle, mixed $shiftId = null): void
    {
        FuelPump::whereKey($nozzle->fuel_pump_id)->lock('for key share')->first();
        FuelTank::whereKey($nozzle->fuel_tank_id)->lock('for key share')->first();
        if (is_string($shiftId) && $shiftId !== '') {
            FuelShift::whereKey($shiftId)->lock('for key share')->first();
        }
    }

    /**
     * FUEL-LOCK-ORDER: قفل المحطة لمسارات البيع بنمط `FOR NO KEY UPDATE` لا `FOR UPDATE`.
     * أي `INSERT` بمفتاح أجنبي إلى المحطة (قراءة خزان، حركة…) يأخذ `FOR KEY SHARE` عليها، وهو يتعارض مع `FOR UPDATE` لا مع `NO KEY UPDATE`.
     * فبقاء `FOR UPDATE` هنا كان يُنتج جموداً مع `FuelReconciliationService::recordReading` (الخزان ثم المحطة) — مُثبَت على PostgreSQL.
     * يبقى النمط متعارضاً مع نفسه ومع `FOR UPDATE` فيستمر التسلسل بين مسارات المحطة المتنافسة.
     * الترتيب الموحَّد: [المحطة NO KEY UPDATE] ← الوردية ← البيع ← الفاتورة ← السند ← مِرساة المستأجر
     * (انحراف معلن: `finalize` يقفل البيع أولاً ثم المحطة؛ آمن لأنه يعود فور قراءة بيع منتهٍ و`collectPayment` يرفض غير المنتهي قبل أي قفل).
     */
    private function lockStation(string $stationId): FuelStation
    {
        return FuelStation::query()->lock('for no key update')->findOrFail($stationId);
    }

    /**
     * FUEL-P1-1: لا يُباع وقود عبر مضخة أو خزان غير `active` (صيانة أو تعطيل) حتى لو كانت الفوهة نفسها نشطة.
     * الفحص على مستوى الفوهة وحدها كان يترك المضخة/الخزان في الصيانة يبيعان فاتورةً وخصمَ مخزون.
     *
     * **قراءة عادية بلا قفل صفّ — عمداً.** `finalize` يمسك المحطة `FOR UPDATE`؛ وقفل الخزان بعدها يعاكس ترتيب
     * `FuelReconciliationService::recordReading` (الخزان `FOR UPDATE` ثم `KEY SHARE` على المحطة من FK صف القراءة)
     * و`FuelStationMasterDataService::updateTank` ⇒ جمود 40P01 مُثبَت بتجربة PostgreSQL (انظر FuelSaleEquipmentStatePostgresTest).
     * البوابة سياسة تشغيلية لا حدّ ترحيل لحظي: بيعٌ يلتزم في اللحظة نفسها التي تُحوَّل فيها المعدة إلى الصيانة يسجّل وقوداً صُرف فعلاً
     * قبل التحويل، فلا حاجة لتسلسل صارم مع تعديل الحالة.
     */
    private function assertNozzleEquipmentOperational(FuelNozzle $nozzle, FuelStation $station): void
    {
        $pump = FuelPump::whereKey($nozzle->fuel_pump_id)->first();
        if ($pump === null || $pump->fuel_station_id !== $station->id || $pump->branch_id !== $station->branch_id) {
            throw new RuntimeException('FUEL_PUMP_NOT_OPERATIONAL: مضخة الفوهة غير موجودة أو لا تخص محطة/فرع البيع.');
        }
        if ($pump->status !== FuelPump::STATUS_ACTIVE) {
            throw new RuntimeException('FUEL_PUMP_NOT_OPERATIONAL: المضخة ' . $pump->pump_number . ' ' . $this->equipmentStatusLabel($pump->status) . '؛ لا يمكن بيع الوقود عبرها.');
        }

        $tank = FuelTank::whereKey($nozzle->fuel_tank_id)->first();
        if ($tank === null || $tank->fuel_station_id !== $station->id || $tank->branch_id !== $station->branch_id) {
            throw new RuntimeException('FUEL_TANK_NOT_OPERATIONAL: خزان الفوهة غير موجود أو لا يخص محطة/فرع البيع.');
        }
        if ($tank->status !== FuelTank::STATUS_ACTIVE) {
            throw new RuntimeException('FUEL_TANK_NOT_OPERATIONAL: الخزان ' . $tank->code . ' ' . $this->equipmentStatusLabel($tank->status) . '؛ لا يمكن بيع الوقود منه.');
        }
    }

    private function equipmentStatusLabel(string $status): string
    {
        return $status === 'maintenance' ? 'في الصيانة' : 'معطّل';
    }

    private function assertOptionalPartner(mixed $partnerId): void
    {
        if ($partnerId === null) {
            return;
        }
        if (! is_string($partnerId) || trim($partnerId) === '' || ! \App\Models\Partner::whereKey($partnerId)->exists()) {
            throw new RuntimeException('عميل بيع الوقود غير صالح.');
        }
    }

    private function assertOptionalShift(mixed $shiftId, FuelStation $station): void
    {
        if ($shiftId === null) {
            return;
        }
        $shift = FuelShift::findOrFail($shiftId);
        if ($shift->fuel_station_id !== $station->id || $shift->branch_id !== $station->branch_id) {
            throw new RuntimeException('الشفت لا يخص محطة أو فرع بيع الوقود.');
        }
    }

    private function assertFinalizationShift(FuelSale $sale, FuelStation $station): void
    {
        if ($sale->fuel_shift_id === null) {
            throw new RuntimeException('يتطلب إنهاء بيع الوقود شفتاً تشغيلياً مفتوحاً.');
        }
        $shift = FuelShift::lockForUpdate()->findOrFail($sale->fuel_shift_id);
        if ($shift->fuel_station_id !== $station->id || ! $shift->isOpen()) {
            throw new RuntimeException('يتطلب إنهاء بيع الوقود شفت محطة مفتوحاً؛ لا يسمح بالشفت المقفل أو المعتمد.');
        }
    }

    private function assertMeterRange(array $attributes, int $quantity): void
    {
        $start = $attributes['meter_start_milliliters'] ?? null;
        $end = $attributes['meter_end_milliliters'] ?? null;
        if ($start === null && $end === null) {
            return;
        }
        $start = $this->positiveOrZeroInteger($start, 'meter_start_milliliters');
        $end = $this->positiveOrZeroInteger($end, 'meter_end_milliliters');
        if ($end < $start || $end - $start !== $quantity) {
            throw new RuntimeException('مدى عداد البيع يجب أن يكون غير متناقص وأن يطابق كمية الوقود بالملليلتر.');
        }
    }

    private function lockWarehouseStock(string $warehouseId, string $productId): void
    {
        $stock = ProductWarehouseStock::where('warehouse_id', $warehouseId)->where('product_id', $productId)->lockForUpdate()->first();
        if ($stock === null) {
            throw new RuntimeException('لا يوجد رصيد مخزن رسمي لمنتج الوقود.');
        }
    }

    private function requiredString(array $attributes, string $key): string
    {
        $value = $attributes[$key] ?? null;
        if (! is_string($value) || trim($value) === '') {
            throw new RuntimeException("{$key} مطلوب.");
        }
        return trim($value);
    }

    private function positiveInteger(mixed $value, string $key): int
    {
        $integer = $this->positiveOrZeroInteger($value, $key);
        if ($integer <= 0) {
            throw new RuntimeException("{$key} يجب أن يكون عدداً صحيحاً موجباً.");
        }
        return $integer;
    }

    private function positiveOrZeroInteger(mixed $value, string $key): int
    {
        if (! is_int($value) && !(is_string($value) && preg_match('/^\d+$/', $value))) {
            throw new RuntimeException("{$key} يجب أن يكون عدداً صحيحاً غير سالب.");
        }
        $integer = (int) $value;
        if ($integer < 0) {
            throw new RuntimeException("{$key} يجب أن يكون عدداً صحيحاً غير سالب.");
        }
        return $integer;
    }

    private function nullableText(mixed $value): ?string
    {
        if ($value === null) {
            return null;
        }
        if (! is_string($value)) {
            throw new RuntimeException('النص يجب أن يكون نصياً.');
        }
        $value = trim($value);
        return $value === '' ? null : $value;
    }
}
