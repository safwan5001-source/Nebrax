<?php

namespace Tests\Feature;

use App\Models\Partner;
use App\Models\PartnerStatementLine;
use App\Models\PartnerStatementReconciliation;
use App\Models\User;
use App\Services\PartnerStatementImportService;
use App\Support\SpreadsheetWriter;
use App\Tenancy\TenantContext;
use Illuminate\Database\QueryException;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/**
 * IMP-PS-A1 — إعادة رفع الملف نفسه تحت **تزامن حقيقي** (PostgreSQL + `pcntl_fork`): ستة متسابقين على كشف واحد لهوية واحدة ⇒ مقارنة واحدة وسطورها مرة واحدة، والبقية `replayed`
 * بلا أي خطأ قاعدة. القفل الاستشاري يسلسل الفحص والإدراج (والفهرس الفريد شبكة أخيرة). على SQLite يُتجاهل؛ غياب pcntl على PostgreSQL **فشل لا تخطٍّ**.
 * تشغيل: php artisan test --filter=PartnerStatementImportConcurrencyPostgresTest
 */
class PartnerStatementImportConcurrencyPostgresTest extends TestCase
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

        $this->dir = sys_get_temp_dir().'/ps_a1_race_'.uniqid();
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

    private function csv(string $name, int $debit): string
    {
        $path = $this->dir.'/'.$name;
        file_put_contents($path, SpreadsheetWriter::csv(['التاريخ', 'رقم المستند', 'مدين', 'دائن'], [['2026-09-01', 'INV-1', (string) $debit, ''], ['2026-09-02', 'PAY-1', '', '5']]));

        return $path;
    }

    /** @return list<callable> */
    private function racers(int $n, string $path): array
    {
        $jobs = [];
        foreach (range(1, $n) as $i) {
            $jobs[] = function () use ($path) {
                app(TenantContext::class)->set($this->tenantId);
                $file = new UploadedFile($path, 'statement.csv', 'text/csv', null, true);
                $options = ['partner_id' => $this->partnerId, 'role' => 'customer', 'period_from' => '2026-09-01', 'period_to' => '2026-09-30'];

                // نافذة المعاملة عريضة عمداً ليتداخل المتسابقون فعلاً.
                $result = DB::transaction(function () use ($file, $options) {
                    $result = app(PartnerStatementImportService::class)->apply($file, $options, $this->userId);
                    usleep(60_000);

                    return $result;
                });

                return ['id' => $result['reconciliation_id'], 'replayed' => $result['replayed']];
            };
        }

        return $jobs;
    }

    /** @test */
    public function racing_uploads_of_the_same_file_yield_one_reconciliation_and_replays_for_the_rest(): void
    {
        $results = $this->runConcurrently($this->racers(6, $this->csv('same.csv', 100)));

        app(TenantContext::class)->set($this->tenantId);
        $this->assertSame(1, PartnerStatementReconciliation::query()->count(), json_encode($results, JSON_UNESCAPED_UNICODE));
        $this->assertSame(2, PartnerStatementLine::query()->count(), 'السطور مرة واحدة.');
        $this->assertCount(6, array_filter($results, fn ($r) => ($r['ok'] ?? false) === true), json_encode($results, JSON_UNESCAPED_UNICODE));
        $values = array_column($results, 'value');
        $this->assertCount(1, array_unique(array_column($values, 'id')));
        $this->assertCount(1, array_filter($values, fn ($v) => $v['replayed'] === false), 'فائزٌ واحد فقط يُنشئ.');
    }

    /** @test */
    public function racing_uploads_of_different_content_all_succeed_as_separate_reconciliations(): void
    {
        $jobs = [];
        foreach ([100, 200, 300, 400] as $amount) {
            $jobs = array_merge($jobs, $this->racers(1, $this->csv("c{$amount}.csv", $amount)));
        }

        $results = $this->runConcurrently($jobs);

        app(TenantContext::class)->set($this->tenantId);
        $this->assertCount(4, array_filter($results, fn ($r) => ($r['ok'] ?? false) === true), json_encode($results, JSON_UNESCAPED_UNICODE));
        $this->assertSame(4, PartnerStatementReconciliation::query()->count());
        $this->assertSame(8, PartnerStatementLine::query()->count());
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
