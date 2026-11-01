<?php

namespace Tests\Feature;

use App\Models\Branch;
use App\Models\FuelStation;
use App\Models\User;
use App\Services\FuelShiftService;
use App\Tenancy\BranchContext;
use App\Tenancy\TenantContext;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use RuntimeException;
use Tests\TestCase;

/**
 * FS-33 (PR-13) — وردية مفتوحة واحدة لكل محطة تحت تزامن حقيقي (PostgreSQL + `pcntl_fork`).
 *  - عبر الخدمة: قفل صف المحطة + الفهرس ⇒ نجاح واحد والباقي رفض واضح (لا جمود).
 *  - بتجاوز الخدمة (SQL خام متزامن): الفهرس وحده يكفي ⇒ إدراج واحد والباقي 23505.
 * على PostgreSQL لا يُتخطّى إن غاب `pcntl`؛ يُتخطّى على SQLite فقط.
 */
class FuelOpenShiftPostgresConcurrencyTest extends TestCase
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
        $this->dir = sys_get_temp_dir().'/fuel_open_shift_'.uniqid();
        mkdir($this->dir);
    }

    protected function tearDown(): void
    {
        if (isset($this->dir) && is_dir($this->dir)) {
            foreach (glob($this->dir.'/*') ?: [] as $f) {
                @unlink($f);
            }
            @rmdir($this->dir);
        }
        if (DB::connection()->getDriverName() === 'pgsql') {
            foreach ($this->tenants as $id) {
                DB::table('tenants')->where('id', $id)->delete();
            }
        }
        parent::tearDown();
    }

    /** @test */
    public function concurrent_opens_through_the_service_yield_exactly_one_open_shift(): void
    {
        $f = $this->fixture();

        $jobs = [];
        foreach (range(1, 6) as $i) {
            $jobs[] = function () use ($f, $i) {
                $this->enter($f);
                try {
                    app(FuelShiftService::class)->open(['fuel_station_id' => $f['station_id'], 'idempotency_key' => "conc-open-{$i}", 'opening_float_minor' => 0], User::findOrFail($f['actor_id']));

                    return 'ok';
                } catch (RuntimeException) {
                    return 'rejected';
                }
            };
        }
        $results = $this->runConcurrently($jobs);

        $this->assertAllCompleted($results);
        $this->assertSame(1, count(array_filter($results, fn ($r) => $r['value'] === 'ok')));
        $this->assertSame(5, count(array_filter($results, fn ($r) => $r['value'] === 'rejected')));
        $this->assertSame(1, (int) DB::table('fuel_shifts')->where('fuel_station_id', $f['station_id'])->where('status', 'open')->count());
    }

    /** @test */
    public function concurrent_raw_inserts_that_bypass_the_service_are_stopped_by_the_index(): void
    {
        $f = $this->fixture();

        $jobs = [];
        foreach (range(1, 6) as $i) {
            $jobs[] = function () use ($f, $i) {
                try {
                    DB::table('fuel_shifts')->insert([
                        'id' => (string) Str::uuid(), 'tenant_id' => $f['tenant_id'], 'branch_id' => $f['branch_id'], 'fuel_station_id' => $f['station_id'],
                        'number' => "FSH-RAW-{$i}", 'status' => 'open', 'opening_float_minor' => 0, 'opened_at' => now(),
                        'idempotency_key' => "raw-{$i}", 'created_at' => now(), 'updated_at' => now(),
                    ]);

                    return 'ok';
                } catch (QueryException $e) {
                    return str_contains($e->getMessage(), '23505') ? 'unique' : 'other:'.$e->getMessage();
                }
            };
        }
        $results = $this->runConcurrently($jobs);

        $this->assertAllCompleted($results);
        $this->assertSame(1, count(array_filter($results, fn ($r) => $r['value'] === 'ok')));
        $this->assertSame(5, count(array_filter($results, fn ($r) => $r['value'] === 'unique')), json_encode($results));
        $this->assertSame(1, (int) DB::table('fuel_shifts')->where('fuel_station_id', $f['station_id'])->where('status', 'open')->count());
    }

    /** @test */
    public function concurrent_retries_with_one_idempotency_key_return_the_same_shift(): void
    {
        $f = $this->fixture();

        $jobs = [];
        foreach (range(1, 5) as $i) {
            $jobs[] = function () use ($f) {
                $this->enter($f);

                return app(FuelShiftService::class)->open(['fuel_station_id' => $f['station_id'], 'idempotency_key' => 'same-key', 'opening_float_minor' => 0], User::findOrFail($f['actor_id']))->id;
            };
        }
        $results = $this->runConcurrently($jobs);

        $this->assertAllCompleted($results);
        $this->assertCount(1, array_unique(array_map(fn ($r) => $r['value'], $results)));
        $this->assertSame(1, (int) DB::table('fuel_shifts')->where('fuel_station_id', $f['station_id'])->count());
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
        $auth = $this->registerTenant('fuel-open-pg-'.Str::random(6), 'owner-'.Str::random(6).'@fuel-open-pg.test');
        $this->tenants[] = $auth['tenant_id'];
        app(TenantContext::class)->set($auth['tenant_id']);
        $branch = Branch::where('tenant_id', $auth['tenant_id'])->sole();
        app(BranchContext::class)->set($branch->id);
        $actor = User::where('tenant_id', $auth['tenant_id'])->where('role', 'owner')->sole();
        $station = FuelStation::create(['branch_id' => $branch->id, 'code' => 'FS-PG', 'name' => 'محطة التزامن']);

        return ['tenant_id' => $auth['tenant_id'], 'branch_id' => $branch->id, 'actor_id' => $actor->id, 'station_id' => $station->id];
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

        $results = [];
        foreach ($resultFiles as $i => $file) {
            $raw = is_file($file) ? file_get_contents($file) : false;
            $results[$i] = json_decode($raw !== false ? $raw : '{"ok":false,"message":"no output"}', true);
        }

        return $results;
    }
}
