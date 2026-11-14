<?php

namespace Tests\Feature;

use App\Models\Branch;
use App\Models\FuelInventoryCostMovement;
use App\Models\FuelNozzle;
use App\Models\FuelProduct;
use App\Models\FuelPump;
use App\Models\FuelShift;
use App\Models\FuelStation;
use App\Models\FuelTank;
use App\Models\FuelTankerFill;
use App\Models\FuelTankerOwner;
use App\Models\StockMovement;
use App\Models\User;
use App\Models\Warehouse;
use App\Services\FuelTankerFillException;
use App\Services\FuelTankerFillService;
use App\Tenancy\BranchContext;
use App\Tenancy\TenantContext;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * TANKER-PR6B-2 — سباق **إلغاء السند ↔ إدراج ترحيله** تحت تزامن حقيقي (PostgreSQL + `pcntl_fork`): لا يجتمع «سند ملغى» و«ترحيل نشط» أبداً، بأي ترتيب أقفال، ولا جمود.
 *
 * الإدراج هنا **يحاكي الكاتب المستقبلي (PR-6B-3) لاختبار حارس القاعدة وحده**؛ لا خدمة ترحيل في هذه الشريحة. اختبارات الترحيل المالي المتزامن الكاملة (خصم/قيد/مجمّع) تخص PR-6B-3.
 * يُتخطّى على SQLite فقط؛ غياب pcntl على PostgreSQL فشل لا تخطٍّ.
 */
class FuelTankerFillPostingStateConcurrencyPostgresTest extends TestCase
{
    use InteractsWithApi;
    use UsesWorkerDatabaseWithoutTransaction;

    private string $dir;

    /** @var list<string> */
    private array $tenants = [];

    protected function setUp(): void
    {
        parent::setUp();
        if (DB::connection()->getDriverName() !== 'pgsql') {
            $this->markTestSkipped('يتطلب PostgreSQL حقيقياً — SQLite لا يُظهر تنافساً على الأقفال.');
        }
        $this->assertTrue(function_exists('pcntl_fork'), 'pcntl مطلوب لاختبارات تزامن PostgreSQL؛ غيابه فشل لا تخطٍّ.');
        $this->dir = sys_get_temp_dir() . '/fuel_tanker_fill_state_' . uniqid();
        mkdir($this->dir);
    }

    protected function tearDown(): void
    {
        if (isset($this->dir) && is_dir($this->dir)) {
            foreach (glob($this->dir . '/*') ?: [] as $file) {
                @unlink($file);
            }
            @rmdir($this->dir);
        }
        if (DB::connection()->getDriverName() === 'pgsql') {
            foreach ($this->tenants as $id) {
                // السندات والترحيلات لا تُحذف مباشرةً؛ حذف المستأجر (المسموح في المُشغّلات) يزيلها مع بقية بياناته.
                DB::table('tenants')->where('id', $id)->delete();
            }
        }
        parent::tearDown();
    }

    /** @test */
    public function the_service_void_and_a_posting_insert_never_both_win_whichever_takes_the_fill_lock_first(): void
    {
        $f = $this->fixture();
        $pairs = [];
        foreach (range(1, 6) as $i) {
            $pairs[$i] = $this->preparePair($f, "race-{$i}");
        }

        $jobs = [];
        foreach ($pairs as $i => $pair) {
            $jobs[] = fn () => 'void:' . $this->voidViaService($f, $pair['fill_id']);
            $jobs[] = fn () => 'post:' . $this->insertPosting($f, $pair);
        }
        $results = $this->runConcurrently($jobs);
        $this->assertAllCompleted($results);

        $this->assertInvariants($pairs, $results);
    }

    /** @test */
    public function a_void_holding_the_fill_lock_makes_the_posting_insert_wait_and_then_be_rejected(): void
    {
        $f = $this->fixture();
        $pair = $this->preparePair($f, 'void-first');

        $results = $this->runConcurrently([
            function () use ($f, $pair) { // الإلغاء يمسك القفل (كـ lockForUpdate في الخدمة) ثم يلتزم
                $this->enter($f);
                DB::transaction(function () use ($pair, $f) {
                    DB::table('fuel_tanker_fills')->where('id', $pair['fill_id'])->lockForUpdate()->first();
                    usleep(400_000);
                    DB::table('fuel_tanker_fills')->where('id', $pair['fill_id'])->update(['status' => 'voided', 'voided_by' => $f['actor_id'], 'voided_at' => now(), 'void_reason' => 'سباق']);
                });

                return 'void:ok';
            },
            function () use ($f, $pair) {
                $this->enter($f);
                usleep(100_000); // بعد أخذ الإلغاء للقفل
                return 'post:' . $this->insertPosting($f, $pair);
            },
        ]);
        $this->assertAllCompleted($results);

        $this->assertSame('void:ok', $results[0]['value']);
        $this->assertSame('post:rejected', $results[1]['value'], 'الترحيل ينتظر ثم يقرأ السند ملغى فيُرفض');
        $this->assertSame(0, (int) DB::table('fuel_tanker_fill_inventory_postings')->where('fuel_tanker_fill_id', $pair['fill_id'])->count());
        $this->assertSame('voided', DB::table('fuel_tanker_fills')->where('id', $pair['fill_id'])->value('status'));
        $this->assertSame('pending_integration', DB::table('fuel_tanker_fills')->where('id', $pair['fill_id'])->value('inventory_status'));
    }

    /** @test */
    public function a_posting_insert_holding_the_fill_lock_makes_the_void_wait_and_then_be_refused_as_posted(): void
    {
        $f = $this->fixture();
        $pair = $this->preparePair($f, 'post-first');

        $results = $this->runConcurrently([
            function () use ($f, $pair) { // الترحيل يدرج (المُشغّل يقفل السند ويحوّله posted) ثم يبقى مفتوحاً قبل الالتزام
                $this->enter($f);
                DB::transaction(function () use ($pair) {
                    DB::table('fuel_tanker_fill_inventory_postings')->insert($pair['row']);
                    usleep(400_000);
                });

                return 'post:ok';
            },
            function () use ($f, $pair) {
                usleep(100_000);

                return 'void:' . $this->voidViaService($f, $pair['fill_id']);
            },
        ]);
        $this->assertAllCompleted($results);

        $this->assertSame('post:ok', $results[0]['value']);
        $this->assertSame('void:' . FuelTankerFillException::FILL_INVENTORY_POSTED, $results[1]['value'], 'الإلغاء ينتظر الالتزام ثم يرى السند مرحَّلاً');
        $this->assertSame('recorded', DB::table('fuel_tanker_fills')->where('id', $pair['fill_id'])->value('status'));
        $this->assertSame('posted', DB::table('fuel_tanker_fills')->where('id', $pair['fill_id'])->value('inventory_status'));
    }

    /** @test */
    public function two_concurrent_postings_of_one_fill_commit_once_and_the_loser_is_rejected_without_deadlock(): void
    {
        $f = $this->fixture();
        $pair = $this->preparePair($f, 'dup');
        $second = $this->preparePair($f, 'dup-2', fillId: $pair['fill_id']);

        $results = $this->runConcurrently([
            fn () => 'a:' . $this->insertPosting($f, $pair),
            fn () => 'b:' . $this->insertPosting($f, $second),
        ]);
        $this->assertAllCompleted($results);

        $values = array_column($results, 'value');
        $this->assertSame(1, count(array_filter($values, fn ($v) => str_ends_with($v, ':inserted'))), json_encode($values));
        $this->assertSame(1, count(array_filter($values, fn ($v) => str_ends_with($v, ':rejected'))), json_encode($values));
        $this->assertSame(1, (int) DB::table('fuel_tanker_fill_inventory_postings')->where('fuel_tanker_fill_id', $pair['fill_id'])->count());
        $this->assertSame('posted', DB::table('fuel_tanker_fills')->where('id', $pair['fill_id'])->value('inventory_status'));
    }

    // ───────────────────────── أدوات ─────────────────────────

    /**
     * لا يجتمع «سند ملغى» و«ترحيل نشط»، وحالة السند تتبع وجود الترحيل، ونتيجة كل زوج إحدى حالتين متسقتين.
     *
     * @param  array<int, array<string,mixed>>  $pairs
     * @param  array<int, array<string,mixed>>  $results
     */
    private function assertInvariants(array $pairs, array $results): void
    {
        $k = 0;
        foreach ($pairs as $i => $pair) {
            $void = $results[$k++]['value'];
            $post = $results[$k++]['value'];
            $fill = DB::table('fuel_tanker_fills')->where('id', $pair['fill_id'])->first();
            $hasPosting = DB::table('fuel_tanker_fill_inventory_postings')->where('fuel_tanker_fill_id', $pair['fill_id'])->exists();

            $this->assertFalse($fill->status === 'voided' && $hasPosting, "الزوج {$i}: سند ملغى بترحيل نشط ({$void} / {$post})");
            $this->assertSame($hasPosting ? 'posted' : 'pending_integration', $fill->inventory_status, "الزوج {$i}: الحالة تتبع الترحيل");
            if ($hasPosting) {
                $this->assertSame('void:' . FuelTankerFillException::FILL_INVENTORY_POSTED, $void, "الزوج {$i}");
                $this->assertSame('post:inserted', $post, "الزوج {$i}");
            } else {
                $this->assertSame('void:ok', $void, "الزوج {$i}");
                $this->assertSame('post:rejected', $post, "الزوج {$i}");
                $this->assertSame('voided', $fill->status);
            }
        }
    }

    private function voidViaService(array $f, string $fillId): string
    {
        $this->enter($f);
        try {
            app(FuelTankerFillService::class)->void(FuelTankerFill::query()->withoutGlobalScopes()->findOrFail($fillId), 'سباق ترحيل', User::findOrFail($f['actor_id']));

            return 'ok';
        } catch (FuelTankerFillException $exception) {
            return $exception->reason;
        }
    }

    /** @param array<string,mixed> $pair */
    private function insertPosting(array $f, array $pair): string
    {
        $this->enter($f);
        try {
            DB::transaction(fn () => DB::table('fuel_tanker_fill_inventory_postings')->insert($pair['row']));

            return 'inserted';
        } catch (\Illuminate\Database\QueryException $exception) {
            $message = $exception->getMessage();
            $this->assertFalse(str_contains($message, '40P01') || stripos($message, 'deadlock') !== false, 'جمود: ' . $message);

            return 'rejected';
        }
    }

    /**
     * سند + حركة مخزون + حركة تكلفة + صف ترحيل جاهز (يُدرج لاحقاً من العملية المتزامنة).
     *
     * @param  array<string,string>  $f
     * @return array{fill_id: string, row: array<string,mixed>}
     */
    private function preparePair(array $f, string $key, ?string $fillId = null): array
    {
        $this->enter($f);
        if ($fillId === null) {
            $result = app(FuelTankerFillService::class)->record([
                'fuel_station_id' => $f['station_id'], 'fuel_nozzle_id' => $f['nozzle_id'], 'fuel_tanker_owner_id' => $f['tanker_owner_id'],
                'quantity_liters' => '1000', 'voucher_number' => $key, 'idempotency_key' => "state-{$key}",
            ], User::findOrFail($f['actor_id']));
            $fillId = $result['fill']->id;
        }
        $fill = FuelTankerFill::query()->withoutGlobalScopes()->findOrFail($fillId);
        $quantity = (int) $fill->quantity_milliliters;

        $stock = StockMovement::create([
            'product_id' => $f['product_id'], 'warehouse_id' => $f['warehouse_id'], 'branch_id' => $f['branch_id'], 'type' => 'out', 'quantity' => $quantity,
            'unit_cost' => 0, 'total_cost' => 0, 'balance_quantity' => 0, 'movement_date' => now()->toDateString(),
        ]);
        $cost = FuelInventoryCostMovement::create([
            'warehouse_id' => $f['warehouse_id'], 'fuel_product_id' => $f['fuel_product_id'], 'stock_movement_id' => $stock->id, 'movement_type' => 'issue',
            'quantity_milliliters' => $quantity, 'posted_cost_minor' => 500, 'cost_pool_minor_before' => 0, 'cost_numerator_before' => '0', 'cost_denominator_before' => '1',
            'quantity_milliliters_before' => 0, 'carry_remainder_numerator_before' => '0', 'carry_remainder_denominator_before' => '1', 'cost_pool_minor_after' => 0,
            'cost_numerator_after' => '0', 'cost_denominator_after' => '1', 'quantity_milliliters_after' => 0, 'carry_remainder_numerator_after' => '0',
            'carry_remainder_denominator_after' => '1', 'occurred_at' => now(),
        ]);

        return ['fill_id' => $fillId, 'row' => [
            'id' => (string) Str::uuid(), 'tenant_id' => $f['tenant_id'], 'branch_id' => $f['branch_id'], 'fuel_tanker_fill_id' => $fillId,
            'fuel_station_id' => $f['station_id'], 'fuel_product_id' => $f['fuel_product_id'], 'warehouse_id' => $f['warehouse_id'],
            'stock_movement_id' => $stock->id, 'cost_movement_id' => $cost->id, 'quantity_milliliters' => $quantity, 'posted_cost_minor' => 500,
            'idempotency_key' => "state-post-{$key}", 'status' => 'posted', 'posted_by' => $f['actor_id'], 'posted_at' => now(), 'created_at' => now(), 'updated_at' => now(),
        ]];
    }

    /** @param array<string,string> $f */
    private function enter(array $f): void
    {
        app(TenantContext::class)->set($f['tenant_id']);
        app(BranchContext::class)->set($f['branch_id']);
    }

    /** @return array<string,string> */
    private function fixture(): array
    {
        $auth = $this->registerTenant('fuel-t62-pg-' . Str::random(6), 'owner-' . Str::random(6) . '@fuel-t62-pg.test');
        $this->tenants[] = $auth['tenant_id'];
        app(TenantContext::class)->set($auth['tenant_id']);
        $branch = Branch::where('tenant_id', $auth['tenant_id'])->sole();
        app(BranchContext::class)->set($branch->id);
        $actor = User::where('tenant_id', $auth['tenant_id'])->where('role', 'owner')->sole();
        $warehouse = Warehouse::where('is_default', true)->firstOrFail();

        $productId = $this->withToken($auth['token'])->postJson('/api/products', [
            'name' => 'وقود T62 mL', 'type' => 'good', 'unit' => 'mL', 'sale_price' => 1000, 'purchase_price' => 10, 'track_inventory' => true,
        ])->assertCreated()['data']['id'];
        $fuel = FuelProduct::create(['product_id' => $productId, 'code' => 'F-T62', 'name' => 'وقود T62']);
        $station = FuelStation::create(['branch_id' => $branch->id, 'warehouse_id' => $warehouse->id, 'code' => 'FS-T62', 'name' => 'محطة T62']);
        $tank = FuelTank::create(['branch_id' => $branch->id, 'fuel_station_id' => $station->id, 'fuel_product_id' => $fuel->id, 'code' => 'T-T62', 'name' => 'خزان', 'capacity_milliliters' => 900_000_000, 'safe_capacity_milliliters' => 800_000_000]);
        $pump = FuelPump::create(['branch_id' => $branch->id, 'fuel_station_id' => $station->id, 'pump_number' => '02', 'name' => 'مضخة']);
        $nozzle = FuelNozzle::create(['branch_id' => $branch->id, 'fuel_station_id' => $station->id, 'fuel_pump_id' => $pump->id, 'fuel_tank_id' => $tank->id, 'fuel_product_id' => $fuel->id, 'nozzle_number' => '1']);
        FuelShift::create([
            'branch_id' => $branch->id, 'fuel_station_id' => $station->id, 'number' => 'FSH-T62', 'status' => FuelShift::STATUS_OPEN, 'opening_float_minor' => 0,
            'idempotency_key' => 'shift-t62', 'opened_by' => $actor->id, 'opened_at' => now(),
        ]);
        $owner = FuelTankerOwner::create(['name' => 'عسكر', 'code' => 'ASK', 'status' => 'active']);

        return [
            'tenant_id' => $auth['tenant_id'], 'branch_id' => $branch->id, 'actor_id' => $actor->id, 'station_id' => $station->id, 'nozzle_id' => $nozzle->id,
            'tanker_owner_id' => $owner->id, 'warehouse_id' => $warehouse->id, 'product_id' => $productId, 'fuel_product_id' => $fuel->id,
        ];
    }

    private function assertAllCompleted(array $results): void
    {
        foreach ($results as $i => $result) {
            $this->assertTrue($result['ok'] ?? false, "العملية {$i}: " . ($result['error_class'] ?? '') . ' ' . ($result['message'] ?? ''));
            $message = (string) ($result['message'] ?? '');
            $this->assertFalse(str_contains($message, '40P01') || stripos($message, 'deadlock') !== false, "جمود في العملية {$i}");
        }
    }

    /** @param list<callable> $jobs @return array<int, array<string, mixed>> */
    private function runConcurrently(array $jobs): array
    {
        $barrier = $this->dir . '/barrier_' . uniqid();
        $resultFiles = [];
        $pids = [];

        foreach ($jobs as $i => $job) {
            $resultFiles[$i] = $this->dir . '/result_' . uniqid() . "_{$i}";
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

        $results = [];
        foreach ($resultFiles as $i => $file) {
            $raw = is_file($file) ? file_get_contents($file) : false;
            $results[$i] = json_decode($raw !== false ? $raw : '{"ok":false,"message":"no output"}', true);
        }

        return $results;
    }
}
