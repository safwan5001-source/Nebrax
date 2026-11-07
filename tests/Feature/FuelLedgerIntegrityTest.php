<?php

namespace Tests\Feature;

use App\Models\Account;
use App\Models\Branch;
use App\Models\FuelDelivery;
use App\Models\FuelNozzle;
use App\Models\FuelOperationalLedger;
use App\Models\FuelProduct;
use App\Models\FuelPump;
use App\Models\FuelReconciliation;
use App\Models\FuelSale;
use App\Models\FuelShift;
use App\Models\FuelStation;
use App\Models\FuelTank;
use App\Models\Invoice;
use App\Models\JournalEntry;
use App\Models\Partner;
use App\Models\Product;
use App\Models\ProductWarehouseStock;
use App\Models\StockMovement;
use App\Models\User;
use App\Models\Warehouse;
use App\Services\FuelReconciliationService;
use App\Services\FuelSaleService;
use App\Services\FuelShiftService;
use App\Services\FuelStationProductPriceService;
use App\Services\FuelStationSettingsService;
use App\Services\FuelSupplyReceivingService;
use App\Tenancy\BranchContext;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use PHPUnit\Framework\Attributes\Test;
use RuntimeException;
use Tests\TestCase;

/**
 * P0 (Tank Level) — سلامة الدفتر التشغيلي للوقود.
 *
 * الدفتر `fuel_operational_ledgers` يُكتب من ثلاثة مسارات فقط (اعتماد البيع، اعتماد الاستلام، اعتماد التسوية)، وكلٌّ منها يكتبه في
 * معاملة حركة المخزون نفسها. هذا الملف يثبت تلك العلاقة باختبارات، دون تعديل أي منطق:
 *  1) اعتماد البيع ⇒ صف دفتر واحد بالخزان الصحيح (خزان الفوهة) وكمية سالبة.
 *  2) المسودة لا تمس الرصيد ولا الدفتر ولا المخزون ولا الفاتورة.
 *  3) كل حركة وقود معتمدة (بيع/استلام/تسوية) تقابلها صف دفتر واحد مطابق، ومجموع الدفتر = الرصيد الرسمي (خزان وحيد).
 *  4) إعادة اعتماد البيع (ولو بنسخة قديمة في الذاكرة) لا تكرر الخصم، والرفض لا يترك أثراً.
 *  6) عمليات الوردية وقراءات العدادات والخزانات وحدها لا تنشئ حركة مخزون ولا صف دفتر.
 *
 * التزامن الحقيقي على PostgreSQL في `FuelSaleFinalizeConcurrencyPostgresTest`.
 */
class FuelLedgerIntegrityTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;
    use CapturesThrowable;

    private const DELIVERED_ML = 10000;
    private const PRICE_PER_LITER_MINOR = 230;

    /** 1) */
    #[Test]
    public function finalizing_a_sale_writes_exactly_one_negative_ledger_row_on_the_nozzles_own_tank(): void
    {
        $f = $this->fixture(withSecondTank: true);
        $this->deliver($f, 'int-d1');
        $baseLedger = FuelOperationalLedger::count();
        $this->assertSame(1, $baseLedger, 'الاستلام وحده يكتب صفاً واحداً');

        // البيع من فوهة الخزان الثاني (نفس المجمّع): الصف يجب أن يحمل الخزان الثاني لا الأول.
        $sale = $this->draftSale($f, 'int-s1', 1234, nozzle: $f['nozzle2']);
        $finalized = app(FuelSaleService::class)->finalize($sale, $f['actor']);

        $rows = FuelOperationalLedger::where('source_type', FuelSale::class)->where('source_id', $finalized->id)->get();
        $this->assertCount(1, $rows);
        $row = $rows->sole();
        $this->assertSame($f['tank2']->id, $row->fuel_tank_id, 'الخزان = خزان الفوهة المباعة منها');
        $this->assertNotSame($f['tank']->id, $row->fuel_tank_id);
        $this->assertSame($f['tank2']->id, $finalized->fuel_tank_id);
        $this->assertSame(FuelOperationalLedger::TYPE_SALE, $row->movement_type);
        $this->assertSame(-1234, (int) $row->quantity_milliliters, 'الكمية سالبة وبمقدار البيع تماماً');
        $this->assertSame('fuel-sale:' . $finalized->id, $row->idempotency_key);
        $this->assertSame($f['station']->id, $row->fuel_station_id);
        $this->assertSame($f['warehouse']->id, $row->warehouse_id);
        $this->assertSame($f['fuelProduct']->id, $row->fuel_product_id);
        $this->assertSame($finalized->stock_movement_id, $row->stock_movement_id);
        $this->assertSame(-(int) $finalized->cogs_minor, (int) $row->value_minor);
        $this->assertSame($baseLedger + 1, FuelOperationalLedger::count(), 'صف واحد جديد فقط');

        // رصيد الدفتر اللحظي = رصيد المجمّع الرسمي بعد الحركة (وليس رصيد الخزان).
        $pool = $this->pool($f);
        $this->assertSame(self::DELIVERED_ML - 1234, $pool);
        $this->assertSame($pool, (int) $row->book_balance_milliliters);
    }

    /** 2) */
    #[Test]
    public function a_draft_sale_changes_neither_stock_nor_ledger_nor_accounting(): void
    {
        $f = $this->fixture();
        $this->deliver($f, 'int-d2');
        $before = $this->snapshot($f);

        $draft = $this->draftSale($f, 'int-s2', 4000);
        $this->assertSame(FuelSale::STATUS_DRAFT, $draft->status);
        $this->assertSame($before, $this->snapshot($f), 'إنشاء المسودة لا يمس الرصيد ولا الدفتر ولا المخزون ولا القيود ولا الفواتير');

        // إعادة إرسال المسودة بنفس المفتاح تعيد المسودة نفسها وتبقى بلا أثر.
        $again = $this->draftSale($f, 'int-s2', 4000);
        $this->assertSame($draft->id, $again->id);
        $this->assertSame(1, FuelSale::count());
        $this->assertSame($before, $this->snapshot($f));

        // نفس المفتاح بكمية مختلفة مرفوض ولا أثر له.
        $thrown = $this->thrown(fn () => $this->draftSale($f, 'int-s2', 4001), 'إعادة استعمال المفتاح بكمية مختلفة يجب أن تُرفض.');
        $this->assertInstanceOf(RuntimeException::class, $thrown);
        $this->assertSame($before, $this->snapshot($f));
    }

    /** 3) */
    #[Test]
    public function every_approved_fuel_movement_has_exactly_one_matching_ledger_row_and_the_ledger_sums_to_the_official_balance(): void
    {
        $f = $this->fixture();

        // استلام (+10 L) ثم بيع (−1.234 L) ثم تسوية فقد (قراءة 7 L) ثم تسوية مطابِقة (قراءة 7 L = الدفتري).
        $this->deliver($f, 'par-d1');
        $sale = app(FuelSaleService::class)->finalize($this->draftSale($f, 'par-s1', 1234), $f['actor']);
        $loss = $this->reconcile($f, 'par-r1', '7.000'); // الدفتري 8.766 ⇒ فرق −1.766
        $matched = $this->reconcile($f, 'par-r2', '7.000'); // الدفتري 7.000 ⇒ فرق 0

        $this->assertSame(-1766, (int) $loss->variance_milliliters);
        $this->assertSame(0, (int) $matched->variance_milliliters);

        $sources = [FuelDelivery::class, FuelSale::class, FuelReconciliation::class];
        $movements = StockMovement::whereIn('source_type', $sources)->get();
        $this->assertCount(3, $movements, 'استلام + بيع + تسوية الفقد (المطابِقة بلا حركة)');

        foreach ($movements as $movement) {
            $rows = FuelOperationalLedger::where('stock_movement_id', $movement->id)->get();
            $this->assertCount(1, $rows, "الحركة {$movement->source_type} يجب أن يقابلها صف دفتر واحد");
            $row = $rows->sole();
            $this->assertSame($movement->source_type, $row->source_type);
            $this->assertSame($movement->source_id, $row->source_id);
            $this->assertSame($movement->warehouse_id, $row->warehouse_id);
            // الإشارة: الحركة `in` ⇒ موجب، `out` ⇒ سالب، والمقدار نفسه.
            $signed = $movement->type === 'out' ? -(int) $movement->quantity : (int) $movement->quantity;
            $this->assertSame($signed, (int) $row->quantity_milliliters, "مقدار/إشارة {$movement->source_type}");
            // رصيد الدفتر اللحظي = الرصيد بعد الحركة نفسها.
            $this->assertSame((int) $movement->balance_quantity, (int) $row->book_balance_milliliters, "رصيد {$movement->source_type}");
            $this->assertSame($f['tank']->id, $row->fuel_tank_id);
        }

        // العكس: كل صف دفتر مرتبط بحركة يشير إلى حركة وقود معتمدة موجودة.
        $linkedIds = FuelOperationalLedger::whereNotNull('stock_movement_id')->pluck('stock_movement_id')->all();
        $this->assertEqualsCanonicalizing($movements->pluck('id')->all(), $linkedIds);

        // التسوية المطابِقة تُسجَّل صفاً بكمية صفر ولا حركة مخزون ولا قيد.
        $matchedRow = FuelOperationalLedger::where('fuel_reconciliation_id', $matched->id)->sole();
        $this->assertSame(FuelOperationalLedger::TYPE_RECONCILIATION_MATCHED, $matchedRow->movement_type);
        $this->assertSame(0, (int) $matchedRow->quantity_milliliters);
        $this->assertNull($matchedRow->stock_movement_id);
        $this->assertNull($matched->fresh()->stock_movement_id);

        // مصدر كل صف من الثلاثة المسارات المعروفة فقط، وصف واحد لكل مصدر.
        $this->assertSame(4, FuelOperationalLedger::count());
        $this->assertSame(0, FuelOperationalLedger::whereNotIn('source_type', $sources)->count());
        $this->assertSame(0, FuelOperationalLedger::query()->select('source_type', 'source_id')->groupBy('source_type', 'source_id')->havingRaw('count(*) > 1')->get()->count());

        // مجموع الدفتر = الرصيد الرسمي (المحطة بخزان وحيد، وكل مخزون الوقود دخل عبر مسارات الوقود).
        $this->assertSame($this->pool($f), (int) FuelOperationalLedger::sum('quantity_milliliters'));
        $this->assertSame(7000, $this->pool($f));
        $this->assertSame($sale->stock_movement_id, FuelOperationalLedger::where('source_id', $sale->id)->value('stock_movement_id'));
    }

    /** 4) */
    #[Test]
    public function resending_a_finalize_never_deducts_twice_even_with_a_stale_in_memory_draft(): void
    {
        $f = $this->fixture();
        $this->deliver($f, 'rep-d1');
        $service = app(FuelSaleService::class);
        $stale = $this->draftSale($f, 'rep-s1', 2500); // نسخة ستبقى «مسودة» في الذاكرة

        $first = $service->finalize($stale, $f['actor']);
        $afterFirst = $this->snapshot($f);
        $this->assertSame(self::DELIVERED_ML - 2500, $this->pool($f));

        foreach ([$stale, $first, FuelSale::findOrFail($first->id)] as $instance) {
            $again = $service->finalize($instance, $f['actor']);
            $this->assertSame($first->id, $again->id);
            $this->assertSame(FuelSale::STATUS_FINALIZED, $again->status);
        }
        $this->assertSame($afterFirst, $this->snapshot($f), 'إعادة الاعتماد لا تغيّر الرصيد ولا الدفتر ولا القيود ولا الفواتير');
        $this->assertSame(1, StockMovement::where('source_type', FuelSale::class)->where('source_id', $first->id)->count());
        $this->assertSame(1, FuelOperationalLedger::where('source_type', FuelSale::class)->where('source_id', $first->id)->count());
        $this->assertSame(1, JournalEntry::where('id', $first->cogs_journal_entry_id)->count());

        // إعادة إرسال المسودة نفسها بعد الاعتماد تعيد البيع المعتمد ولا تنشئ بيعاً جديداً.
        $resent = $this->draftSale($f, 'rep-s1', 2500);
        $this->assertSame($first->id, $resent->id);
        $this->assertSame(1, FuelSale::count());
        $this->assertSame($afterFirst, $this->snapshot($f));
    }

    /** 4) */
    #[Test]
    public function a_rejected_finalize_leaves_no_stock_ledger_invoice_or_journal_effect(): void
    {
        $f = $this->fixture();
        $this->deliver($f, 'rej-d1');
        $draft = $this->draftSale($f, 'rej-s1', self::DELIVERED_ML + 1); // أكبر من الرصيد
        $before = $this->snapshot($f);

        $thrown = $this->thrown(fn () => app(FuelSaleService::class)->finalize($draft, $f['actor']), 'الاعتماد فوق الرصيد يجب أن يُرفض.');

        $this->assertInstanceOf(RuntimeException::class, $thrown, 'الاعتماد فوق الرصيد يجب أن يُرفض');
        $this->assertSame($before, $this->snapshot($f), 'التراجع كامل: لا حركة ولا دفتر ولا فاتورة ولا قيد');
        $this->assertSame(FuelSale::STATUS_DRAFT, FuelSale::findOrFail($draft->id)->status);
        $this->assertSame(self::DELIVERED_ML, $this->pool($f));
    }

    /** 6) */
    #[Test]
    public function shift_operations_and_meter_or_tank_readings_alone_never_create_stock_or_ledger_effects(): void
    {
        $f = $this->fixture(configureShiftPolicy: true);
        $this->deliver($f, 'sh-d1');
        $before = $this->snapshot($f);
        $service = app(FuelShiftService::class);

        $shift = $service->open(['fuel_station_id' => $f['station']->id, 'opening_float_minor' => 1000, 'idempotency_key' => 'sh-open'], $f['actor']);
        $service->recordMeter($shift, ['fuel_nozzle_id' => $f['nozzle']->id, 'reading_stage' => 'opening', 'meter_milliliters' => 100000, 'evidence_key' => 'sh-m-open'], $f['actor']);
        $service->recordTank($shift, ['fuel_tank_id' => $f['tank']->id, 'reading_stage' => 'opening', 'reading_type' => 'physical', 'quantity_milliliters' => 10000, 'evidence_key' => 'sh-t-open'], $f['actor']);
        // العداد يقول إن 3 لترات صُرفت، لكن لا بيع معتمد ⇒ لا خصم من الرصيد.
        $service->recordMeter($shift, ['fuel_nozzle_id' => $f['nozzle']->id, 'reading_stage' => 'closing', 'meter_milliliters' => 103000, 'evidence_key' => 'sh-m-close'], $f['actor']);
        $service->recordTank($shift, ['fuel_tank_id' => $f['tank']->id, 'reading_stage' => 'closing', 'reading_type' => 'physical', 'quantity_milliliters' => 7000, 'evidence_key' => 'sh-t-close'], $f['actor']);
        $service->assignStaff($shift, $f['actor']->id, 'attendant', $f['actor']);
        $closed = $service->close($shift, 1000, null, $f['actor']);
        $service->approve($closed, null, $f['supervisor']);

        $this->assertSame(1, \App\Models\FuelShiftMeterReading::where('fuel_shift_id', $shift->id)->where('reading_stage', 'opening')->count());
        $this->assertSame(3000, (int) $closed->fresh()->operational_meter_milliliters, 'الوردية اشتقّت لتراتها من العداد فقط');
        $this->assertSame($before, $this->snapshot($f), 'لا حركة مخزون ولا صف دفتر ولا بيع ولا فاتورة ولا قيد من الوردية/القراءات');
        $this->assertSame(0, FuelSale::count());
        $this->assertSame(self::DELIVERED_ML, $this->pool($f));

        // قراءة خزان مستقلة (دليل) ومسودة تسوية أيضاً لا تحرّكان شيئاً قبل الاعتماد الصريح.
        $this->enter($f);
        $reading = app(FuelReconciliationService::class)->recordReading([
            'fuel_station_id' => $f['station']->id, 'fuel_tank_id' => $f['tank']->id, 'reading_type' => 'physical',
            'quantity_liters' => '3.000', 'evidence_key' => 'sh-standalone', 'recorded_by' => $f['actor']->id,
        ]);
        app(FuelReconciliationService::class)->createDraft([
            'fuel_station_id' => $f['station']->id, 'fuel_tank_id' => $f['tank']->id, 'physical_reading_id' => $reading->id, 'created_by' => $f['actor']->id,
        ]);
        $this->assertSame($before, $this->snapshot($f));
    }

    // ───────────────────────── أدوات ─────────────────────────

    /** @param array<string,mixed> $f @return array<string,int> */
    private function snapshot(array $f): array
    {
        return [
            'pool' => $this->pool($f),
            'product_on_hand' => (int) Product::findOrFail($f['product']->id)->quantity_on_hand,
            'stock_movements' => StockMovement::count(),
            'ledger' => FuelOperationalLedger::count(),
            'invoices' => Invoice::count(),
            'journal_entries' => JournalEntry::count(),
            'sales' => FuelSale::count() - FuelSale::where('status', FuelSale::STATUS_DRAFT)->count(),
        ];
    }

    /** @param array<string,mixed> $f */
    private function pool(array $f): int
    {
        return (int) (ProductWarehouseStock::where('warehouse_id', $f['warehouse']->id)->where('product_id', $f['product']->id)->value('quantity') ?? 0);
    }

    /** @param array<string,mixed> $f */
    private function enter(array $f): void
    {
        app(TenantContext::class)->set($f['tenant_id']);
        app(BranchContext::class)->set($f['branch']->id);
    }

    /** استلام معتمد حقيقي (يغذّي المجمّع والدفتر معاً، على عكس الحقن المباشر في بعض fixtures أخرى). @param array<string,mixed> $f */
    private function deliver(array $f, string $key): FuelDelivery
    {
        $service = app(FuelSupplyReceivingService::class);
        $delivery = $service->createDelivery([
            'fuel_station_id' => $f['station']->id, 'fuel_tank_id' => $f['tank']->id, 'fuel_product_id' => $f['fuelProduct']->id,
            'warehouse_id' => $f['warehouse']->id, 'supplier_id' => $f['supplier']->id,
            'dispatched_liters' => '10.000', 'received_liters' => '10.000', 'received_total_cost_minor' => 2345,
            'delivery_note_number' => "DN-{$key}", 'idempotency_key' => $key, 'received_at' => '2026-08-23 10:00:00',
            'created_by' => $f['actor']->id,
        ]);

        return $service->approveDelivery($delivery, $f['actor']->id);
    }

    /** @param array<string,mixed> $f */
    private function draftSale(array $f, string $key, int $milliliters, ?FuelNozzle $nozzle = null): FuelSale
    {
        $nozzle ??= $f['nozzle'];
        // اعتماد البيع يشترط وردية محطة مفتوحة (قاعدة قائمة)؛ تُفتح مرة واحدة لكل اختبار.
        $shift = FuelShift::where('fuel_station_id', $f['station']->id)->where('status', FuelShift::STATUS_OPEN)->first()
            ?? app(FuelShiftService::class)->open(['fuel_station_id' => $f['station']->id, 'opening_float_minor' => 0, 'idempotency_key' => 'int-shift-' . $key], $f['actor']);

        return app(FuelSaleService::class)->createDraft([
            'fuel_station_id' => $f['station']->id, 'fuel_nozzle_id' => $nozzle->id, 'fuel_shift_id' => $shift->id, 'partner_id' => $f['customer']->id,
            'quantity_milliliters' => $milliliters, 'idempotency_key' => $key,
        ], $f['actor']);
    }

    /** @param array<string,mixed> $f */
    private function reconcile(array $f, string $key, string $liters): FuelReconciliation
    {
        $service = app(FuelReconciliationService::class);
        $reading = $service->recordReading([
            'fuel_station_id' => $f['station']->id, 'fuel_tank_id' => $f['tank']->id, 'reading_type' => 'physical',
            'quantity_liters' => $liters, 'evidence_key' => $key, 'recorded_by' => $f['actor']->id,
        ]);
        $draft = $service->createDraft([
            'fuel_station_id' => $f['station']->id, 'fuel_tank_id' => $f['tank']->id, 'physical_reading_id' => $reading->id, 'created_by' => $f['actor']->id,
        ]);

        return $service->approve($draft, $f['actor']->id, 'اعتماد اختبار السلامة');
    }

    /** @return array<string,mixed> */
    private function fixture(bool $withSecondTank = false, bool $configureShiftPolicy = false): array
    {
        $slug = 'fuel-int-' . substr(md5(uniqid('', true)), 0, 8);
        $auth = $this->registerTenant($slug, "{$slug}@example.test");
        $tenantId = $auth['tenant_id'];
        app(TenantContext::class)->set($tenantId);
        $branch = Branch::where('tenant_id', $tenantId)->sole();
        app(BranchContext::class)->set($branch->id);
        \App\Models\Tenant::findOrFail($tenantId)->update(['country' => 'SA']);
        $actor = User::where('tenant_id', $tenantId)->where('role', 'owner')->sole();
        $supervisor = User::create(['tenant_id' => $tenantId, 'name' => 'مشرف', 'email' => "sup-{$slug}@example.test", 'password' => 'password123', 'role' => 'admin']);
        $warehouse = Warehouse::where('tenant_id', $tenantId)->where('branch_id', $branch->id)->sole();
        $customer = Partner::create(['tenant_id' => $tenantId, 'branch_id' => $branch->id, 'name' => 'عميل سلامة الدفتر', 'type' => 'customer']);
        $supplier = Partner::create(['tenant_id' => $tenantId, 'branch_id' => $branch->id, 'name' => 'مورد سلامة الدفتر', 'type' => 'supplier', 'is_active' => true]);
        $product = Product::create(['tenant_id' => $tenantId, 'branch_id' => $branch->id, 'sku' => 'FUEL-INT-' . $slug, 'name' => 'وقود سلامة', 'unit' => 'mL', 'track_inventory' => true]);
        $fuelProduct = FuelProduct::create(['tenant_id' => $tenantId, 'product_id' => $product->id, 'code' => 'FI-' . $slug, 'name' => 'بنزين 95']);
        $station = FuelStation::create(['tenant_id' => $tenantId, 'branch_id' => $branch->id, 'warehouse_id' => $warehouse->id, 'code' => 'FIS-' . $slug, 'name' => 'محطة سلامة']);
        $mkTank = fn (string $n) => FuelTank::create([
            'tenant_id' => $tenantId, 'branch_id' => $branch->id, 'fuel_station_id' => $station->id, 'fuel_product_id' => $fuelProduct->id,
            'code' => "T{$n}-{$slug}", 'name' => "خزان {$n}", 'capacity_milliliters' => 1000000, 'safe_capacity_milliliters' => 900000,
        ]);
        $pump = FuelPump::create(['tenant_id' => $tenantId, 'branch_id' => $branch->id, 'fuel_station_id' => $station->id, 'pump_number' => 'P-' . $slug]);
        $mkNozzle = fn (FuelTank $t, string $n) => FuelNozzle::create([
            'tenant_id' => $tenantId, 'branch_id' => $branch->id, 'fuel_station_id' => $station->id, 'fuel_pump_id' => $pump->id,
            'fuel_tank_id' => $t->id, 'fuel_product_id' => $fuelProduct->id, 'nozzle_number' => "N{$n}-{$slug}",
        ]);
        $tank = $mkTank('1');
        $nozzle = $mkNozzle($tank, '1');
        $extra = [];
        if ($withSecondTank) {
            $tank2 = $mkTank('2');
            $extra = ['tank2' => $tank2, 'nozzle2' => $mkNozzle($tank2, '2')];
        }

        // GRNI صريح للاستلام (لا fallback في الخدمة).
        $grni = Account::create(['code' => '2199', 'name' => 'مخزون مستلم غير مفوتر', 'type' => 'liability', 'normal_balance' => 'credit', 'is_group' => false, 'is_active' => true]);
        app(FuelStationSettingsService::class)->putTenant(['grni_account_id' => $grni->id], $actor, 'تهيئة GRNI لاختبار السلامة');
        app(FuelStationProductPriceService::class)->create([
            'fuel_station_id' => $station->id, 'fuel_product_id' => $fuelProduct->id, 'price_per_liter_minor' => self::PRICE_PER_LITER_MINOR,
            'effective_from' => now()->subMinute()->toIso8601String(), 'reason' => 'سعر اختبار السلامة',
        ], $actor);

        if ($configureShiftPolicy) {
            app(FuelStationSettingsService::class)->putStationValues($station, [
                'shift_opening_meter_reading_required' => true, 'shift_closing_meter_reading_required' => true,
                'shift_opening_tank_reading_required' => true, 'shift_closing_tank_reading_required' => true,
                'shift_opening_cash_float_required' => true, 'shift_mandatory_staff_assignment' => true,
                'shift_mandatory_cash_count' => true, 'shift_supervisor_approval_required' => true,
                'shift_allow_close_with_pending_cash_variance' => true, 'shift_allow_close_with_unresolved_operational_variance' => true,
            ], $actor, 'سياسة الوردية لاختبار السلامة');
        }

        return compact('actor', 'supervisor', 'branch', 'warehouse', 'customer', 'supplier', 'product', 'fuelProduct', 'station', 'tank', 'pump', 'nozzle', 'grni')
            + $extra + ['tenant_id' => $tenantId];
    }
}
