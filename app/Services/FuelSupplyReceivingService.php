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
use App\Models\User;
use App\Models\Warehouse;
use App\Services\Accounting\AccountRoleResolver;
use App\Services\Accounting\InventoryService;
use App\Services\Accounting\LedgerService;
use App\Tenancy\TenantContext;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Support\Facades\DB;
use RuntimeException;

/**
 * Cycle 3: استلام الوقود يثبت الكمية المستلمة فعلياً في المخزون ويقيد
 * Dr Inventory / Cr GRNI. لا تنشئ مطابقة الفاتورة حركة مخزون ثانية؛ إنها
 * تسوّي الجزء الآمن فقط من GRNI إلى المورد، وتترك فرق القيمة pending بلا حساب مفترض.
 */
class FuelSupplyReceivingService
{
    public function __construct(
        private InventoryService $inventory,
        private LedgerService $ledger,
        private FuelStationSettingsService $settings,
        private FuelCostBasisService $costBasis,
        private FuelQuantity $quantity,
        private AccountRoleResolver $roles,
        private FuelStationAuditTrail $audit,
    ) {}

    /**
     * FS-16: المفتاح الواحد = نية واحدة. إعادة الإرسال بالحمولة نفسها تُعيد المسودة الأولى؛ بحمولة مختلفة تُرفض
     * (لا تجاهل صامت لتغيير الكمية أو التكلفة). وتعارض التزامن على المفتاح (طلبان متزامنان) يُحسم هنا بعد تراجع
     * المعاملة الخاسرة: إعادة قراءة المسودة الفائزة ومقارنتها، لا 500 من فهرس القاعدة.
     *
     * @param array<string, mixed> $data
     */
    public function createDelivery(array $data): FuelDelivery
    {
        $key = trim((string) ($data['idempotency_key'] ?? ''));
        if ($key === '') {
            throw new RuntimeException('مفتاح idempotency مطلوب لاستلام الوقود.');
        }

        try {
            return DB::transaction(function () use ($data, $key) {
                $existing = FuelDelivery::where('idempotency_key', $key)->first();
                if ($existing !== null) {
                    $this->assertSameDeliveryPayload($existing, $data);

                    return $existing;
                }

                return $this->insertDelivery($data, $key);
            });
        } catch (UniqueConstraintViolationException $e) {
            $winner = FuelDelivery::where('idempotency_key', $key)->first();
            if ($winner !== null) {
                $this->assertSameDeliveryPayload($winner, $data);

                return $winner;
            }

            // المفتاح أو رقم إذن التسليم محجوزان لسجل لا يراه هذا المستخدم (فرع آخر) أو لرقم إذن مكرر لمورد واحد.
            throw new RuntimeException('FUEL_DELIVERY_DUPLICATE: مفتاح الاستلام أو رقم إذن التسليم لهذا المورد مسجَّل مسبقاً.');
        }
    }

    /** @param array<string, mixed> $data */
    private function insertDelivery(array $data, string $key): FuelDelivery
    {
        [$station, $tank, $fuelProduct, $warehouse, $supplier] = $this->resolveDeliveryReferences($data);
        $this->assertFuelProduct($fuelProduct);
        $dispatched = $this->liters($data['dispatched_liters'] ?? null, 'الكمية المرسلة');
        $received = $this->liters($data['received_liters'] ?? null, 'الكمية المستلمة');
        if ($received <= 0) {
            throw new RuntimeException('الكمية المستلمة فعلياً يجب أن تكون موجبة.');
        }
        // FUEL-B5.1: التكلفة اختيارية عند الإنشاء (موظف المحطة لا يعرفها). NULL = لم تُسجَّل، **لا صفر**؛ تُسجَّل لاحقاً بـ recordCost()
        // وتُشترط عند الاعتماد. المُرسَلة تُقبل موجبة فقط (صلاحية إرسالها تفحصها الطبقة العليا).
        $totalCost = $this->optionalCost($data['received_total_cost_minor'] ?? null);

        $order = $this->resolveOrder($data['procurement_order_id'] ?? null, $supplier, $station->branch_id);
        $this->assertReadings($data, $station->id, $tank->id);
        $unitCompatibilityCost = $totalCost === null ? null : intdiv($totalCost, $received);

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
            'cost_recorded_by' => $totalCost === null ? null : ($data['created_by'] ?? null),
            'cost_recorded_at' => $totalCost === null ? null : now(),
            'idempotency_key' => $key,
            'received_at' => $this->receivedAt($data['received_at'] ?? null),
            'created_by' => $data['created_by'] ?? null,
            'notes' => $this->nullableString($data['notes'] ?? null, 1000),
        ]);
    }

    /**
     * بصمة النية المرسلة، بالأشكال نفسها التي تُخزَّن بها (ملّيلترات صحيحة، نصوص مقتطعة كما في الإدراج). لا تقرأ قاعدة
     * البيانات ولا تتحقق من وجود المراجع — هي للمقارنة فقط.
     *
     * @param array<string, mixed> $data
     * @return array<string, mixed>
     */
    private function requestedDeliveryFingerprint(array $data): array
    {
        return [
            'fuel_station_id' => $this->idString($data['fuel_station_id'] ?? null),
            'fuel_tank_id' => $this->idString($data['fuel_tank_id'] ?? null),
            'fuel_product_id' => $this->idString($data['fuel_product_id'] ?? null),
            'warehouse_id' => $this->idString($data['warehouse_id'] ?? null),
            'supplier_id' => $this->idString($data['supplier_id'] ?? null),
            'procurement_order_id' => $this->idString($data['procurement_order_id'] ?? null),
            'purchase_reference' => $this->nullableString($data['purchase_reference'] ?? null, 128),
            'delivery_note_number' => $this->nullableString($data['delivery_note_number'] ?? null, 128),
            'tanker_identifier' => $this->nullableString($data['tanker_identifier'] ?? null, 128),
            'driver_name' => $this->nullableString($data['driver_name'] ?? null, 255),
            'compartments' => $this->canonical($data['compartments'] ?? null),
            'dispatched_milliliters' => $this->liters($data['dispatched_liters'] ?? null, 'الكمية المرسلة'),
            'received_milliliters' => $this->liters($data['received_liters'] ?? null, 'الكمية المستلمة'),
            // FUEL-B5.1: غياب التكلفة في إعادة الإرسال لا «ادّعاء» بشيء (قد يكون المسؤول المالي سجّلها بعد الإنشاء)؛ تُقارَن المُرسَلة فقط.
            'received_total_cost_minor' => $this->optionalCost($data['received_total_cost_minor'] ?? null),
            'temperature_milli_celsius' => $this->nullableInteger($data['temperature_milli_celsius'] ?? null),
            'density_kg_per_m3' => $this->nullableInteger($data['density_kg_per_m3'] ?? null),
            'before_physical_reading_id' => $this->idString($data['before_physical_reading_id'] ?? null),
            'after_physical_reading_id' => $this->idString($data['after_physical_reading_id'] ?? null),
            'before_atg_reading_id' => $this->idString($data['before_atg_reading_id'] ?? null),
            'after_atg_reading_id' => $this->idString($data['after_atg_reading_id'] ?? null),
            'evidence' => $this->canonical($data['evidence'] ?? null),
            'notes' => $this->nullableString($data['notes'] ?? null, 1000),
        ];
    }

    /** @return array<string, mixed> */
    private function storedDeliveryFingerprint(FuelDelivery $delivery): array
    {
        return [
            'fuel_station_id' => $this->idString($delivery->fuel_station_id),
            'fuel_tank_id' => $this->idString($delivery->fuel_tank_id),
            'fuel_product_id' => $this->idString($delivery->fuel_product_id),
            'warehouse_id' => $this->idString($delivery->warehouse_id),
            'supplier_id' => $this->idString($delivery->supplier_id),
            'procurement_order_id' => $this->idString($delivery->procurement_order_id),
            'purchase_reference' => $this->nullableString($delivery->purchase_reference, 128),
            'delivery_note_number' => $this->nullableString($delivery->delivery_note_number, 128),
            'tanker_identifier' => $this->nullableString($delivery->tanker_identifier, 128),
            'driver_name' => $this->nullableString($delivery->driver_name, 255),
            'compartments' => $this->canonical($delivery->compartments),
            'dispatched_milliliters' => (int) $delivery->dispatched_milliliters,
            'received_milliliters' => (int) $delivery->received_milliliters,
            'received_total_cost_minor' => $delivery->received_total_cost_minor === null ? null : (int) $delivery->received_total_cost_minor,
            'temperature_milli_celsius' => $delivery->temperature_milli_celsius === null ? null : (int) $delivery->temperature_milli_celsius,
            'density_kg_per_m3' => $delivery->density_kg_per_m3 === null ? null : (int) $delivery->density_kg_per_m3,
            'before_physical_reading_id' => $this->idString($delivery->before_physical_reading_id),
            'after_physical_reading_id' => $this->idString($delivery->after_physical_reading_id),
            'before_atg_reading_id' => $this->idString($delivery->before_atg_reading_id),
            'after_atg_reading_id' => $this->idString($delivery->after_atg_reading_id),
            'evidence' => $this->canonical($delivery->evidence),
            'notes' => $this->nullableString($delivery->notes, 1000),
        ];
    }

    /**
     * يرفض إعادة استعمال مفتاح استلام بحمولة مختلفة. الرسالة لا تحمل أي قيمة (كمية/تكلفة) من السجل الأصلي — يكفي اسم
     * الحقول المختلفة. `received_at` يُقارَن فقط إن أرسله العميل صراحةً (غيابه = «الآن» عند كل محاولة).
     *
     * @param array<string, mixed> $data
     */
    private function assertSameDeliveryPayload(FuelDelivery $existing, array $data): void
    {
        $requested = $this->requestedDeliveryFingerprint($data);
        $stored = $this->storedDeliveryFingerprint($existing);
        $differs = array_keys(array_filter($requested, function ($value, $field) use ($stored) {
            if ($field === 'received_total_cost_minor' && $value === null) {
                return false; // لم تُرسَل تكلفة في إعادة الإرسال ⇒ لا مقارنة (انظر البصمة).
            }

            return $value !== $stored[$field];
        }, ARRAY_FILTER_USE_BOTH));

        if (($data['received_at'] ?? null) !== null && $data['received_at'] !== ''
            && $this->receivedAt($data['received_at'])->format('Y-m-d H:i:s') !== $existing->received_at?->format('Y-m-d H:i:s')) {
            $differs[] = 'received_at';
        }

        if ($differs !== []) {
            throw new RuntimeException('FUEL_IDEMPOTENCY_PAYLOAD_MISMATCH: مفتاح idempotency مستعمل لاستلام وقود بمحتوى مختلف (' . implode('، ', $differs) . ')؛ استعمل مفتاحاً جديداً لاستلام جديد أو أعد إرسال الحمولة الأصلية نفسها.');
        }
    }

    /**
     * FS-19: الطابع المُرسَل بإزاحة صريحة (`+03:00`/`Z`) يُحوَّل إلى لحظته بمنطقة التطبيق قبل التخزين؛ إسناده مباشرةً
     * لعمود datetime كان يحفظ الساعة المكتوبة ويُسقط الإزاحة، فيُقرأ لاحقاً لحظةً مختلفة وتتحول إلى تقويم المحطة خطأً.
     * الطابع بلا إزاحة يبقى كما كان (منطقة التطبيق).
     */
    private function receivedAt(mixed $value): \Carbon\CarbonInterface
    {
        if ($value === null || $value === '') {
            return now();
        }
        if ($value instanceof \DateTimeInterface) {
            return \Carbon\Carbon::instance($value)->setTimezone(config('app.timezone'));
        }

        return \Carbon\Carbon::parse((string) $value)->setTimezone(config('app.timezone'));
    }

    /**
     * FUEL-B5.1: تسجيل (أو تصحيح قبل الاعتماد) تكلفة الاستلام — إجراء مالي مستقل، **بلا أي أثر مخزني أو محاسبي** (يحرسه الاختبار):
     * الأثر كله عند الاعتماد وحده. تحت قفل صف الاستلام؛ المعتمد يُرفض (تغيير التكلفة بعد الاعتماد = تدفق تصحيح لا هنا).
     * قيمة مطابقة لما سُجِّل = لا أثر (idempotent، ولا حدث تدقيق). التدقيق: الفاعل والوقت **بلا المبلغ** (سجل المحطة يراه من لا يرى التكلفة).
     */
    public function recordCost(FuelDelivery $delivery, int $totalCostMinor, User $actor): FuelDelivery
    {
        if ($totalCostMinor < 1) {
            throw new RuntimeException('FUEL_DELIVERY_COST_INVALID: تكلفة الاستلام الفعلية يجب أن تكون هللات صحيحة موجبة.');
        }

        return DB::transaction(function () use ($delivery, $totalCostMinor, $actor) {
            $delivery = FuelDelivery::lockForUpdate()->findOrFail($delivery->id);
            if ($delivery->status !== FuelDelivery::STATUS_DRAFT) {
                throw new RuntimeException('FUEL_DELIVERY_COST_LOCKED: لا يمكن تعديل تكلفة استلام معتمد.');
            }
            if ($delivery->received_total_cost_minor !== null && (int) $delivery->received_total_cost_minor === $totalCostMinor) {
                return $delivery;
            }

            $before = ['cost_recorded' => $delivery->hasCost(), 'cost_recorded_by' => $delivery->cost_recorded_by, 'cost_recorded_at' => $delivery->cost_recorded_at?->toIso8601String()];
            $delivery->update([
                'received_total_cost_minor' => $totalCostMinor,
                'received_unit_cost_minor' => intdiv($totalCostMinor, max(1, (int) $delivery->received_milliliters)),
                'cost_recorded_by' => $actor->id,
                'cost_recorded_at' => now(),
            ]);
            $delivery->refresh();
            $this->audit->record(
                'fuel_delivery.cost_recorded',
                $delivery,
                $before,
                // `cost_corrected` يميّز تصحيحاً لتكلفة مسجَّلة: بدونه قد تتطابق لقطتا قبل/بعد (الفاعل نفسه في الثانية نفسها) فيُسقَط الحدث.
                ['cost_recorded' => true, 'cost_recorded_by' => $actor->id, 'cost_recorded_at' => $delivery->cost_recorded_at?->toIso8601String()] + ($before['cost_recorded'] ? ['cost_corrected' => true] : []),
                $actor,
            );

            return $delivery;
        });
    }

    /**
     * FUEL-B5.1: اكتمال الاستلام قبل أن يُنتج أثراً. تُستدعى داخل معاملة الاعتماد بعد قفل الصف وقبل أي كتابة.
     * (١) التكلفة مسجَّلة (NULL ⇒ رفض؛ لا صفر افتراضي). (٢) إن أرسل المعتمِد التكلفة التي راجعها فلا تكون تغيّرت (409 — لا يعتمد قيمة لم يرها).
     * (٣) دليل المستند: رقم سند التسليم **أو** مرفق واحد على الأقل (سند المورد المصوَّر). الكمية الموجبة والمراجع والخزان/المخزن تُفحص أصلاً.
     */
    private function assertApprovable(FuelDelivery $delivery, ?int $expectedTotalCostMinor): void
    {
        if (! $delivery->hasCost()) {
            throw new RuntimeException('FUEL_DELIVERY_COST_REQUIRED: لا يمكن اعتماد استلام قبل تسجيل تكلفته الفعلية.');
        }
        if ($expectedTotalCostMinor !== null && (int) $delivery->received_total_cost_minor !== $expectedTotalCostMinor) {
            throw new FuelDeliveryCostChangedException('FUEL_DELIVERY_COST_CHANGED: تغيّرت تكلفة الاستلام بعد مراجعتك؛ أعد المراجعة.');
        }
        if (trim((string) $delivery->delivery_note_number) === '' && ! $delivery->attachments()->exists()) {
            throw new RuntimeException('FUEL_DELIVERY_DOCUMENT_REQUIRED: يلزم رقم سند التسليم أو إرفاق صورة السند قبل الاعتماد.');
        }
        if ((int) $delivery->received_milliliters <= 0) {
            throw new RuntimeException('الكمية المستلمة فعلياً يجب أن تكون موجبة.');
        }
    }

    public function approveDelivery(FuelDelivery $delivery, string $actorId, ?int $expectedTotalCostMinor = null): FuelDelivery
    {
        return DB::transaction(function () use ($delivery, $actorId, $expectedTotalCostMinor) {
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
            // FUEL-B2: فصل المعتمِد عن المنشئ حين تلزم سياسة المحطة — داخل المعاملة وبعد قفل السجل وقبل أي أثر مخزني أو محاسبي.
            $this->settings->assertDistinctApprover($station, $delivery->created_by, $actorId, 'استلام الوقود');
            $this->assertApprovable($delivery, $expectedTotalCostMinor);
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
                    'date' => $this->settings->businessDate($station, $delivery->received_at),
                    'notes' => "استلام وقود {$delivery->delivery_note_number}",
                    InventoryService::FUEL_POOL_META => true,
                ],
                (int) $delivery->received_total_cost_minor,
            );
            $value = (int) $delivery->received_total_cost_minor;
            $entry = $this->ledger->post([
                ['account_id' => $this->inventoryAccountId(), 'debit' => $value, 'branch_id' => $station->branch_id],
                ['account_id' => $grni->id, 'credit' => $value, 'branch_id' => $station->branch_id],
            ], [
                'entry_date' => $this->settings->businessDate($station, $delivery->received_at),
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

    /**
     * FS-16: المفتاح الطبيعي (المورد + رقم الفاتورة). إعادة الإرسال بالمحتوى نفسه تُعيد الفاتورة الأولى؛ بمحتوى مختلف
     * (سطر أو كمية أو قيمة أو عملة أو مراجع) تُرفض، وتعارض التزامن يُحسم بإعادة قراءة الفائزة.
     *
     * @param array<string, mixed> $data
     */
    public function createSupplierInvoice(array $data): FuelSupplierInvoice
    {
        $lines = $data['lines'] ?? [];
        if (! is_array($lines) || $lines === []) {
            throw new RuntimeException('فاتورة مورد الوقود تحتاج سطراً واحداً على الأقل.');
        }
        $number = trim((string) ($data['invoice_number'] ?? ''));
        if ($number === '') {
            throw new RuntimeException('رقم فاتورة المورد مطلوب.');
        }
        $supplierId = (string) ($data['supplier_id'] ?? '');

        try {
            return DB::transaction(function () use ($data, $lines, $number) {
                $supplier = Partner::findOrFail($data['supplier_id'] ?? '');
                $existing = FuelSupplierInvoice::where('supplier_id', $supplier->id)->where('invoice_number', $number)->first();
                if ($existing !== null) {
                    $this->assertSameInvoicePayload($existing, $data, $lines);

                    return $existing->load('lines');
                }

                return $this->insertSupplierInvoice($data, $lines, $supplier, $number);
            });
        } catch (UniqueConstraintViolationException $e) {
            $winner = FuelSupplierInvoice::where('supplier_id', $supplierId)->where('invoice_number', $number)->first();
            if ($winner !== null) {
                $this->assertSameInvoicePayload($winner, $data, $lines);

                return $winner->load('lines');
            }

            throw new RuntimeException('FUEL_INVOICE_DUPLICATE: فاتورة الشراء المرتبطة مستعملة في فاتورة مورد وقود أخرى.');
        }
    }

    /**
     * @param array<string, mixed> $data
     * @param array<int, mixed> $lines
     */
    private function insertSupplierInvoice(array $data, array $lines, Partner $supplier, string $number): FuelSupplierInvoice
    {
        $order = $this->resolveOrder($data['procurement_order_id'] ?? null, $supplier, null);
        $purchase = $this->resolvePurchase($data['purchase_id'] ?? null, $supplier);

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
    }

    /**
     * يرفض إعادة استعمال (مورد، رقم فاتورة) بمحتوى مختلف. الرسالة تسمّي الحقول المختلفة فقط، لا قيماً من الفاتورة الأصلية.
     * تاريخ الفاتورة يُقارَن إن أُرسل صراحةً (غيابه = «اليوم» عند كل محاولة).
     *
     * @param array<string, mixed> $data
     * @param array<int, mixed> $lines
     */
    private function assertSameInvoicePayload(FuelSupplierInvoice $existing, array $data, array $lines): void
    {
        $differs = [];
        $check = function (string $field, mixed $requested, mixed $stored) use (&$differs): void {
            if ($requested !== $stored) {
                $differs[] = $field;
            }
        };
        $check('procurement_order_id', $this->idString($data['procurement_order_id'] ?? null), $this->idString($existing->procurement_order_id));
        $check('purchase_id', $this->idString($data['purchase_id'] ?? null), $this->idString($existing->purchase_id));
        $check('currency', (string) ($data['currency'] ?? 'SAR'), (string) $existing->currency);
        $check('evidence', $this->canonical($data['evidence'] ?? null), $this->canonical($existing->evidence));
        $check('notes', $this->nullableString($data['notes'] ?? null, 1000), $this->nullableString($existing->notes, 1000));
        if (($data['invoice_date'] ?? null) !== null && $data['invoice_date'] !== '') {
            $check('invoice_date', \Carbon\Carbon::parse((string) $data['invoice_date'])->toDateString(), $existing->invoice_date?->toDateString());
        }

        $requestedLines = array_map(fn ($line) => [
            $this->idString($line['fuel_product_id'] ?? null),
            $this->liters($line['quantity_liters'] ?? null, 'كمية سطر الفاتورة'),
            $this->positiveInteger($line['value_minor'] ?? null, 'قيمة سطر الفاتورة'),
        ], array_values($lines));
        $storedLines = $existing->lines()->orderBy('line_number')->get()->map(fn ($line) => [
            $this->idString($line->fuel_product_id),
            (int) $line->quantity_milliliters,
            (int) $line->value_minor,
        ])->all();
        $check('lines', $requestedLines, $storedLines);

        if ($differs !== []) {
            throw new RuntimeException('FUEL_IDEMPOTENCY_PAYLOAD_MISMATCH: رقم فاتورة المورد مسجَّل لهذا المورد بمحتوى مختلف (' . implode('، ', $differs) . ')؛ لا تُعدَّل فاتورة مسجَّلة بإعادة الإرسال.');
        }
    }

    /**
     * FS-16: مفتاح المطابقة على مستوى المستأجر. إعادة الإرسال بالمفتاح نفسه تُعيد المطابقة الأولى فقط إن كانت لنفس
     * الفاتورة والسطر والاستلام والكمية؛ غير ذلك يُرفض (لا تُرجَع مطابقة فاتورة أخرى بصمت). وتعارض التزامن على
     * المفتاح بين فاتورتين يُحسم بإعادة قراءة الفائزة ومقارنتها بعد تراجع المعاملة الخاسرة (قيدها وعدّاداتها).
     *
     * @param array<string, mixed> $data
     */
    public function matchSupplierInvoiceLine(FuelSupplierInvoice $invoice, array $data, string $actorId): FuelSupplierInvoiceMatch
    {
        $key = trim((string) ($data['idempotency_key'] ?? ''));
        if ($key === '') {
            throw new RuntimeException('مفتاح idempotency مطلوب لمطابقة فاتورة المورد.');
        }

        try {
            return $this->matchSupplierInvoiceLineOnce($invoice, $data, $actorId, $key);
        } catch (UniqueConstraintViolationException $e) {
            $winner = FuelSupplierInvoiceMatch::where('idempotency_key', $key)->first();
            if ($winner !== null) {
                $this->assertSameMatchPayload($winner, $invoice->id, $data);

                return $winner;
            }

            throw new RuntimeException('FUEL_MATCH_DUPLICATE: مفتاح المطابقة مستعمل في عملية أخرى.');
        }
    }

    /** @param array<string, mixed> $data */
    private function matchSupplierInvoiceLineOnce(FuelSupplierInvoice $invoice, array $data, string $actorId, string $key): FuelSupplierInvoiceMatch
    {
        return DB::transaction(function () use ($invoice, $data, $actorId, $key) {
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
            $quantity = $this->liters($data['quantity_liters'] ?? null, 'كمية المطابقة');
            if ($quantity <= 0) {
                throw new RuntimeException('كمية المطابقة يجب أن تكون موجبة.');
            }
            $existing = FuelSupplierInvoiceMatch::where('idempotency_key', $key)->first();
            if ($existing !== null) {
                $this->assertSameMatchPayload($existing, $invoice->id, $data);

                return $existing;
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

    /**
     * يطابق إعادة الإرسال بالمفتاح نفسه مع المطابقة المسجَّلة: الفاتورة والسطر والاستلام والكمية. الرسالة لا تحمل قيماً مالية.
     *
     * @param array<string, mixed> $data
     */
    private function assertSameMatchPayload(FuelSupplierInvoiceMatch $existing, string $invoiceId, array $data): void
    {
        $differs = [];
        if ($existing->fuel_supplier_invoice_id !== $invoiceId) {
            $differs[] = 'invoice';
        }
        if ($this->idString($data['fuel_supplier_invoice_line_id'] ?? null) !== $existing->fuel_supplier_invoice_line_id) {
            $differs[] = 'invoice_line';
        }
        if ($this->idString($data['fuel_delivery_id'] ?? null) !== $existing->fuel_delivery_id) {
            $differs[] = 'delivery';
        }
        if ($this->liters($data['quantity_liters'] ?? null, 'كمية المطابقة') !== (int) $existing->matched_quantity_milliliters) {
            $differs[] = 'quantity';
        }

        if ($differs !== []) {
            throw new RuntimeException('FUEL_IDEMPOTENCY_PAYLOAD_MISMATCH: مفتاح المطابقة مستعمل لمطابقة مختلفة (' . implode('، ', $differs) . ')؛ استعمل مفتاحاً جديداً.');
        }
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
        // FS-34: دور الموردين المعتمد للمستأجر (accounts_payable) لا الكود 2110؛ غياب التعيين فشل مغلق.
        $payable = $this->roles->resolve('accounts_payable');
        if ($payable->type !== 'liability') {
            throw new RuntimeException('حساب الموردين المعيَّن غير صالح لترحيل مطابقة GRNI.');
        }

        return $this->ledger->post([
            ['account_id' => $grni->id, 'debit' => $value, 'branch_id' => $delivery->branch_id],
            ['account_id' => $payable->id, 'credit' => $value, 'branch_id' => $delivery->branch_id, 'partner_type' => Partner::class, 'partner_id' => $delivery->supplier_id],
        ], [
            'entry_date' => $delivery->station !== null ? $this->settings->businessDate($delivery->station) : now()->toDateString(),
            'description' => "تسوية GRNI لاستلام الوقود {$delivery->delivery_note_number}",
            'source_type' => FuelSupplierInvoice::class,
            'source_id' => $invoice->id,
            'created_by' => $actorId,
        ]);
    }

    private function inventoryAccountId(): string
    {
        // FS-34: دور المخزون المعتمد (inventory_asset) لا الكود 1140.
        $account = $this->roles->resolve('inventory_asset');
        if ($account->type !== 'asset') {
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

    /** FUEL-B5.1: null/'' ⇒ لم تُسجَّل؛ وإلا هللات صحيحة **موجبة** (الصفر ليس تكلفة فعلية). */
    private function optionalCost(mixed $value): ?int
    {
        if ($value === null || $value === '') {
            return null;
        }
        if (! is_int($value) || $value < 1) {
            throw new RuntimeException('FUEL_DELIVERY_COST_INVALID: تكلفة الاستلام الفعلية يجب أن تكون هللات صحيحة موجبة.');
        }

        return $value;
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

    private function idString(mixed $value): ?string
    {
        if ($value === null) {
            return null;
        }
        $value = trim((string) $value);

        return $value === '' ? null : $value;
    }

    /** يطبّع قيمة مركّبة للمقارنة: null/فارغ ⇒ null، المصفوفات الترابطية مرتّبة المفاتيح، والنتيجة نص JSON ثابت. */
    private function canonical(mixed $value): ?string
    {
        if ($value === null || $value === '' || $value === []) {
            return null;
        }
        $normalize = function (mixed $node) use (&$normalize): mixed {
            if (! is_array($node)) {
                return $node;
            }
            $node = array_map($normalize, $node);
            if (! array_is_list($node)) {
                ksort($node);
            }

            return $node;
        };

        return json_encode($normalize($value), JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRESERVE_ZERO_FRACTION) ?: null;
    }

    private function safeAdd(int $left, int $right, string $label): int
    {
        if ($right > PHP_INT_MAX - $left) {
            throw new RuntimeException("{$label} يتجاوز الحد المسموح به.");
        }

        return $left + $right;
    }
}
