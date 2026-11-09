<?php

namespace Tests\Feature;

use App\Models\Branch;
use App\Models\FuelTankerOwner;
use App\Models\Partner;
use App\Models\User;
use App\Services\FuelTankerService;
use App\Tenancy\BranchContext;
use App\Tenancy\TenantContext;
use Illuminate\Validation\ValidationException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use RuntimeException;
use Tests\TestCase;

/**
 * TANKER-PR1 — تزامن حقيقي (PostgreSQL + `pcntl_fork`) لبيانات أصحاب الصهاريج:
 *  - ربط الشركة نفسها بالصاحب نفسه في فترات متداخلة بالتزامن ⇒ ربط واحد والباقي رفض (قفل صف صاحب الصهريج يسلسل فحص التداخل، لا جمود).
 *  - إنشاء صهريجين بلوحة واحدة (بصيغ مختلفة) بالتزامن ⇒ صهريج واحد (الفهرس الفريد لـ`plate_key` خط الدفاع الأخير).
 *  - إنهاء الربط نفسه بالتزامن ⇒ إنهاء واحد.
 * على PostgreSQL لا يُتخطّى إن غاب `pcntl`؛ يُتخطّى على SQLite فقط.
 */
class FuelTankerLinkPostgresConcurrencyTest extends TestCase
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
        $this->dir = sys_get_temp_dir().'/fuel_tanker_link_'.uniqid();
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
    public function concurrent_overlapping_links_for_the_same_pair_yield_exactly_one_link(): void
    {
        $f = $this->fixture();

        $jobs = [];
        foreach (range(1, 6) as $i) {
            $jobs[] = function () use ($f, $i) {
                $this->enter($f);
                try {
                    app(FuelTankerService::class)->createLink(FuelTankerOwner::findOrFail($f['owner_id']), ['partner_id' => $f['partner_id'], 'valid_from' => '2026-01-0'.$i], User::findOrFail($f['actor_id']));

                    return 'ok';
                } catch (ValidationException) {
                    return 'rejected';
                }
            };
        }
        $results = $this->runConcurrently($jobs);

        $this->assertAllCompleted($results);
        $this->assertSame(1, count(array_filter($results, fn ($r) => $r['value'] === 'ok')), json_encode($results));
        $this->assertSame(5, count(array_filter($results, fn ($r) => $r['value'] === 'rejected')));
        $this->assertSame(1, (int) DB::table('fuel_tanker_owner_company_links')->where('fuel_tanker_owner_id', $f['owner_id'])->count());
    }

    /** @test */
    public function concurrent_tankers_with_the_same_normalised_plate_yield_exactly_one_tanker(): void
    {
        $f = $this->fixture();

        $plates = ['ABC-1234', 'abc 1234', 'ABC1234', 'a b c 1234', 'ABC_1234', 'abc.1234'];
        $jobs = [];
        foreach ($plates as $plate) {
            $jobs[] = function () use ($f, $plate) {
                $this->enter($f);
                try {
                    app(FuelTankerService::class)->createTanker(['fuel_tanker_owner_id' => $f['owner_id'], 'plate_number' => $plate], User::findOrFail($f['actor_id']));

                    return 'ok';
                } catch (ValidationException) {
                    return 'rejected';
                }
            };
        }
        $results = $this->runConcurrently($jobs);

        $this->assertAllCompleted($results);
        $this->assertSame(1, count(array_filter($results, fn ($r) => $r['value'] === 'ok')), json_encode($results));
        $this->assertSame(1, (int) DB::table('fuel_tankers')->where('tenant_id', $f['tenant_id'])->count());
    }

    /** @test */
    public function concurrent_ends_of_the_same_link_yield_exactly_one_end(): void
    {
        $f = $this->fixture();
        $this->enter($f);
        $link = app(FuelTankerService::class)->createLink(FuelTankerOwner::findOrFail($f['owner_id']), ['partner_id' => $f['partner_id'], 'valid_from' => '2026-01-01'], User::findOrFail($f['actor_id']));

        $jobs = [];
        foreach (range(1, 5) as $i) {
            $jobs[] = function () use ($f, $link, $i) {
                $this->enter($f);
                try {
                    app(FuelTankerService::class)->endLink($link, ['valid_to' => '2026-02-0'.$i], User::findOrFail($f['actor_id']));

                    return 'ok';
                } catch (RuntimeException) {
                    return 'rejected';
                }
            };
        }
        $results = $this->runConcurrently($jobs);

        $this->assertAllCompleted($results);
        $this->assertSame(1, count(array_filter($results, fn ($r) => $r['value'] === 'ok')), json_encode($results));
        $this->assertSame(1, (int) DB::table('fuel_station_audit_events')->where('subject_id', $link->id)->where('action', 'tanker_owner_link.ended')->count());
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
        $auth = $this->registerTenant('tanker-pg-'.Str::random(6), 'owner-'.Str::random(6).'@tanker-pg.test');
        $this->tenants[] = $auth['tenant_id'];
        app(TenantContext::class)->set($auth['tenant_id']);
        $branch = Branch::where('tenant_id', $auth['tenant_id'])->sole();
        app(BranchContext::class)->set($branch->id);
        $actor = User::where('tenant_id', $auth['tenant_id'])->where('role', 'owner')->sole();
        $owner = FuelTankerOwner::create(['name' => 'صاحب تزامن']);
        $partner = Partner::create(['type' => 'customer', 'name' => 'شركة تزامن', 'is_active' => true]);

        return ['tenant_id' => $auth['tenant_id'], 'branch_id' => $branch->id, 'actor_id' => $actor->id, 'owner_id' => $owner->id, 'partner_id' => $partner->id];
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
