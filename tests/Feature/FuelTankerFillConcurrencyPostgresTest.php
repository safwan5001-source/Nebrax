<?php

namespace Tests\Feature;

use App\Models\Branch;
use App\Models\FuelNozzle;
use App\Models\FuelProduct;
use App\Models\FuelPump;
use App\Models\FuelShift;
use App\Models\FuelStation;
use App\Models\FuelTank;
use App\Models\FuelTanker;
use App\Models\FuelTankerOwner;
use App\Models\User;
use App\Services\FuelStationMasterDataService;
use App\Services\FuelStationSettingsService;
use App\Services\FuelTankerFillException;
use App\Services\FuelTankerFillService;
use App\Tenancy\BranchContext;
use App\Tenancy\TenantContext;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * TANKER-PR4 — سندات تعبئة الصهاريج تحت تزامن حقيقي (PostgreSQL + `pcntl_fork`):
 *  - السند الورقي نفسه من عدة عمليات ⇒ نجاح واحد والباقي `voucher_duplicate` (لا 500، لا جمود).
 *  - الإعادة المتزامنة بمفتاح idempotency واحد ⇒ سجل واحد يُعاد للجميع.
 *  - أرقام FTF متسلسلة بلا تكرار ولا ثغرة تحت تزامن التوليد.
 *  - نطاق «مؤسسة» عبر محطتين (لا يسلسلهما قفل المحطة) ⇒ الفهرس الفريد في القاعدة يحسم، فيعود رفض واضح لا خطأ قاعدة بيانات.
 *  - تعبئة ↔ إغلاق الوردية: لا تعبئة تُسجَّل بعد لحظة الإغلاق، ولا جمود.
 *  - تعبئة ↔ تضييق عمليات الفوهة: لا جمود، والنتيجة متسقة.
 * يُتخطّى على SQLite فقط؛ غياب pcntl على PostgreSQL فشل لا تخطٍّ.
 */
class FuelTankerFillConcurrencyPostgresTest extends TestCase
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
            $this->markTestSkipped('يتطلب PostgreSQL حقيقياً — SQLite لا يُظهر تنافساً على الأقفال والفهارس.');
        }
        $this->assertTrue(function_exists('pcntl_fork'), 'pcntl مطلوب لاختبارات تزامن PostgreSQL؛ غيابه فشل لا تخطٍّ.');
        $this->dir = sys_get_temp_dir() . '/fuel_tanker_fill_' . uniqid();
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
                // السندات لا تُحذف مباشرةً؛ حذف المستأجر (المسموح في المُشغّل) يزيلها مع بقية بياناته.
                DB::table('tenants')->where('id', $id)->delete();
            }
        }
        parent::tearDown();
    }

    /** @test */
    public function the_same_paper_voucher_from_many_processes_is_recorded_once(): void
    {
        $f = $this->fixture();
        $jobs = [];
        foreach (range(1, 8) as $i) {
            $jobs[] = fn () => $this->attempt($f, ['voucher_number' => '04052', 'idempotency_key' => "conc-voucher-{$i}"]);
        }
        $results = $this->runConcurrently($jobs);

        $this->assertAllCompleted($results);
        $values = array_column($results, 'value');
        $this->assertSame(1, count(array_filter($values, fn ($v) => str_starts_with($v, 'ok:'))), json_encode($values));
        $this->assertSame(7, count(array_filter($values, fn ($v) => $v === 'rejected:voucher_duplicate')), json_encode($values));
        $this->assertSame(1, (int) DB::table('fuel_tanker_fills')->where('tenant_id', $f['tenant_id'])->count());
    }

    /** @test */
    public function concurrent_retries_with_one_idempotency_key_return_one_record(): void
    {
        $f = $this->fixture();
        $jobs = [];
        foreach (range(1, 8) as $i) {
            $jobs[] = fn () => $this->attempt($f, ['voucher_number' => '7001', 'idempotency_key' => 'same-retry-key']);
        }
        $results = $this->runConcurrently($jobs);

        $this->assertAllCompleted($results);
        $ids = array_map(fn ($v) => explode(':', $v)[1] ?? $v, array_column($results, 'value'));
        $this->assertCount(1, array_unique($ids), json_encode($results));
        $this->assertSame(1, (int) DB::table('fuel_tanker_fills')->where('tenant_id', $f['tenant_id'])->count());
        $this->assertSame(1, (int) DB::table('fuel_station_audit_events')->where('tenant_id', $f['tenant_id'])->where('action', 'tanker_fill.recorded')->count());
    }

    /** @test */
    public function concurrent_distinct_vouchers_get_unique_contiguous_ftf_numbers(): void
    {
        $f = $this->fixture();
        $jobs = [];
        foreach (range(1, 10) as $i) {
            $jobs[] = fn () => $this->attempt($f, ['voucher_number' => "V-{$i}", 'idempotency_key' => "conc-number-{$i}"]);
        }
        $results = $this->runConcurrently($jobs);

        $this->assertAllCompleted($results);
        $this->assertSame(10, count(array_filter(array_column($results, 'value'), fn ($v) => str_starts_with($v, 'ok:'))), json_encode($results));
        $numbers = DB::table('fuel_tanker_fills')->where('tenant_id', $f['tenant_id'])->orderBy('number')->pluck('number')->all();
        $this->assertCount(10, array_unique($numbers));
        $sequence = array_map(fn ($n) => (int) substr($n, -5), $numbers);
        $this->assertSame(range(1, 10), $sequence, 'أرقام متسلسلة بلا ثغرة ولا تكرار: ' . json_encode($numbers));
    }

    /** @test */
    public function the_tenant_wide_voucher_scope_across_two_stations_is_settled_by_the_unique_index(): void
    {
        $f = $this->fixture(withSecondStation: true);
        app(TenantContext::class)->set($f['tenant_id']);
        app(FuelStationSettingsService::class)->putTenant(['tanker_voucher_unique_scope' => 'tenant'], User::findOrFail($f['actor_id']), 'اختبار تزامن');

        $jobs = [];
        foreach (range(1, 8) as $i) {
            $second = $i % 2 === 0;
            $jobs[] = fn () => $this->attempt($f, [
                'voucher_number' => 'WIDE-1', 'idempotency_key' => "conc-wide-{$i}",
                'fuel_station_id' => $second ? $f['station2_id'] : $f['station_id'], 'fuel_nozzle_id' => $second ? $f['nozzle2_id'] : $f['nozzle_id'],
            ]);
        }
        $results = $this->runConcurrently($jobs);

        $this->assertAllCompleted($results);
        $values = array_column($results, 'value');
        $this->assertSame(1, count(array_filter($values, fn ($v) => str_starts_with($v, 'ok:'))), json_encode($values));
        $this->assertSame(7, count(array_filter($values, fn ($v) => $v === 'rejected:voucher_duplicate')), 'الرفض واضح لا خطأ قاعدة بيانات: ' . json_encode($values));
        $this->assertSame(1, (int) DB::table('fuel_tanker_fills')->where('tenant_id', $f['tenant_id'])->count());
    }

    /** @test */
    public function fills_racing_a_shift_close_never_land_after_the_close_and_never_deadlock(): void
    {
        $f = $this->fixture();
        $jobs = [];
        foreach (range(1, 6) as $i) {
            $jobs[] = fn () => $this->attempt($f, ['voucher_number' => "RACE-{$i}", 'idempotency_key' => "conc-close-{$i}"]);
        }
        $jobs[] = function () use ($f) {
            $this->enter($f);
            DB::transaction(function () use ($f) {
                $shift = FuelShift::query()->lockForUpdate()->findOrFail($f['shift_id']);
                usleep(300_000); // الإغلاق يمسك القفل: التعبئات المتزامنة تنتظر ثم تُرفض، ولا تُسجَّل بعده.
                $shift->forceFill(['status' => FuelShift::STATUS_CLOSED, 'closed_at' => now()])->save();
            });

            return 'closed';
        };
        $results = $this->runConcurrently($jobs);

        $this->assertAllCompleted($results);
        $closedAt = DB::table('fuel_shifts')->where('id', $f['shift_id'])->value('closed_at');
        $this->assertNotNull($closedAt);
        $this->assertSame(0, (int) DB::table('fuel_tanker_fills')->where('tenant_id', $f['tenant_id'])->where('recorded_at', '>', $closedAt)->count(), 'لا تعبئة بعد الإغلاق');
        foreach (array_column($results, 'value') as $value) {
            $this->assertContains(true, [str_starts_with($value, 'ok:'), $value === 'closed', in_array($value, ['rejected:shift_not_open', 'rejected:shift_required'], true)], $value);
        }
    }

    /** @test */
    public function fills_racing_a_nozzle_restriction_never_deadlock_and_stay_consistent(): void
    {
        $f = $this->fixture();
        $jobs = [];
        foreach (range(1, 6) as $i) {
            $jobs[] = fn () => $this->attempt($f, ['voucher_number' => "NZ-{$i}", 'idempotency_key' => "conc-nozzle-{$i}"]);
        }
        $jobs[] = function () use ($f) {
            $this->enter($f);
            app(FuelStationMasterDataService::class)->updateNozzle(FuelNozzle::findOrFail($f['nozzle_id']), ['allowed_operations' => [FuelNozzle::OPERATION_DIRECT_SALE]], User::findOrFail($f['actor_id']));

            return 'narrowed';
        };
        $results = $this->runConcurrently($jobs);

        $this->assertAllCompleted($results);
        $this->assertSame([FuelNozzle::OPERATION_DIRECT_SALE], json_decode((string) DB::table('fuel_nozzles')->where('id', $f['nozzle_id'])->value('allowed_operations'), true));
        foreach (array_column($results, 'value') as $value) {
            $this->assertContains(true, [str_starts_with($value, 'ok:'), $value === 'narrowed', $value === 'rejected:nozzle_operation_not_allowed'], $value);
        }
        $this->assertSame(
            count(array_filter(array_column($results, 'value'), fn ($v) => str_starts_with($v, 'ok:'))),
            (int) DB::table('fuel_tanker_fills')->where('tenant_id', $f['tenant_id'])->count(),
        );
    }

    // ───────────────────────── أدوات ─────────────────────────

    /**
     * @param  array<string,string>  $f
     * @param  array<string,mixed>  $over
     */
    private function attempt(array $f, array $over): string
    {
        $this->enter($f);
        try {
            $result = app(FuelTankerFillService::class)->record(array_merge([
                'fuel_station_id' => $f['station_id'], 'fuel_nozzle_id' => $f['nozzle_id'], 'fuel_tanker_owner_id' => $f['tanker_owner_id'],
                'quantity_liters' => '1000',
            ], $over), User::findOrFail($f['actor_id']));

            return 'ok:' . $result['fill']->id;
        } catch (FuelTankerFillException $exception) {
            return 'rejected:' . $exception->reason;
        }
    }

    /** @param array<string,string> $f */
    private function enter(array $f): void
    {
        app(TenantContext::class)->set($f['tenant_id']);
        app(BranchContext::class)->set($f['branch_id']);
    }

    /** @return array<string,string> */
    private function fixture(bool $withSecondStation = false): array
    {
        $auth = $this->registerTenant('fuel-t4-pg-' . Str::random(6), 'owner-' . Str::random(6) . '@fuel-t4-pg.test');
        $this->tenants[] = $auth['tenant_id'];
        app(TenantContext::class)->set($auth['tenant_id']);
        $branch = Branch::where('tenant_id', $auth['tenant_id'])->sole();
        app(BranchContext::class)->set($branch->id);
        $actor = User::where('tenant_id', $auth['tenant_id'])->where('role', 'owner')->sole();

        $productId = $this->withToken($auth['token'])->postJson('/api/products', [
            'name' => 'وقود T4 mL', 'type' => 'good', 'unit' => 'mL', 'sale_price' => 1000, 'purchase_price' => 10, 'track_inventory' => true,
        ])->assertCreated()['data']['id'];
        $fuel = FuelProduct::create(['product_id' => $productId, 'code' => 'F-T4', 'name' => 'وقود T4']);

        $equipment = function (string $suffix) use ($branch, $fuel, $actor) {
            $station = FuelStation::create(['branch_id' => $branch->id, 'code' => 'FS-' . $suffix, 'name' => 'محطة ' . $suffix]);
            $tank = FuelTank::create(['branch_id' => $branch->id, 'fuel_station_id' => $station->id, 'fuel_product_id' => $fuel->id, 'code' => 'T-' . $suffix, 'name' => 'خزان', 'capacity_milliliters' => 900_000_000, 'safe_capacity_milliliters' => 800_000_000]);
            $pump = FuelPump::create(['branch_id' => $branch->id, 'fuel_station_id' => $station->id, 'pump_number' => '02', 'name' => 'مضخة']);
            $nozzle = FuelNozzle::create(['branch_id' => $branch->id, 'fuel_station_id' => $station->id, 'fuel_pump_id' => $pump->id, 'fuel_tank_id' => $tank->id, 'fuel_product_id' => $fuel->id, 'nozzle_number' => '1']);
            $shift = FuelShift::create([
                'branch_id' => $branch->id, 'fuel_station_id' => $station->id, 'number' => 'FSH-' . $suffix, 'status' => FuelShift::STATUS_OPEN, 'opening_float_minor' => 0,
                'idempotency_key' => 'shift-' . $suffix, 'opened_by' => $actor->id, 'opened_at' => now(),
            ]);

            return [$station, $nozzle, $shift];
        };
        [$station, $nozzle, $shift] = $equipment('PG1');
        $owner = FuelTankerOwner::create(['name' => 'عسكر', 'code' => 'ASK', 'status' => 'active']);

        $f = [
            'tenant_id' => $auth['tenant_id'], 'branch_id' => $branch->id, 'actor_id' => $actor->id, 'station_id' => $station->id, 'nozzle_id' => $nozzle->id,
            'shift_id' => $shift->id, 'tanker_owner_id' => $owner->id,
        ];
        if ($withSecondStation) {
            [$station2, $nozzle2] = $equipment('PG2');
            $f += ['station2_id' => $station2->id, 'nozzle2_id' => $nozzle2->id];
        }

        return $f;
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
