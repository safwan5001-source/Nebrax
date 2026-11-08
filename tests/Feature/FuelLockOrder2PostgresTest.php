<?php

namespace Tests\Feature;

use App\Models\Account;
use App\Models\FuelDelivery;
use App\Models\FuelNozzle;
use App\Models\FuelPump;
use App\Models\FuelReconciliation;
use App\Models\FuelSale;
use App\Models\Partner;
use App\Models\User;
use App\Services\FuelCostBasisService;
use App\Services\FuelOpeningBalanceService;
use App\Services\FuelReconciliationService;
use App\Services\FuelSaleService;
use App\Services\FuelShiftService;
use App\Services\FuelStationProductPriceService;
use App\Services\FuelStationSettingsService;
use App\Services\FuelSupplyReceivingService;
use App\Tenancy\BranchContext;
use App\Tenancy\TenantContext;
use Illuminate\Support\Facades\DB;
use PHPUnit\Framework\Attributes\Test;
use Tests\TestCase;

/**
 * FUEL-LOCK-ORDER-2 — لا جمود بين مسارات المجمّع (استلام/تسوية خزان/رصيد افتتاحي) وإنهاء بيع ERP، على PostgreSQL حقيقي.
 *
 * ترتيب ERP الفعلي (`InvoiceService::post`): **مِرساة المستأجر ← رصيد المخزن ← حالة التكلفة**. المسارات الثلاثة كانت تقفل المجمّع ثم تنتظر المِرساة (جمود 40P01 مُستنسَخ).
 * الترتيب الموحَّد الآن: مِرساة المستأجر أولاً في كل مسار يكتب حالة التكلفة (`AccountingDateGuard::lockLedgerAnchor()`). طبقات الإثبات:
 *  0) **استنساخ الدورة القديمة**: جلستا `psql` بالترتيبين المتعاكسين (المِرساة→التكلفة مقابل التكلفة→المِرساة) تنتجان `deadlock detected` — يثبت أن الاختبارات تلتقط الدورة.
 *  1) **حتمي**: جلسة `psql` تحاكي ترتيب ERP (مِرساة ← نوم ← حالة التكلفة والرصيد) والمسار الحقيقي يعمل بينها: قبل الإصلاح جمود، بعده ينتظر المِرساة ثم يكتمل.
 *  2) **تزاحم فعلي** بالكود الحقيقي (`pcntl_fork`): إنهاء بيع ERP مقابل اعتماد استلام مقابل اعتماد تسوية خزان على المجمّع نفسه، جولات متكررة.
 * يُتخطّى على SQLite؛ غياب `pcntl`/`psql` على PostgreSQL فشل لا تخطٍّ. لا أثر محاسبي جديد: تحقق من القيود والحركات في كل مسار.
 */
class FuelLockOrder2PostgresTest extends TestCase
{
    use InteractsWithApi;
    use UsesWorkerDatabaseWithoutTransaction;
    use BuildsFuelOpeningWorld;

    private string $dir = '';

    protected function setUp(): void
    {
        parent::setUp();
        if (DB::connection()->getDriverName() !== 'pgsql') {
            $this->markTestSkipped('يتطلب PostgreSQL حقيقياً — SQLite لا يُظهر أقفال الصفوف.');
        }
        $this->assertTrue(function_exists('pcntl_fork'), 'pcntl مطلوب؛ غيابه فشل لا تخطٍّ.');
        $this->dir = sys_get_temp_dir().'/fuel_lock_order2_'.uniqid();
        mkdir($this->dir);
    }

    protected function tearDown(): void
    {
        if ($this->dir !== '') {
            foreach (glob($this->dir.'/*') ?: [] as $file) {
                @unlink($file);
            }
            @rmdir($this->dir);
        }
        if (DB::connection()->getDriverName() === 'pgsql') {
            $this->cleanupOpeningTenants();
        }
        parent::tearDown();
    }

    // ───────── العالم: محطة بمجمّع 91 مرحَّل فيه رصيد افتتاحي + ERP + استلام + تسوية ─────────

    /** @return array<string,mixed> */
    private function world(): array
    {
        $w = $this->openingWorld();
        $this->enter($w);
        $w['supplier'] = Partner::create(['branch_id' => $w['branch']->id, 'type' => 'supplier', 'name' => 'مورد ترتيب الأقفال', 'is_active' => true]);
        $grni = Account::create(['code' => '2199', 'name' => 'GRNI ترتيب الأقفال', 'type' => 'liability', 'normal_balance' => 'credit', 'is_group' => false, 'is_active' => true]);
        $settings = app(FuelStationSettingsService::class);
        $settings->putTenant(['grni_account_id' => $grni->id], $w['actor'], 'GRNI لاختبار ترتيب الأقفال');

        // رصيد افتتاحي مرحَّل يؤسس حالة التكلفة والرصيد للمجمّعات الثلاثة.
        $doc = app(FuelOpeningBalanceService::class)->createDraft($this->openingPayload($w), $w['actor'])['document'];
        app(FuelOpeningBalanceService::class)->post($doc, $w['actor']);

        $pump = FuelPump::create(['branch_id' => $w['branch']->id, 'fuel_station_id' => $w['station']->id, 'pump_number' => 'LO2-P1']);
        $w['nozzle'] = FuelNozzle::create([
            'branch_id' => $w['branch']->id, 'fuel_station_id' => $w['station']->id, 'fuel_pump_id' => $pump->id,
            'fuel_tank_id' => $w['tanks']['91']->id, 'fuel_product_id' => $w['fuels']['91']->id, 'nozzle_number' => 'LO2-N1',
        ]);
        app(FuelStationProductPriceService::class)->create([
            'fuel_station_id' => $w['station']->id, 'fuel_product_id' => $w['fuels']['91']->id, 'price_per_liter_minor' => 230,
            'effective_from' => now()->subMinute()->toIso8601String(), 'reason' => 'سعر اختبار',
        ], $w['actor']);
        $settings->putStationValues($w['station'], [
            'shift_opening_meter_reading_required' => false, 'shift_closing_meter_reading_required' => false,
            'shift_opening_tank_reading_required' => false, 'shift_closing_tank_reading_required' => false,
            'shift_mandatory_staff_assignment' => false, 'fuel_sales_allow_deferred_payment' => false,
        ], $w['actor'], 'تهيئة اختبار ترتيب الأقفال');
        $w['customer'] = Partner::create(['branch_id' => $w['branch']->id, 'type' => 'customer', 'name' => 'عميل ترتيب الأقفال']);
        $w['shift'] = app(FuelShiftService::class)->open(['fuel_station_id' => $w['station']->id, 'opening_float_minor' => 0, 'idempotency_key' => 'lo2-shift-'.$w['slug']], $w['actor']);

        return $w;
    }

    /** @param array<string,mixed> $w */
    private function enter(array $w): void
    {
        app(TenantContext::class)->set($w['tenant_id']);
        app(BranchContext::class)->set($w['branch']->id);
    }

    /** @param array<string,mixed> $w */
    private function draftSale(array $w, string $key): FuelSale
    {
        return app(FuelSaleService::class)->createDraft([
            'fuel_station_id' => $w['station']->id, 'fuel_nozzle_id' => $w['nozzle']->id, 'fuel_shift_id' => $w['shift']->id,
            'partner_id' => $w['customer']->id, 'quantity_milliliters' => 1000, 'idempotency_key' => $key,
        ], $w['actor']);
    }

    /** @param array<string,mixed> $w */
    private function draftDelivery(array $w, string $key): FuelDelivery
    {
        return app(FuelSupplyReceivingService::class)->createDelivery([
            'fuel_station_id' => $w['station']->id, 'fuel_tank_id' => $w['tanks']['91']->id, 'fuel_product_id' => $w['fuels']['91']->id,
            'warehouse_id' => $w['warehouse']->id, 'supplier_id' => $w['supplier']->id, 'dispatched_liters' => '10.000', 'received_liters' => '10.000',
            'received_total_cost_minor' => 2345, 'delivery_note_number' => 'DN-'.$key, 'idempotency_key' => $key,
            'received_at' => now()->toDateTimeString(), 'created_by' => $w['actor']->id,
        ]);
    }

    /** مسودة تسوية خزان بفقد 1 مل على مجمّع 91 (قراءة مادية ثم مسودة). @param array<string,mixed> $w */
    private function draftReconciliation(array $w, string $key): FuelReconciliation
    {
        $service = app(FuelReconciliationService::class);
        $book = (int) DB::table('product_warehouse_stock')->where('warehouse_id', $w['warehouse']->id)->where('product_id', $w['fuels']['91']->product_id)->value('quantity');
        $reading = $service->recordReading([
            'fuel_station_id' => $w['station']->id, 'fuel_tank_id' => $w['tanks']['91']->id, 'reading_type' => 'physical',
            'quantity_liters' => $this->liters($book - 1), 'evidence_key' => 'lo2-'.$key, 'recorded_by' => $w['actor']->id,
        ]);

        return $service->createDraft([
            'fuel_station_id' => $w['station']->id, 'fuel_tank_id' => $w['tanks']['91']->id, 'physical_reading_id' => $reading->id,
            'created_by' => $w['actor']->id, 'reason' => 'فقد اختبار ترتيب الأقفال',
        ]);
    }

    private function liters(int $milliliters): string
    {
        return intdiv($milliliters, 1000).'.'.str_pad((string) ($milliliters % 1000), 3, '0', STR_PAD_LEFT);
    }

    // ───────── أدوات psql ─────────

    /** @return array{0: resource, 1: array} */
    private function startHolder(string $sql): array
    {
        $c = config('database.connections.pgsql');
        $proc = proc_open(
            ['psql', '-h', $c['host'], '-p', (string) $c['port'], '-U', $c['username'], '-d', DB::connection()->getDatabaseName(), '-v', 'ON_ERROR_STOP=1', '-c', $sql],
            [1 => ['pipe', 'w'], 2 => ['pipe', 'w']], $pipes, null, ['PGPASSWORD' => (string) $c['password']] + getenv(),
        );
        $this->assertIsResource($proc, 'تعذر تشغيل psql');

        return [$proc, $pipes];
    }

    /** @return array{0:string,1:int} */
    private function finishHolder(array $holder): array
    {
        [$proc, $pipes] = $holder;

        return [trim((string) stream_get_contents($pipes[2])), proc_close($proc)];
    }

    /** ترتيب ERP الفعلي: مِرساة المستأجر ← (نوم) ← رصيد المخزن ← حالة التكلفة. @param array<string,mixed> $w */
    private function erpOrderSql(array $w, float $sleep = 1.5): string
    {
        return sprintf(
            "BEGIN; SELECT 1 FROM tenants WHERE id='%s' FOR UPDATE; SELECT pg_sleep(%s); SELECT 1 FROM product_warehouse_stock WHERE warehouse_id='%s' FOR UPDATE; "
            ."SELECT 1 FROM fuel_inventory_cost_states WHERE warehouse_id='%s' FOR UPDATE; COMMIT;",
            $w['tenant_id'], $sleep, $w['warehouse']->id, $w['warehouse']->id,
        );
    }

    /**
     * يشغّل $operation بينما جلسة ERP المحاكاة تمسك المِرساة: لا جمود، والعملية تنتظر المِرساة (زمنها > الانتظار) ثم تكتمل.
     *
     * @param array<string,mixed> $w
     */
    private function assertWaitsBehindErpWithoutDeadlock(array $w, callable $operation, string $label): void
    {
        $holder = $this->startHolder($this->erpOrderSql($w));
        usleep(500000);
        $started = microtime(true);
        $error = null;
        try {
            $operation();
        } catch (\Throwable $e) {
            $error = $e;
        }
        $elapsed = microtime(true) - $started;
        [$stderr, $exit] = $this->finishHolder($holder);

        $this->assertStringNotContainsString('deadlock', $stderr, "{$label}: جلسة ERP المحاكاة ضحية جمود — {$stderr}");
        $this->assertSame(0, $exit, "{$label}: {$stderr}");
        $this->assertNull($error, "{$label}: ".($error ? get_class($error).': '.$error->getMessage() : ''));
        $this->assertGreaterThan(0.6, $elapsed, "{$label}: كان يجب أن ينتظر المِرساة المحجوزة (لا يتجاوزها إلى المجمّع)");
    }

    // ───────── 0) استنساخ الدورة القديمة ─────────

    #[Test]
    public function the_legacy_pool_before_anchor_order_deadlocks_against_the_erp_order_proving_the_harness_catches_it(): void
    {
        $w = $this->world();
        $erp = $this->startHolder($this->erpOrderSql($w, 1.5));
        // الترتيب القديم لاعتماد الاستلام/التسوية/الافتتاحي: حالة التكلفة والرصيد أولاً ثم المِرساة.
        $legacy = $this->startHolder(sprintf(
            "BEGIN; SELECT 1 FROM fuel_inventory_cost_states WHERE warehouse_id='%s' FOR UPDATE; SELECT pg_sleep(1.0); SELECT 1 FROM tenants WHERE id='%s' FOR UPDATE; COMMIT;",
            $w['warehouse']->id, $w['tenant_id'],
        ));
        [$erpErr] = $this->finishHolder($erp);
        [$legacyErr] = $this->finishHolder($legacy);

        $this->assertTrue(
            str_contains($erpErr.$legacyErr, 'deadlock detected'),
            'الترتيبان المتعاكسان يجب أن ينتجا جموداً تكشفه القاعدة. ERP: '.$erpErr.' | القديم: '.$legacyErr,
        );
    }

    // ───────── 1) حتمي: المسار الحقيقي ينتظر المِرساة بدل أن يمسك المجمّع قبلها ─────────

    #[Test]
    public function delivery_approval_waits_for_the_anchor_instead_of_holding_the_pool_first(): void
    {
        $w = $this->world();
        $delivery = $this->draftDelivery($w, 'lo2-det-recv');
        $this->assertWaitsBehindErpWithoutDeadlock($w, fn () => app(FuelSupplyReceivingService::class)->approveDelivery(FuelDelivery::findOrFail($delivery->id), $w['actor']->id), 'اعتماد الاستلام');
        $this->assertSame('approved', DB::table('fuel_deliveries')->where('id', $delivery->id)->value('status'));
    }

    #[Test]
    public function reconciliation_approval_waits_for_the_anchor_instead_of_holding_the_pool_first(): void
    {
        $w = $this->world();
        $draft = $this->draftReconciliation($w, 'det');
        $this->assertWaitsBehindErpWithoutDeadlock($w, fn () => app(FuelReconciliationService::class)->approve(FuelReconciliation::findOrFail($draft->id), $w['actor']->id, 'اعتماد'), 'اعتماد تسوية الخزان');
        $this->assertSame('approved', DB::table('fuel_reconciliations')->where('id', $draft->id)->value('status'));
    }

    /** مجمّع جديد فارغ (الافتتاحي يشترط مجمّعاً فارغاً) ومسودة افتتاحي جاهزة للترحيل، مع تهيئة حالات التكلفة الصفرية. @param array<string,mixed> $w @return array{0:array<string,mixed>,1:\App\Models\FuelOpeningBalance} */
    private function freshOpeningDocument(array $w, string $suffix): array
    {
        $warehouse = \App\Models\Warehouse::create(['name' => "مخزن افتتاحي {$suffix}", 'code' => "LO2-NEW-{$suffix}-".$w['slug'], 'branch_id' => $w['branch']->id]);
        $station = \App\Models\FuelStation::create(['branch_id' => $w['branch']->id, 'warehouse_id' => $warehouse->id, 'code' => "LO2-S-{$suffix}-".$w['slug'], 'name' => "محطة افتتاحي {$suffix}"]);
        $tanks = [];
        foreach ($w['fuels'] as $key => $fuel) {
            $tanks[$key] = \App\Models\FuelTank::create([
                'branch_id' => $w['branch']->id, 'fuel_station_id' => $station->id, 'fuel_product_id' => $fuel->id,
                'code' => "LO2-T-{$suffix}-{$key}-".$w['slug'], 'name' => "خزان {$key}", 'capacity_milliliters' => 34_000_000, 'safe_capacity_milliliters' => 33_000_000,
            ]);
        }
        $fresh = array_replace($w, ['warehouse' => $warehouse, 'station' => $station, 'tanks' => $tanks]);
        $doc = app(FuelOpeningBalanceService::class)->createDraft($this->openingPayload($fresh), $w['actor'])['document'];
        foreach ($w['fuels'] as $fuel) {
            app(FuelCostBasisService::class)->assertReady($fuel, $warehouse);
        }

        return [$fresh, $doc];
    }

    #[Test]
    public function opening_balance_posting_waits_for_the_anchor_instead_of_holding_the_pool_first(): void
    {
        $w = $this->world();
        [$fresh, $doc] = $this->freshOpeningDocument($w, 'a');
        $this->assertWaitsBehindErpWithoutDeadlock($fresh, fn () => app(FuelOpeningBalanceService::class)->post(\App\Models\FuelOpeningBalance::findOrFail($doc->id), $w['actor']), 'ترحيل الرصيد الافتتاحي');
        $this->assertSame('posted', DB::table('fuel_opening_balances')->where('id', $doc->id)->value('status'));
    }

    // ───────── 1b) تسجيل قراءة خزان (خزان ← KEY SHARE على المستأجر) مقابل المسارات الثلاثة ─────────

    /** ترتيب `recordReading`: الخزان FOR UPDATE ثم إدراج قراءة يحتاج KEY SHARE على صف المستأجر (FK). @param array<string,mixed> $w */
    private function readingOrderSql(array $w, string $tankId, float $sleep = 1.5): string
    {
        return sprintf(
            "BEGIN; SELECT 1 FROM fuel_tanks WHERE id='%s' FOR UPDATE; SELECT pg_sleep(%s); SELECT 1 FROM tenants WHERE id='%s' FOR KEY SHARE; COMMIT;",
            $tankId, $sleep, $w['tenant_id'],
        );
    }

    /** يشغّل $operation بينما جلسة بترتيب recordReading تمسك الخزان ثم تطلب KEY SHARE على المستأجر: لا جمود على أي من الطرفين. */
    private function assertNoDeadlockWithReadingOrder(array $w, string $tankId, callable $operation, string $label): void
    {
        $holder = $this->startHolder($this->readingOrderSql($w, $tankId));
        usleep(500000);
        $error = null;
        try {
            $operation();
        } catch (\Throwable $e) {
            $error = $e;
        }
        [$stderr, $exit] = $this->finishHolder($holder);
        $this->assertStringNotContainsString('deadlock', $stderr, "{$label}: جلسة القراءة ضحية جمود — {$stderr}");
        $this->assertSame(0, $exit, "{$label}: {$stderr}");
        $this->assertNull($error, "{$label}: ".($error ? get_class($error).': '.$error->getMessage() : ''));
    }

    #[Test]
    public function opening_balance_posting_never_deadlocks_with_a_tank_reading_on_one_of_its_tanks(): void
    {
        $w = $this->world();
        [$fresh, $doc] = $this->freshOpeningDocument($w, 'r');
        $this->assertNoDeadlockWithReadingOrder($fresh, $fresh['tanks']['91']->id, fn () => app(FuelOpeningBalanceService::class)->post(\App\Models\FuelOpeningBalance::findOrFail($doc->id), $w['actor']), 'ترحيل الافتتاحي ↔ قراءة خزان');
        $this->assertSame('posted', DB::table('fuel_opening_balances')->where('id', $doc->id)->value('status'));
    }

    #[Test]
    public function delivery_and_reconciliation_approvals_never_deadlock_with_a_tank_reading(): void
    {
        $w = $this->world();
        $delivery = $this->draftDelivery($w, 'lo2-read-recv');
        $this->assertNoDeadlockWithReadingOrder($w, $w['tanks']['91']->id, fn () => app(FuelSupplyReceivingService::class)->approveDelivery(FuelDelivery::findOrFail($delivery->id), $w['actor']->id), 'اعتماد الاستلام ↔ قراءة خزان');
        $draft = $this->draftReconciliation($w, 'read');
        $this->assertNoDeadlockWithReadingOrder($w, $w['tanks']['91']->id, fn () => app(FuelReconciliationService::class)->approve(FuelReconciliation::findOrFail($draft->id), $w['actor']->id, 'اعتماد'), 'اعتماد التسوية ↔ قراءة خزان');
    }

    /** ترتيب تعديل بطاقة المنتج: صف المنتج FOR UPDATE ثم إدراج نشاط يحتاج KEY SHARE على المستأجر (FK). @param array<string,mixed> $w */
    private function productUpdateOrderSql(array $w, string $productId, float $sleep = 1.5): string
    {
        return sprintf(
            "BEGIN; SELECT 1 FROM products WHERE id='%s' FOR UPDATE; SELECT pg_sleep(%s); SELECT 1 FROM tenants WHERE id='%s' FOR KEY SHARE; COMMIT;",
            $productId, $sleep, $w['tenant_id'],
        );
    }

    #[Test]
    public function approvals_and_opening_never_deadlock_with_a_product_card_update(): void
    {
        $w = $this->world();
        $productId = (string) $w['fuels']['91']->product_id;
        $run = function (callable $operation, string $label) use ($w, $productId): void {
            $holder = $this->startHolder($this->productUpdateOrderSql($w, $productId));
            usleep(500000);
            $error = null;
            try {
                $operation();
            } catch (\Throwable $e) {
                $error = $e;
            }
            [$stderr, $exit] = $this->finishHolder($holder);
            $this->assertStringNotContainsString('deadlock', $stderr, "{$label}: جلسة تعديل المنتج ضحية جمود — {$stderr}");
            $this->assertSame(0, $exit, "{$label}: {$stderr}");
            $this->assertNull($error, "{$label}: ".($error ? get_class($error).': '.$error->getMessage() : ''));
        };

        $draft = $this->draftReconciliation($w, 'prod');
        $run(fn () => app(FuelReconciliationService::class)->approve(FuelReconciliation::findOrFail($draft->id), $w['actor']->id, 'اعتماد'), 'اعتماد التسوية ↔ تعديل بطاقة المنتج');
        $delivery = $this->draftDelivery($w, 'lo2-prod-recv');
        $run(fn () => app(FuelSupplyReceivingService::class)->approveDelivery(FuelDelivery::findOrFail($delivery->id), $w['actor']->id), 'اعتماد الاستلام ↔ تعديل بطاقة المنتج');
        [$fresh, $doc] = $this->freshOpeningDocument($w, 'p');
        $run(fn () => app(FuelOpeningBalanceService::class)->post(\App\Models\FuelOpeningBalance::findOrFail($doc->id), $w['actor']), 'ترحيل الافتتاحي ↔ تعديل بطاقة المنتج');
    }

    // ───────── 1c) بيع ERP يمسك المِرساة ثم يحتاج KEY SHARE على صف المنتج (إدراج حركة المخزون، FK) ─────────

    /** ذيل ترتيب ERP الحقيقي: مِرساة المستأجر FOR UPDATE ← (نوم) ← KEY SHARE على صف المنتج. @param array<string,mixed> $w */
    private function erpProductKeyShareSql(array $w, string $productId, float $sleep = 1.5): string
    {
        return sprintf(
            "BEGIN; SELECT 1 FROM tenants WHERE id='%s' FOR UPDATE; SELECT pg_sleep(%s); SELECT 1 FROM products WHERE id='%s' FOR KEY SHARE; COMMIT;",
            $w['tenant_id'], $sleep, $productId,
        );
    }

    /** @param array<string,mixed> $w */
    private function assertNoDeadlockWithErpProductKeyShare(array $w, callable $operation, string $label): void
    {
        $holder = $this->startHolder($this->erpProductKeyShareSql($w, (string) $w['fuels']['91']->product_id));
        usleep(500000);
        $error = null;
        try {
            $operation();
        } catch (\Throwable $e) {
            $error = $e;
        }
        [$stderr, $exit] = $this->finishHolder($holder);
        $this->assertStringNotContainsString('deadlock', $stderr, "{$label}: جلسة ERP ضحية جمود — {$stderr}");
        $this->assertSame(0, $exit, "{$label}: {$stderr}");
        $this->assertNull($error, "{$label}: ".($error ? get_class($error).': '.$error->getMessage() : ''));
    }

    #[Test]
    public function reconciliation_approval_never_deadlocks_with_an_erp_sale_that_holds_the_anchor_and_needs_the_product(): void
    {
        $w = $this->world();
        $draft = $this->draftReconciliation($w, 'erpprod');
        $this->assertNoDeadlockWithErpProductKeyShare($w, fn () => app(FuelReconciliationService::class)->approve(FuelReconciliation::findOrFail($draft->id), $w['actor']->id, 'اعتماد'), 'اعتماد التسوية ↔ بيع ERP');
    }

    #[Test]
    public function opening_balance_posting_never_deadlocks_with_an_erp_sale_that_holds_the_anchor_and_needs_the_product(): void
    {
        $w = $this->world();
        [$fresh, $doc] = $this->freshOpeningDocument($w, 'e');
        $this->assertNoDeadlockWithErpProductKeyShare($w, fn () => app(FuelOpeningBalanceService::class)->post(\App\Models\FuelOpeningBalance::findOrFail($doc->id), $w['actor']), 'ترحيل الافتتاحي ↔ بيع ERP');
    }

    #[Test]
    public function delivery_approval_never_deadlocks_with_an_erp_sale_that_holds_the_anchor_and_needs_the_product(): void
    {
        $w = $this->world();
        $delivery = $this->draftDelivery($w, 'lo2-erpprod-recv');
        $this->assertNoDeadlockWithErpProductKeyShare($w, fn () => app(FuelSupplyReceivingService::class)->approveDelivery(FuelDelivery::findOrFail($delivery->id), $w['actor']->id), 'اعتماد الاستلام ↔ بيع ERP');
    }

    #[Test]
    public function real_tank_readings_racing_opening_postings_never_deadlock(): void
    {
        $w = $this->world();
        for ($round = 1; $round <= 6; $round++) {
            [$fresh, $doc] = $this->freshOpeningDocument($w, "x{$round}");
            $jobs = [
                fn () => $this->attempt($fresh, fn () => app(FuelOpeningBalanceService::class)->post(\App\Models\FuelOpeningBalance::findOrFail($doc->id), User::findOrFail($w['actor']->id))['replayed'] ? 'replayed' : 'posted'),
            ];
            foreach (range(1, 4) as $i) {
                $jobs[] = fn () => $this->attempt($fresh, fn () => app(FuelReconciliationService::class)->recordReading([
                    'fuel_station_id' => $fresh['station']->id, 'fuel_tank_id' => $fresh['tanks']['91']->id, 'reading_type' => 'physical',
                    'quantity_liters' => '100.000', 'evidence_key' => "lo2-race-read-{$round}-{$i}", 'recorded_by' => $w['actor']->id,
                ])->id);
            }
            if ($round % 2 === 0) {
                $jobs = array_reverse($jobs);
            }
            $results = $this->runConcurrently($jobs);
            $this->assertAllCompleted($results);
            $this->assertSame('posted', DB::table('fuel_opening_balances')->where('id', $doc->id)->value('status'), "جولة {$round}: ".json_encode($results));
            $this->assertSame(4, (int) DB::table('fuel_tank_readings')->where('fuel_tank_id', $fresh['tanks']['91']->id)->count(), "جولة {$round}: كل القراءات سُجّلت");
        }
    }

    // ───────── 2) تزاحم فعلي بالكود الحقيقي ─────────

    #[Test]
    public function real_erp_finalize_racing_delivery_and_reconciliation_approvals_on_one_pool_never_deadlocks(): void
    {
        $w = $this->world();
        $rounds = 8;
        $ledgerBefore = (int) DB::table('journal_entries')->where('tenant_id', $w['tenant_id'])->count();

        for ($round = 1; $round <= $rounds; $round++) {
            $sale = $this->draftSale($w, "lo2-race-sale-{$round}");
            $delivery = $this->draftDelivery($w, "lo2-race-recv-{$round}");
            $draft = $this->draftReconciliation($w, "race-{$round}");

            $jobs = [
                fn () => $this->attempt($w, fn () => app(FuelSaleService::class)->finalize(FuelSale::findOrFail($sale->id), User::findOrFail($w['actor']->id))->status),
                fn () => $this->attempt($w, fn () => app(FuelSupplyReceivingService::class)->approveDelivery(FuelDelivery::findOrFail($delivery->id), $w['actor']->id)->status),
                fn () => $this->attempt($w, fn () => app(FuelReconciliationService::class)->approve(FuelReconciliation::findOrFail($draft->id), $w['actor']->id, 'اعتماد')->status),
            ];
            if ($round % 2 === 0) {
                $jobs = array_reverse($jobs);
            }
            $results = $this->runConcurrently($jobs);
            $this->assertAllCompleted($results);
            $this->assertSame('finalized', DB::table('fuel_sales')->where('id', $sale->id)->value('status'), "جولة {$round}: ".json_encode($results));
            $this->assertSame('approved', DB::table('fuel_deliveries')->where('id', $delivery->id)->value('status'), "جولة {$round}");
            $this->assertSame('approved', DB::table('fuel_reconciliations')->where('id', $draft->id)->value('status'), "جولة {$round}");
        }

        // اتساق ثابت: الدفتر التشغيلي = الرصيد الرسمي = كمية حالة التكلفة للمجمّع، وقيد واحد على الأقل لكل عملية (لا فقد ولا تكرار).
        $warehouseId = $w['warehouse']->id;
        $stock = (int) DB::table('product_warehouse_stock')->where('warehouse_id', $warehouseId)->where('product_id', $w['fuels']['91']->product_id)->value('quantity');
        $cost = (int) DB::table('fuel_inventory_cost_states')->where('warehouse_id', $warehouseId)->where('fuel_product_id', $w['fuels']['91']->id)->value('quantity_milliliters');
        $ledger = (int) DB::table('fuel_operational_ledgers')->where('warehouse_id', $warehouseId)->where('fuel_product_id', $w['fuels']['91']->id)->sum('quantity_milliliters');
        $this->assertSame($stock, $cost, 'حالة التكلفة = الرصيد الرسمي');
        $this->assertSame($stock, $ledger, 'الدفتر التشغيلي = الرصيد الرسمي');
        $this->assertGreaterThanOrEqual($ledgerBefore + 3 * $rounds, (int) DB::table('journal_entries')->where('tenant_id', $w['tenant_id'])->count());
    }

    // ───────── أدوات التزاحم ─────────

    /** @param array<string,mixed> $w */
    private function attempt(array $w, callable $work): mixed
    {
        $this->enter($w);
        try {
            return $work();
        } catch (\PDOException $e) {
            throw $e;
        } catch (\Illuminate\Database\QueryException $e) {
            throw $e;
        } catch (\RuntimeException $e) {
            return 'rejected: '.$e->getMessage();
        }
    }

    private function assertAllCompleted(array $results): void
    {
        foreach ($results as $i => $result) {
            $this->assertTrue($result['ok'] ?? false, "العملية {$i}: ".($result['error_class'] ?? '').' '.($result['message'] ?? ''));
            $message = (string) ($result['message'] ?? '');
            $this->assertFalse(str_contains($message, '40P01') || stripos($message, 'deadlock') !== false, "جمود في العملية {$i}");
        }
    }

    /** @param list<callable> $jobs @return array<int, array<string, mixed>> */
    private function runConcurrently(array $jobs): array
    {
        $barrier = $this->dir.'/barrier_'.uniqid();
        $resultFiles = [];
        $pids = [];
        foreach ($jobs as $i => $job) {
            $resultFiles[$i] = $this->dir.'/result_'.uniqid()."_{$i}";
            $pid = pcntl_fork();
            if ($pid === -1) {
                $this->fail('فشل pcntl_fork.');
            }
            if ($pid === 0) {
                DB::purge(config('database.default'));
                $deadline = microtime(true) + 10.0;
                while (! file_exists($barrier) && microtime(true) < $deadline) {
                    usleep(500);
                }
                try {
                    file_put_contents($resultFiles[$i], json_encode(['ok' => true, 'value' => $job()]));
                } catch (\Throwable $e) {
                    file_put_contents($resultFiles[$i], json_encode(['ok' => false, 'error_class' => get_class($e), 'message' => $e->getMessage()]));
                }
                exit(0);
            }
            $pids[] = $pid;
        }
        touch($barrier);
        foreach ($pids as $pid) {
            pcntl_waitpid($pid, $status);
        }
        DB::purge(config('database.default'));
        $out = [];
        foreach ($resultFiles as $i => $file) {
            $raw = is_file($file) ? file_get_contents($file) : false;
            $out[$i] = json_decode($raw !== false ? $raw : '{"ok":false,"message":"no output"}', true);
        }

        return $out;
    }
}
