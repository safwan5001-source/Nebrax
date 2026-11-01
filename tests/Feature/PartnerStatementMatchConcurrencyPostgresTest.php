<?php

namespace Tests\Feature;

use App\Models\Partner;
use App\Models\PartnerStatementLine;
use App\Models\PartnerStatementReconciliation;
use App\Models\User;
use App\Services\Accounting\InvoiceService;
use App\Models\PartnerStatementMatch;
use App\Models\PartnerStatementMatchRun;
use App\Services\PartnerStatementImportService;
use App\Services\PartnerStatementMatchService;
use App\Support\SpreadsheetWriter;
use App\Tenancy\TenantContext;
use Illuminate\Database\QueryException;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/**
 * IMP-PS-A2c — تشغيل المطابقة تحت **تزامن حقيقي** (PostgreSQL + `pcntl_fork`): ستة متسابقين على مقارنة واحدة بدفتر واحد ⇒ تشغيلة واحدة ونتائجها مرة واحدة والبقية `replayed`
 * بلا خطأ قاعدة (القفل الاستشاري + الفهرس الفريد)؛ ومقارنتان مختلفتان تنجحان معاً. على SQLite يُتجاهل؛ غياب pcntl على PostgreSQL **فشل لا تخطٍّ**.
 * تشغيل: php artisan test --filter=PartnerStatementMatchConcurrencyPostgresTest
 */
class PartnerStatementMatchConcurrencyPostgresTest extends TestCase
{
    use InteractsWithApi;
    use UsesWorkerDatabaseWithoutTransaction;

    private string $dir;

    private string $tenantId;

    private string $userId;

    private string $partnerId;

    protected function setUp(): void
    {
        parent::setUp();
        if (DB::connection()->getDriverName() !== 'pgsql') {
            $this->markTestSkipped('يتطلب PostgreSQL حقيقياً.');
        }
        $this->assertTrue(function_exists('pcntl_fork') && function_exists('posix_kill'), 'pcntl/posix مطلوبان لاختبارات تزامن PostgreSQL؛ غيابهما فشل لا تخطٍّ.');

        $this->dir = sys_get_temp_dir().'/ps_a2c_race_'.uniqid();
        mkdir($this->dir);
        $auth = $this->registerTenant('ps-race-'.substr(md5((string) microtime(true)), 0, 8), 'ps'.uniqid().'@race.test');
        $this->tenantId = $auth['tenant_id'];
        app(TenantContext::class)->set($this->tenantId);
        $this->userId = (string) User::query()->where('tenant_id', $this->tenantId)->value('id');
        $this->partnerId = Partner::create(['type' => 'customer', 'entity_type' => 'commercial', 'name' => 'عميل التزامن', 'is_active' => true])->id;
    }

    protected function tearDown(): void
    {
        if (isset($this->dir) && is_dir($this->dir)) {
            foreach (glob($this->dir.'/*') ?: [] as $f) {
                @unlink($f);
            }
            @rmdir($this->dir);
        }
        if (DB::connection()->getDriverName() === 'pgsql' && isset($this->tenantId)) {
            try {
                DB::table('tenants')->where('id', $this->tenantId)->delete();
            } catch (QueryException) {
            }
        }
        parent::tearDown();
    }

    private function reconciliation(string $name, array $credits): string
    {
        $path = $this->dir.'/'.$name;
        file_put_contents($path, SpreadsheetWriter::csv(['التاريخ', 'رقم المستند', 'مدين', 'دائن'], array_map(fn (string $c): array => ['2026-09-01', '', '', $c], $credits)));
        $options = ['partner_id' => $this->partnerId, 'role' => 'customer', 'period_from' => '2026-09-01', 'period_to' => '2026-09-30'];

        return app(PartnerStatementImportService::class)->apply(new UploadedFile($path, $name, 'text/csv', null, true), $options, $this->userId)['reconciliation_id'];
    }

    /** @return list<callable> */
    private function racers(int $n, string $reconciliationId): array
    {
        $jobs = [];
        foreach (range(1, $n) as $i) {
            $jobs[] = function () use ($reconciliationId) {
                app(TenantContext::class)->set($this->tenantId);
                $user = User::query()->findOrFail($this->userId);
                auth()->setUser($user);

                // نافذة المعاملة عريضة عمداً ليتداخل المتسابقون فعلاً.
                $result = DB::transaction(function () use ($user, $reconciliationId) {
                    $result = app(PartnerStatementMatchService::class)->run($user, $reconciliationId);
                    usleep(60_000);

                    return $result;
                });

                return ['id' => $result['id'], 'replayed' => $result['replayed']];
            };
        }

        return $jobs;
    }

    private function seedLedger(): void
    {
        $invoices = app(InvoiceService::class);
        $invoices->post($invoices->create(['partner_id' => $this->partnerId, 'payment_type' => 'credit', 'invoice_date' => '2026-09-01'], [['quantity' => 1, 'unit_price' => 100000, 'tax_rate' => 15]]));
    }

    /** @test */
    public function racing_runs_of_the_same_reconciliation_yield_one_run_and_replays_for_the_rest(): void
    {
        $this->seedLedger();
        $id = $this->reconciliation('same.csv', ['1150.00']);

        $results = $this->runConcurrently($this->racers(6, $id));

        app(TenantContext::class)->set($this->tenantId);
        $this->assertSame(1, PartnerStatementMatchRun::query()->count(), json_encode($results, JSON_UNESCAPED_UNICODE));
        $this->assertSame(2, PartnerStatementMatch::query()->count(), 'نتائج التشغيلة مرة واحدة (سطر كشف + وحدة دفترية).');
        $this->assertCount(6, array_filter($results, fn ($r) => ($r['ok'] ?? false) === true), json_encode($results, JSON_UNESCAPED_UNICODE));
        $values = array_column($results, 'value');
        $this->assertCount(1, array_unique(array_column($values, 'id')));
        $this->assertCount(1, array_filter($values, fn ($v) => $v['replayed'] === false), 'فائزٌ واحد فقط يُنشئ.');
    }

    /** @test */
    public function racing_runs_of_different_reconciliations_all_succeed_independently(): void
    {
        $this->seedLedger();
        $jobs = [];
        foreach (['a' => ['1150.00'], 'b' => ['1150.00', '5.00'], 'c' => ['9.00'], 'd' => ['1150.00', '7.00', '3.00']] as $name => $credits) {
            $jobs = array_merge($jobs, $this->racers(1, $this->reconciliation("{$name}.csv", $credits)));
        }

        $results = $this->runConcurrently($jobs);

        app(TenantContext::class)->set($this->tenantId);
        $this->assertCount(4, array_filter($results, fn ($r) => ($r['ok'] ?? false) === true), json_encode($results, JSON_UNESCAPED_UNICODE));
        $this->assertSame(4, PartnerStatementMatchRun::query()->count());
        $this->assertSame(array_sum([1 + 1, 2 + 1, 1 + 1, 3 + 1]), PartnerStatementMatch::query()->count(), 'لكل مقارنة سطورها + وحدة الدفتر.');
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
                DB::connection()->getPdo();
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
            $results[$i] = json_decode(is_file($file) ? (string) file_get_contents($file) : '{"ok":false,"message":"no output"}', true);
        }

        return $results;
    }
}
