<?php

namespace Tests\Feature;

use App\Models\FuelInventoryCostMovement;
use App\Models\FuelNozzle;
use App\Models\FuelOperationalLedger;
use App\Models\FuelPump;
use App\Models\FuelShift;
use App\Models\FuelTanker;
use App\Models\FuelTankerFill;
use App\Models\FuelTankerFillInventoryPosting;
use App\Models\FuelTankerFillInventoryPostingAttempt;
use App\Models\FuelTankerOwner;
use App\Models\StockMovement;
use App\Models\User;
use App\Services\FuelTankerFillException;
use App\Services\FuelTankerFillService;
use App\Tenancy\TenantContext;
use Illuminate\Database\QueryException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use LogicException;
use RuntimeException;
use Tests\TestCase;

/**
 * TANKER-PR6B-2 — تجهيز قاعدة البيانات لانتقال السند `pending_integration → posted → reversed` مستقبلاً **دون أن يكتب أي مسار هذه الحالات الآن**.
 *
 * الإدراجات المباشرة في `fuel_tanker_fill_inventory_postings` هنا **تحاكي الكاتب المستقبلي (PR-6B-3) لإثبات حراس القاعدة فقط** — لا خدمة تفعل ذلك في التطبيق (يثبته اختبار ساكن
 * أدناه). لا خصم مخزون ولا قيد ولا مجمّع تكلفة في أي مسار من مسارات التطبيق المُختبَرة.
 */
class FuelTankerFillPostingStateTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;
    use BuildsFuelStaffFixture;

    private const FILLS = '/api/fuel-stations/tanker-fills';
    private const M_GUARDS = 'database/migrations/2027_01_28_010000_add_fuel_tanker_fill_posting_state_guards.php';
    private const M_ATTEMPTS = 'database/migrations/2027_01_29_010000_create_fuel_tanker_fill_inventory_posting_attempts.php';

    private FuelNozzle $nozzle;
    private FuelTankerOwner $owner;
    private FuelShift $shift;
    private int $seq = 0;

    protected function setUp(): void
    {
        parent::setUp();
        config(['fuel_stations.tanker_management_enabled' => true, 'fuel_stations.tanker_fills_enabled' => true]);
        $this->buildFixture();
        app(TenantContext::class)->set($this->tenantId);
        $pump = FuelPump::create(['branch_id' => $this->fx['branchA']->id, 'fuel_station_id' => $this->fx['s1']->id, 'pump_number' => '02', 'name' => 'مضخة 2']);
        $this->nozzle = FuelNozzle::create([
            'branch_id' => $this->fx['branchA']->id, 'fuel_station_id' => $this->fx['s1']->id, 'fuel_pump_id' => $pump->id, 'fuel_tank_id' => $this->fx['t1']->id,
            'fuel_product_id' => $this->fx['fuel']->id, 'nozzle_number' => '1',
        ]);
        $this->owner = FuelTankerOwner::create(['name' => 'عسكر', 'code' => 'ASK', 'status' => 'active']);
        $this->shift = FuelShift::create([
            'branch_id' => $this->fx['branchA']->id, 'fuel_station_id' => $this->fx['s1']->id, 'number' => 'FSH-T62-1', 'status' => FuelShift::STATUS_OPEN,
            'opening_float_minor' => 0, 'idempotency_key' => 'shift-t62-1', 'opened_by' => $this->makeUser('seller-t62', 'role-seller-t62', ['fuel_stations.view'])['user']->id, 'opened_at' => now(),
        ]);
    }

    // ───────────────────────── أدوات ─────────────────────────

    private function caught(callable $operation): ?\Throwable
    {
        try {
            DB::transaction($operation); // نقطة حفظ: فشل القيد داخل معاملة PostgreSQL لا يفسد بقية الاختبار
        } catch (\Throwable $e) {
            return $e;
        }

        return null;
    }

    private function assertDbRejects(callable $operation, string $message = ''): void
    {
        $this->assertInstanceOf(QueryException::class, $this->caught($operation), $message);
    }

    private function fill(int $milliliters = 1_000_000): FuelTankerFill
    {
        $n = ++$this->seq;
        $response = $this->withToken($this->fx['owner'])->postJson(self::FILLS, [
            'fuel_station_id' => $this->fx['s1']->id, 'fuel_nozzle_id' => $this->nozzle->id, 'fuel_tanker_owner_id' => $this->owner->id,
            'voucher_number' => "V{$n}", 'quantity_milliliters' => $milliliters, 'idempotency_key' => "fill-t62-{$n}",
        ])->assertCreated();

        return FuelTankerFill::query()->findOrFail($response->json('data.id'));
    }

    private function stockMovement(int $quantity, string $type = 'out'): StockMovement
    {
        return StockMovement::create([
            'product_id' => $this->fx['fuel']->product_id, 'warehouse_id' => $this->fx['wA1']->id, 'branch_id' => $this->fx['branchA']->id,
            'type' => $type, 'quantity' => $quantity, 'unit_cost' => 0, 'total_cost' => 0, 'balance_quantity' => 0, 'movement_date' => now()->toDateString(),
        ]);
    }

    private function costMovement(StockMovement $stock, int $quantity, int $cost, string $type = 'issue'): FuelInventoryCostMovement
    {
        return FuelInventoryCostMovement::create([
            'warehouse_id' => $this->fx['wA1']->id, 'fuel_product_id' => $this->fx['fuel']->id, 'stock_movement_id' => $stock->id, 'movement_type' => $type,
            'quantity_milliliters' => $quantity, 'posted_cost_minor' => $cost, 'cost_pool_minor_before' => 0, 'cost_numerator_before' => '0', 'cost_denominator_before' => '1',
            'quantity_milliliters_before' => 0, 'carry_remainder_numerator_before' => '0', 'carry_remainder_denominator_before' => '1', 'cost_pool_minor_after' => 0,
            'cost_numerator_after' => '0', 'cost_denominator_after' => '1', 'quantity_milliliters_after' => 0, 'carry_remainder_numerator_after' => '0',
            'carry_remainder_denominator_after' => '1', 'occurred_at' => now(),
        ]);
    }

    /** @return array<string, mixed> صف ترحيل صالح لسند (يحاكي الكاتب المستقبلي لإثبات الحراس). */
    private function postingRow(FuelTankerFill $fill, string $key = 'post-1', int $cost = 500): array
    {
        $stock = $this->stockMovement((int) $fill->quantity_milliliters);
        $costMovement = $this->costMovement($stock, (int) $fill->quantity_milliliters, $cost);

        return [
            'id' => (string) Str::uuid(), 'tenant_id' => $this->tenantId, 'branch_id' => $this->fx['branchA']->id, 'fuel_tanker_fill_id' => $fill->id,
            'fuel_station_id' => $fill->fuel_station_id, 'fuel_product_id' => $fill->fuel_product_id, 'warehouse_id' => $this->fx['wA1']->id,
            'stock_movement_id' => $stock->id, 'cost_movement_id' => $costMovement->id, 'quantity_milliliters' => $fill->quantity_milliliters, 'posted_cost_minor' => $cost,
            'idempotency_key' => $key, 'status' => 'posted', 'posted_by' => User::query()->firstOrFail()->id,
            'posted_at' => now(), 'created_at' => now(), 'updated_at' => now(),
        ];
    }

    /** @return array<string, mixed> أعمدة عكس صالحة لترحيل. */
    private function reversalColumns(array $posting, ?StockMovement $stock = null, ?FuelInventoryCostMovement $cost = null): array
    {
        $stock ??= $this->stockMovement((int) $posting['quantity_milliliters'], 'in');
        $cost ??= $this->costMovement($stock, (int) $posting['quantity_milliliters'], (int) $posting['posted_cost_minor'], 'receipt');

        return [
            'status' => 'reversed', 'reversal_stock_movement_id' => $stock->id, 'reversal_cost_movement_id' => $cost->id,
            'reversed_by' => $posting['posted_by'], 'reversed_at' => now(), 'reversal_reason' => 'إلغاء السند',
        ];
    }

    private function insertPosting(array $row): void
    {
        DB::table('fuel_tanker_fill_inventory_postings')->insert($row);
    }

    private function inventoryStatus(FuelTankerFill $fill): string
    {
        return (string) DB::table('fuel_tanker_fills')->where('id', $fill->id)->value('inventory_status');
    }

    private function fillStatus(FuelTankerFill $fill): string
    {
        return (string) DB::table('fuel_tanker_fills')->where('id', $fill->id)->value('status');
    }

    private function setInventory(FuelTankerFill $fill, string $status): void
    {
        DB::table('fuel_tanker_fills')->where('id', $fill->id)->update(['inventory_status' => $status]);
    }

    /** @return array<string,int> */
    private function effects(): array
    {
        return [
            'stock_movements' => DB::table('stock_movements')->count(), 'cost_movements' => DB::table('fuel_inventory_cost_movements')->count(),
            'cost_states' => DB::table('fuel_inventory_cost_states')->count(), 'journal_entries' => DB::table('journal_entries')->count(),
            'journal_lines' => DB::table('journal_lines')->count(), 'ledger' => DB::table('fuel_operational_ledgers')->count(),
            'warehouse_stock' => (int) DB::table('product_warehouse_stock')->sum('quantity'), 'invoices' => DB::table('invoices')->count(),
            'postings' => DB::table('fuel_tanker_fill_inventory_postings')->count(), 'attempts' => DB::table('fuel_tanker_fill_inventory_posting_attempts')->count(),
        ];
    }

    // ───────────────────────── الانتقالات ─────────────────────────

    /** @test */
    public function a_new_fill_is_pending_and_a_valid_posting_then_reversal_move_it_posted_then_reversed_inside_the_database(): void
    {
        $fill = $this->fill();
        $this->assertSame('pending_integration', $this->inventoryStatus($fill));

        $row = $this->postingRow($fill);
        $this->insertPosting($row);
        $this->assertSame('posted', $this->inventoryStatus($fill), 'الحالة تتبع جدول الترحيل بمُشغّل متزامن لا بكتابة تطبيقية');

        DB::table('fuel_tanker_fill_inventory_postings')->where('id', $row['id'])->update($this->reversalColumns($row));
        $this->assertSame('reversed', $this->inventoryStatus($fill));
        $this->assertSame('recorded', $this->fillStatus($fill), 'العكس لا يُلغي السند (عمليتان منفصلتان)');
    }

    /** @test */
    public function illegal_inventory_transitions_are_rejected_for_every_path_and_skipping_or_returning_is_impossible(): void
    {
        $fill = $this->fill();

        // بلا ترحيل: لا posted ولا reversed (لا قفز) ولا قيمة مجهولة.
        foreach (['posted', 'reversed', 'bogus', ''] as $target) {
            $this->assertDbRejects(fn () => $this->setInventory($fill, $target), "pending → {$target} بلا ترحيل");
        }
        $this->assertSame('pending_integration', $this->inventoryStatus($fill));

        $row = $this->postingRow($fill);
        $this->insertPosting($row);
        // مرحَّل: لا رجوع إلى الأسبق ولا قفز إلى reversed بلا عكس فعلي في جدول الترحيل.
        foreach (['pending_integration', 'reversed', 'bogus'] as $target) {
            $this->assertDbRejects(fn () => $this->setInventory($fill, $target), "posted → {$target}");
        }
        $this->assertSame('posted', $this->inventoryStatus($fill));

        DB::table('fuel_tanker_fill_inventory_postings')->where('id', $row['id'])->update($this->reversalColumns($row));
        // معكوس: لا رجوع ولا إعادة ترحيل.
        foreach (['pending_integration', 'posted', 'bogus'] as $target) {
            $this->assertDbRejects(fn () => $this->setInventory($fill, $target), "reversed → {$target}");
        }
        $this->assertSame('reversed', $this->inventoryStatus($fill));
    }

    /** @test */
    public function a_fill_cannot_be_created_directly_in_a_posted_or_reversed_state(): void
    {
        $fill = $this->fill();
        $copy = (array) DB::table('fuel_tanker_fills')->where('id', $fill->id)->first();
        foreach (['posted', 'reversed'] as $state) {
            $row = array_merge($copy, ['id' => (string) Str::uuid(), 'number' => 'FTF-X-' . $state, 'voucher_key' => 'k-' . $state, 'voucher_number' => 'X-' . $state, 'idempotency_key' => 'x-' . $state, 'inventory_status' => $state]);
            $this->assertDbRejects(fn () => DB::table('fuel_tanker_fills')->insert($row), "إنشاء مباشر بحالة {$state}");
        }
    }

    // ───────────────────────── ربط الترحيل والحركات ─────────────────────────

    /** @test */
    public function a_posting_is_rejected_unless_it_matches_the_fill_and_its_official_movements(): void
    {
        $fill = $this->fill(1_000_000);
        $good = $this->postingRow($fill, 'good');

        $stockIn = $this->stockMovement(1_000_000, 'in');
        $stockOtherQty = $this->stockMovement(999_999);
        $costOtherQty = $this->costMovement($stockOtherQty, 999_999, 500);
        $stockOther = $this->stockMovement(1_000_000);
        $costWrongCost = $this->costMovement($stockOther, 1_000_000, 777);
        $stockA = $this->stockMovement(1_000_000);
        $stockB = $this->stockMovement(1_000_000);
        $costOfB = $this->costMovement($stockB, 1_000_000, 500);
        $stockR = $this->stockMovement(1_000_000);
        $costReceipt = $this->costMovement($stockR, 1_000_000, 500, 'receipt');

        $cases = [
            'حركة مخزون غير out' => array_merge($good, ['id' => (string) Str::uuid(), 'idempotency_key' => 'c1', 'stock_movement_id' => $stockIn->id, 'cost_movement_id' => $this->costMovement($stockIn, 1_000_000, 500)->id]),
            'كمية الحركة تخالف السند' => array_merge($good, ['id' => (string) Str::uuid(), 'idempotency_key' => 'c2', 'stock_movement_id' => $stockOtherQty->id, 'cost_movement_id' => $costOtherQty->id]),
            'تكلفة الحركة تخالف التكلفة التاريخية' => array_merge($good, ['id' => (string) Str::uuid(), 'idempotency_key' => 'c3', 'stock_movement_id' => $stockOther->id, 'cost_movement_id' => $costWrongCost->id]),
            'حركة تكلفة لحركة مخزون أخرى' => array_merge($good, ['id' => (string) Str::uuid(), 'idempotency_key' => 'c4', 'stock_movement_id' => $stockA->id, 'cost_movement_id' => $costOfB->id]),
            'حركة تكلفة ليست issue' => array_merge($good, ['id' => (string) Str::uuid(), 'idempotency_key' => 'c5', 'stock_movement_id' => $stockR->id, 'cost_movement_id' => $costReceipt->id]),
            'مخزن غير مخزن المحطة' => array_merge($good, ['id' => (string) Str::uuid(), 'idempotency_key' => 'c6', 'warehouse_id' => $this->fx['wA2']->id]),
            'محطة مخالفة' => array_merge($good, ['id' => (string) Str::uuid(), 'idempotency_key' => 'c7', 'fuel_station_id' => $this->fx['s2']->id]),
            'فرع مخالف' => array_merge($good, ['id' => (string) Str::uuid(), 'idempotency_key' => 'c8', 'branch_id' => $this->fx['branchB']->id]),
            'تكلفة سالبة' => array_merge($good, ['id' => (string) Str::uuid(), 'idempotency_key' => 'c9', 'posted_cost_minor' => -1]),
        ];
        foreach ($cases as $label => $row) {
            $this->assertDbRejects(fn () => $this->insertPosting($row), $label);
        }
        $this->assertSame(0, DB::table('fuel_tanker_fill_inventory_postings')->count());
        $this->assertSame('pending_integration', $this->inventoryStatus($fill));

        $this->insertPosting($good); // الصف الصالح يمرّ
        $this->assertSame(1, DB::table('fuel_tanker_fill_inventory_postings')->count());
    }

    /** @test */
    public function a_voided_fill_and_another_tenants_fill_cannot_be_posted(): void
    {
        $voided = $this->fill(200_000);
        $this->withToken($this->fx['owner'])->postJson(self::FILLS . "/{$voided->id}/void", ['reason' => 'خطأ'])->assertOk();
        $this->assertDbRejects(fn () => $this->insertPosting($this->postingRow($voided->fresh(), 'voided')));

        $fill = $this->fill(300_000);
        $other = $this->registerTenant('fuel-t62-other', 'owner@fuel-t62-other.test', autoEnableApplications: true);
        $row = array_merge($this->postingRow($fill, 'iso'), ['tenant_id' => $other['tenant_id']]);
        $this->assertDbRejects(fn () => $this->insertPosting($row), 'مؤسسة أخرى لا تُرحِّل سنداً ليس لها');
        $this->assertSame('pending_integration', $this->inventoryStatus($fill));
    }

    /** @test */
    public function a_reversal_must_restore_the_same_quantity_and_historical_cost_with_distinct_unused_movements(): void
    {
        $fill = $this->fill(1_000_000);
        $row = $this->postingRow($fill);
        $this->insertPosting($row);
        $table = fn () => DB::table('fuel_tanker_fill_inventory_postings')->where('id', $row['id']);

        $wrongQty = $this->stockMovement(999_999, 'in');
        $wrongCost = $this->stockMovement(1_000_000, 'in');
        $out = $this->stockMovement(1_000_000, 'out');
        $good = $this->stockMovement(1_000_000, 'in');
        $goodCost = $this->costMovement($good, 1_000_000, 500, 'receipt');

        $bad = [
            'كمية العكس تخالف' => $this->reversalColumns($row, $wrongQty, $this->costMovement($wrongQty, 999_999, 500, 'receipt')),
            'تكلفة العكس تخالف الأصلية (لا إعادة تسعير)' => $this->reversalColumns($row, $wrongCost, $this->costMovement($wrongCost, 1_000_000, 900, 'receipt')),
            'حركة عكس out' => $this->reversalColumns($row, $out, $this->costMovement($out, 1_000_000, 500, 'receipt')),
            'حركة عكس هي حركة الترحيل نفسها' => $this->reversalColumns($row, StockMovement::query()->findOrFail($row['stock_movement_id']), FuelInventoryCostMovement::query()->findOrFail($row['cost_movement_id'])),
            'حركة تكلفة عكس لا تتبع حركة المخزون' => array_merge($this->reversalColumns($row, $good, $goodCost), ['reversal_cost_movement_id' => $row['cost_movement_id']]),
            'أعمدة عكس ناقصة' => ['status' => 'reversed'],
            'سبب العكس مفقود' => array_merge($this->reversalColumns($row, $good, $goodCost), ['reversal_reason' => null]),
        ];
        foreach ($bad as $label => $columns) {
            $this->assertDbRejects(fn () => $table()->update($columns), $label);
        }
        $this->assertSame('posted', (string) $table()->value('status'));
        $this->assertSame('posted', $this->inventoryStatus($fill));

        $table()->update($this->reversalColumns($row, $good, $goodCost));
        $this->assertSame('reversed', $this->inventoryStatus($fill));

        // حركة عكس ترحيلٍ لا تُنسب لترحيل ثانٍ (ولا تُستعمل حركة ترحيل ثانٍ كعكس).
        $second = $this->fill(1_000_000);
        $secondRow = $this->postingRow($second, 'second');
        $this->insertPosting($secondRow);
        $this->assertDbRejects(fn () => DB::table('fuel_tanker_fill_inventory_postings')->where('id', $secondRow['id'])->update($this->reversalColumns($secondRow, $good, $goodCost)), 'حركات العكس لا تُنسب لترحيلين');
        $this->assertDbRejects(fn () => DB::table('fuel_tanker_fill_inventory_postings')->where('id', $secondRow['id'])->update($this->reversalColumns(
            $secondRow,
            StockMovement::query()->findOrFail($row['stock_movement_id']),
            FuelInventoryCostMovement::query()->findOrFail($row['cost_movement_id']),
        )), 'حركات ترحيل آخر ليست عكساً');
    }

    /** @test */
    public function a_posting_quantity_above_the_stock_movement_integer_limit_is_impossible(): void
    {
        $limit = 2_147_483_648; // 2^31: أول قيمة تتجاوز integer 32 بت في stock_movements.quantity

        if (DB::connection()->getDriverName() === 'pgsql') {
            // على PostgreSQL حركة المخزون نفسها لا تقبل الكمية: السقف في الترحيل يمنع الوصول إلى الفيض أصلاً.
            $this->assertInstanceOf(QueryException::class, $this->caught(fn () => $this->stockMovement($limit)));
        }

        $fill = $this->fill($limit);
        if (DB::connection()->getDriverName() === 'pgsql') {
            return;
        }
        // SQLite: الحركتان تُنشآن (لا حدّ 32 بت) والسند مطابق، فالسقف وحده هو المانع.
        $row = $this->postingRow($fill);
        $this->assertDbRejects(fn () => $this->insertPosting($row), 'سقف الكمية 2^31-1');
        $this->assertSame('pending_integration', $this->inventoryStatus($fill));
    }

    // ───────────────────────── الإلغاء ─────────────────────────

    /** @test */
    public function a_posted_fill_cannot_be_voided_by_api_service_model_or_sql_and_reversal_then_void_stay_separate_operations(): void
    {
        $fill = $this->fill();
        $row = $this->postingRow($fill);
        $this->insertPosting($row);

        // API
        $response = $this->withToken($this->fx['owner'])->postJson(self::FILLS . "/{$fill->id}/void", ['reason' => 'محاولة']);
        $response->assertStatus(409);
        $this->assertSame(FuelTankerFillException::FILL_INVENTORY_POSTED, $response->json('reason'));
        // الخدمة
        $error = $this->caught(fn () => app(FuelTankerFillService::class)->void($fill->fresh(), 'محاولة', User::query()->where('role', 'owner')->firstOrFail()));
        $this->assertInstanceOf(FuelTankerFillException::class, $error);
        $this->assertSame(FuelTankerFillException::FILL_INVENTORY_POSTED, $error->reason);
        // النموذج
        $this->assertInstanceOf(LogicException::class, $this->caught(fn () => $fill->fresh()->forceFill(['status' => 'voided', 'voided_by' => $row['posted_by'], 'voided_at' => now(), 'void_reason' => 'x'])->save()));
        // SQL مباشر (القيد والمُشغّل)
        $this->assertDbRejects(fn () => DB::table('fuel_tanker_fills')->where('id', $fill->id)->update(['status' => 'voided', 'voided_by' => $row['posted_by'], 'voided_at' => now(), 'void_reason' => 'x']));
        $this->assertSame('recorded', $this->fillStatus($fill));

        // بعد العكس (عملية منفصلة) يصير الإلغاء ممكناً: المخزون عاد.
        DB::table('fuel_tanker_fill_inventory_postings')->where('id', $row['id'])->update($this->reversalColumns($row));
        $this->withToken($this->fx['owner'])->postJson(self::FILLS . "/{$fill->id}/void", ['reason' => 'بعد العكس'])->assertOk();
        $this->assertSame('voided', $this->fillStatus($fill));
        $this->assertSame('reversed', $this->inventoryStatus($fill));
        // والإلغاء المتكرر idempotent كما كان.
        $this->withToken($this->fx['owner'])->postJson(self::FILLS . "/{$fill->id}/void", ['reason' => 'مرة أخرى'])->assertOk();
    }

    /** @test */
    public function voiding_a_pending_fill_works_exactly_as_before_and_leaves_no_inventory_trace(): void
    {
        $before = $this->effects();
        $fill = $this->fill();
        $this->withToken($this->fx['owner'])->postJson(self::FILLS . "/{$fill->id}/void", ['reason' => 'خطأ إدخال'])->assertOk();
        $this->assertSame('voided', $this->fillStatus($fill));
        $this->assertSame('pending_integration', $this->inventoryStatus($fill));
        $this->assertSame($before, $this->effects(), 'تسجيل سند وإلغاؤه لا يكتب حركة ولا قيداً ولا ترحيلاً ولا محاولة');
    }

    // ───────────────────────── الدفتر التشغيلي ─────────────────────────

    /** @return array<string,mixed> */
    private function ledgerRow(FuelTankerFill $fill, array $posting, string $type, int $quantity, ?string $stockId): array
    {
        return [
            'tenant_id' => $this->tenantId, 'branch_id' => $this->fx['branchA']->id, 'fuel_station_id' => $fill->fuel_station_id, 'fuel_tank_id' => $fill->fuel_tank_id,
            'fuel_product_id' => $fill->fuel_product_id, 'warehouse_id' => $this->fx['wA1']->id, 'stock_movement_id' => $stockId, 'movement_type' => $type,
            'quantity_milliliters' => $quantity, 'book_balance_milliliters' => 0, 'idempotency_key' => 'ledger-' . Str::uuid(),
            'source_type' => FuelTankerFill::class, 'source_id' => $fill->id, 'occurred_at' => now(),
        ];
    }

    /** @test */
    public function the_existing_operational_ledger_accepts_the_two_tanker_types_only_against_a_matching_posting_once(): void
    {
        $this->assertSame('tanker_fill', FuelOperationalLedger::TYPE_TANKER_FILL);
        $this->assertSame('tanker_fill_reversal', FuelOperationalLedger::TYPE_TANKER_FILL_REVERSAL);
        $table = fn () => DB::table('fuel_operational_ledgers');

        $fill = $this->fill(1_000_000);
        $row = $this->postingRow($fill);
        $outRow = fn (array $over = []) => array_merge(['id' => (string) Str::uuid(), 'created_at' => now(), 'updated_at' => now()], $this->ledgerRow($fill, $row, 'tanker_fill', -1_000_000, $row['stock_movement_id']), $over);

        // بلا ترحيل ⇒ مرفوض (لا دفتر موازٍ ولا صف حرّ).
        $this->assertDbRejects(fn () => $table()->insert($outRow()), 'بلا ترحيل');
        $this->insertPosting($row);

        foreach ([
            'كمية موجبة' => ['quantity_milliliters' => 1_000_000],
            'كمية مخالفة' => ['quantity_milliliters' => -999_999],
            'حركة مخزون غير الترحيل' => ['stock_movement_id' => $this->stockMovement(1_000_000)->id],
            'مصدر غير السند' => ['source_type' => 'App\Models\FuelSale'],
            'خزان غير خزان السند' => ['fuel_tank_id' => $this->fx['t2']->id],
            'مخزن مخالف' => ['warehouse_id' => $this->fx['wA2']->id],
        ] as $label => $over) {
            $this->assertDbRejects(fn () => $table()->insert($outRow($over)), $label);
        }
        $table()->insert($outRow()); // الصف المطابق يمرّ
        $this->assertDbRejects(fn () => $table()->insert($outRow()), 'صف واحد فقط لكل (سند، نوع)');

        // العكس: يتطلب ترحيلاً معكوساً بحركة العكس نفسها وكمية موجبة.
        $reverse = fn (string $stockId, array $over = []) => array_merge(['id' => (string) Str::uuid(), 'created_at' => now(), 'updated_at' => now()], $this->ledgerRow($fill, $row, 'tanker_fill_reversal', 1_000_000, $stockId), $over);
        $reversal = $this->reversalColumns($row);
        $this->assertDbRejects(fn () => $table()->insert($reverse($reversal['reversal_stock_movement_id'])), 'الترحيل لم يُعكس بعد');
        DB::table('fuel_tanker_fill_inventory_postings')->where('id', $row['id'])->update($reversal);
        $this->assertDbRejects(fn () => $table()->insert($reverse($row['stock_movement_id'])), 'حركة الترحيل الأصلية ليست حركة العكس');
        $this->assertDbRejects(fn () => $table()->insert($reverse($reversal['reversal_stock_movement_id'], ['quantity_milliliters' => -1_000_000])), 'إشارة العكس');
        $table()->insert($reverse($reversal['reversal_stock_movement_id']));
        $this->assertDbRejects(fn () => $table()->insert($reverse($reversal['reversal_stock_movement_id'])), 'عكس واحد في الدفتر');

        // الأنواع القائمة لا تتأثر.
        $table()->insert(array_merge($outRow(), ['movement_type' => 'sale', 'source_type' => null, 'source_id' => null, 'stock_movement_id' => null, 'quantity_milliliters' => -5, 'idempotency_key' => 'sale-' . Str::uuid()]));
    }

    // ───────────────────────── محاولات الترحيل ─────────────────────────

    /** @return array<string,mixed> */
    private function attemptRow(FuelTankerFill $fill, array $over = []): array
    {
        return array_merge([
            'id' => (string) Str::uuid(), 'tenant_id' => $this->tenantId, 'branch_id' => $this->fx['branchA']->id, 'fuel_tanker_fill_id' => $fill->id,
            'fuel_station_id' => $fill->fuel_station_id, 'posting_id' => null, 'operation_type' => 'post', 'outcome' => 'rejected', 'reason_code' => 'insufficient_stock',
            'idempotency_key' => 'attempt-' . Str::uuid(), 'actor_id' => User::query()->firstOrFail()->id, 'attempted_at' => now(), 'created_at' => now(),
        ], $over);
    }

    /** @test */
    public function the_attempts_table_is_append_only_tenant_linked_and_shape_checked_in_the_database(): void
    {
        $fill = $this->fill(1_000_000);
        $table = fn () => DB::table('fuel_tanker_fill_inventory_posting_attempts');

        // رفض وفشل: برمز سبب وبلا ترحيل، ويتكرران بالمفتاح نفسه (سجل لا قيد).
        $table()->insert($this->attemptRow($fill, ['idempotency_key' => 'same']));
        $table()->insert($this->attemptRow($fill, ['idempotency_key' => 'same', 'outcome' => 'failed', 'reason_code' => 'storage_error']));
        $table()->insert($this->attemptRow($fill, ['operation_type' => 'reverse', 'idempotency_key' => null]));
        $this->assertSame(3, $table()->count());

        foreach ([
            'نوع عملية مجهول' => ['operation_type' => 'void'],
            'نتيجة مجهولة' => ['outcome' => 'pending'],
            'غير ناجحة بلا سبب' => ['reason_code' => null],
            'غير ناجحة مع ترحيل' => ['posting_id' => (string) Str::uuid()],
            'ناجحة بلا ترحيل' => ['outcome' => 'succeeded', 'reason_code' => null],
            'محطة مخالفة للسند' => ['fuel_station_id' => $this->fx['s2']->id],
            'فرع مخالف للسند' => ['branch_id' => $this->fx['branchB']->id],
            'منفّذ مفقود' => ['actor_id' => null],
            'وقت مفقود' => ['attempted_at' => null],
        ] as $label => $over) {
            $this->assertDbRejects(fn () => $table()->insert($this->attemptRow($fill, $over)), $label);
        }

        // عزل المؤسسات: محاولة بمؤسسة أخرى على سند ليس لها مرفوضة.
        $other = $this->registerTenant('fuel-t62-att', 'owner@fuel-t62-att.test', autoEnableApplications: true);
        $this->assertDbRejects(fn () => $table()->insert($this->attemptRow($fill, ['tenant_id' => $other['tenant_id']])), 'سند مؤسسة أخرى');

        // لا تعديل ولا حذف.
        $first = $table()->orderBy('created_at')->first();
        $this->assertDbRejects(fn () => $table()->where('id', $first->id)->update(['reason_code' => 'changed']));
        $this->assertDbRejects(fn () => $table()->where('id', $first->id)->delete());
        $this->assertSame(3, $table()->count());
    }

    /** @test */
    public function a_succeeded_attempt_needs_a_matching_posting_and_succeeds_once_per_fill_and_operation(): void
    {
        $fill = $this->fill(1_000_000);
        $row = $this->postingRow($fill);
        $table = fn () => DB::table('fuel_tanker_fill_inventory_posting_attempts');

        $this->assertDbRejects(fn () => $table()->insert($this->attemptRow($fill, ['outcome' => 'succeeded', 'reason_code' => null, 'posting_id' => $row['id']])), 'ترحيل غير موجود');
        $this->insertPosting($row);
        $success = $this->attemptRow($fill, ['outcome' => 'succeeded', 'reason_code' => null, 'posting_id' => $row['id'], 'idempotency_key' => 'ok-1']);
        $table()->insert($success);
        $this->assertDbRejects(fn () => $table()->insert($this->attemptRow($fill, ['outcome' => 'succeeded', 'reason_code' => null, 'posting_id' => $row['id'], 'idempotency_key' => 'ok-2'])), 'نجاح ترحيل واحد لكل سند');

        // نجاح العكس يتطلب ترحيلاً معكوساً فعلاً.
        $reverse = $this->attemptRow($fill, ['operation_type' => 'reverse', 'outcome' => 'succeeded', 'reason_code' => null, 'posting_id' => $row['id'], 'idempotency_key' => 'rev-1']);
        $this->assertDbRejects(fn () => $table()->insert($reverse), 'لم يُعكس بعد');
        DB::table('fuel_tanker_fill_inventory_postings')->where('id', $row['id'])->update($this->reversalColumns($row));
        $table()->insert($reverse);
        $this->assertDbRejects(fn () => $table()->insert(array_merge($reverse, ['id' => (string) Str::uuid(), 'idempotency_key' => 'rev-2'])), 'نجاح عكس واحد لكل سند');

        // ترحيل سند آخر لا يُقبل دليلاً لهذا السند.
        $other = $this->fill(1_000_000);
        $this->assertDbRejects(fn () => $table()->insert($this->attemptRow($other, ['outcome' => 'succeeded', 'reason_code' => null, 'posting_id' => $row['id'], 'idempotency_key' => 'cross'])), 'ترحيل سند مختلف');
    }

    /** @test */
    public function the_attempt_model_refuses_every_write_and_is_read_only_until_the_posting_service_exists(): void
    {
        $fill = $this->fill();
        $row = $this->attemptRow($fill);
        DB::table('fuel_tanker_fill_inventory_posting_attempts')->insert($row);
        $attempt = FuelTankerFillInventoryPostingAttempt::query()->findOrFail($row['id']);

        $this->assertSame($fill->id, $attempt->tankerFill->id);
        $this->assertInstanceOf(LogicException::class, $this->caught(fn () => $attempt->forceFill(['reason_code' => 'x'])->save()));
        $this->assertInstanceOf(LogicException::class, $this->caught(fn () => $attempt->delete()));
        $this->assertInstanceOf(LogicException::class, $this->caught(fn () => FuelTankerFillInventoryPostingAttempt::query()->create([])));
        $this->assertInstanceOf(LogicException::class, $this->caught(fn () => (new FuelTankerFillInventoryPostingAttempt())->forceFill($this->attemptRow($fill))->save()));
        $this->assertInstanceOf(LogicException::class, $this->caught(fn () => (new FuelTankerFillInventoryPosting())->forceFill($this->postingRow($fill))->save()));
    }

    // ───────────────────────── الهجرة والتراجع ─────────────────────────

    /** @return array<string,mixed> */
    private function fillsSnapshot(): array
    {
        return DB::table('fuel_tanker_fills')->orderBy('id')->get()->map(fn ($r) => (array) $r)->all();
    }

    private function rollback(string $path): void
    {
        Artisan::call('migrate:rollback', ['--path' => $path, '--force' => true]);
    }

    /** @test */
    public function rolling_back_and_reapplying_the_migrations_leaves_every_existing_fill_untouched_and_creates_nothing(): void
    {
        $voidedFill = $this->fill(200_000);
        $this->withToken($this->fx['owner'])->postJson(self::FILLS . "/{$voidedFill->id}/void", ['reason' => 'خطأ'])->assertOk();
        $this->fill(300_000);
        $this->fill(400_000);
        $before = $this->fillsSnapshot();
        $effects = $this->effects();

        $this->rollback(self::M_ATTEMPTS);
        $this->rollback(self::M_GUARDS);
        $this->assertSame($before, $this->fillsSnapshot(), 'التراجع لا يمسّ سنداً');
        Artisan::call('migrate', ['--force' => true]);
        $this->assertSame($before, $this->fillsSnapshot(), 'إعادة التطبيق لا تغيّر سنداً ولا ترحّله تلقائياً');
        $this->assertSame($effects, $this->effects(), 'لا حركة ولا قيد ولا ترحيل ولا محاولة');
        $this->assertSame(0, DB::table('fuel_tanker_fills')->where('inventory_status', '<>', 'pending_integration')->count());

        // حراس PR-4/PR-6A المعادة بعد التراجع تعمل: لا انتقال ولا ترحيل (يُختبر بعد إعادة التطبيق).
        $fill = $this->fill(500_000);
        $this->assertDbRejects(fn () => $this->setInventory($fill, 'posted'));
    }

    /** @test */
    public function the_rollback_restores_the_pr4_and_pr6a_guards_when_nothing_was_posted(): void
    {
        $fill = $this->fill(500_000);
        $this->rollback(self::M_ATTEMPTS);
        $this->rollback(self::M_GUARDS);
        try {
            // الحراس القديمة: `inventory_status` ثابت تماماً وحالة `posted` مرفوضة حتى بالقيد.
            $this->assertDbRejects(fn () => $this->setInventory($fill, 'posted'));
            $this->assertDbRejects(fn () => $this->setInventory($fill, 'reversed'));
            $this->assertSame('pending_integration', $this->inventoryStatus($fill));
            $this->withToken($this->fx['owner'])->postJson(self::FILLS . "/{$fill->id}/void", ['reason' => 'يعمل كما كان'])->assertOk();
        } finally {
            Artisan::call('migrate', ['--force' => true]);
        }
    }

    /** @test */
    public function the_rollback_refuses_when_real_posting_history_exists_so_no_stock_or_financial_history_is_lost(): void
    {
        $fill = $this->fill();
        $row = $this->postingRow($fill);
        $this->insertPosting($row);
        $effects = $this->effects();

        $error = $this->caught(fn () => $this->rollback(self::M_GUARDS));
        $this->assertInstanceOf(RuntimeException::class, $error);
        $this->assertStringContainsString('Rollback refused', $error->getMessage());
        $this->assertSame('posted', $this->inventoryStatus($fill));
        $this->assertSame($effects, $this->effects());
        $this->assertSame(1, DB::table('fuel_tanker_fill_inventory_postings')->count());
        $this->assertTrue(DB::table('migrations')->where('migration', '2027_01_28_010000_add_fuel_tanker_fill_posting_state_guards')->exists(), 'الهجرة تبقى مطبَّقة');
    }

    /** @test */
    public function the_attempts_rollback_refuses_when_attempt_records_exist(): void
    {
        $fill = $this->fill();
        DB::table('fuel_tanker_fill_inventory_posting_attempts')->insert($this->attemptRow($fill));
        $error = $this->caught(fn () => $this->rollback(self::M_ATTEMPTS));
        $this->assertInstanceOf(RuntimeException::class, $error);
        $this->assertSame(1, DB::table('fuel_tanker_fill_inventory_posting_attempts')->count());
    }

    // ───────────────────────── لا مسار كتابة ─────────────────────────

    /** @test */
    public function only_the_pr6b3_posting_service_writes_posted_state_posting_rows_attempts_or_the_new_ledger_types(): void
    {
        // PR-6B-3/4: الكاتبان الوحيدان خدمتا الترحيل والعكس (وسمتهما المشتركة `FuelTankerFillInventorySupport` لتسجيل المحاولات الفاشلة، ومتحكّماهما يمرّران إليهما)؛ النموذجان يبقيان رافضين لكل كتابة.
        $allowed = [
            'FuelTankerFill.php', 'FuelTankerFillInventoryPosting.php', 'FuelTankerFillInventoryPostingAttempt.php', 'FuelOperationalLedger.php',
            'FuelTankerFillService.php', 'FuelTankerFillException.php', 'FuelTankerFillInventoryPostingService.php', 'FuelTankerFillInventoryPostingController.php',
            'FuelTankerFillInventoryReversalService.php', 'FuelTankerFillInventoryReversalController.php', 'FuelTankerFillInventorySupport.php',
        ];
        $needles = ['INVENTORY_POSTED', 'INVENTORY_REVERSED', 'TYPE_TANKER_FILL', 'TYPE_TANKER_FILL_REVERSAL', 'fuel_tanker_fill_inventory_posting_attempts', 'fuel_tanker_fill_inventory_postings', 'FuelTankerFillInventoryPostingAttempt', 'tanker_fill_reversal'];
        $hits = [];
        foreach (new \RecursiveIteratorIterator(new \RecursiveDirectoryIterator(app_path())) as $path) {
            if (! $path->isFile() || ! str_ends_with((string) $path, '.php')) {
                continue;
            }
            $source = (string) file_get_contents((string) $path);
            foreach ($needles as $needle) {
                if (str_contains($source, $needle)) {
                    $hits[basename((string) $path)][] = $needle;
                }
            }
        }
        // القارئان الوحيدان خارج ذلك: الجاهزية (تقرأ الجدول) والمطابقة (تقرأ الدفتر) — قراءة فقط.
        $readers = ['FuelTankerFillInventoryReadiness.php', 'FuelInventoryLedgerReconciliation.php'];
        foreach ($hits as $file => $found) {
            $this->assertTrue(in_array($file, array_merge($allowed, $readers), true), "{$file} يذكر " . implode(',', $found) . ' ولا يجوز');
        }
        foreach ($readers as $reader) {
            $code = preg_replace('~/\*.*?\*/|//[^\n]*~s', '', (string) file_get_contents(app_path("Services/{$reader}")));
            $this->assertDoesNotMatchRegularExpression('/->(create|insert|update|delete|save|forceFill|increment|decrement)\(/', (string) $code, "{$reader} قراءة فقط");
        }
        // PR-6B-4: مسار العكس الوحيد (POST) ومعاينته (GET) خلف البوابات الثلاث؛ والبوابة مغلقة افتراضياً (مصدر الإعداد).
        $routes = (string) file_get_contents(base_path('routes/api.php'));
        $this->assertSame(2, preg_match_all('/inventory-reversal/', $routes), 'مساران فقط للعكس: المعاينة والتنفيذ');
        $this->assertStringNotContainsString('inventory-reverse', $routes);
        $this->assertFalse(array_key_exists('fuel:post-tanker-fills', Artisan::all()), 'لا أمر ترحيل');
        $this->assertFalse(\App\Services\FuelTankerFillInventoryReadiness::POSTING_ENABLED);
    }
}
