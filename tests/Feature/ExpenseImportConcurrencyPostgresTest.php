<?php

namespace Tests\Feature;

use App\Models\Expense;
use App\Models\ImportDocumentReservation;
use App\Services\Accounting\ExpenseService;
use App\Services\DocumentDuplicateReservationService as Dup;
use App\Services\ExpenseImportService;
use App\Support\DuplicateDocumentException;
use App\Support\ImportUnitFailureException;
use App\Support\SpreadsheetWriter;
use App\Tenancy\TenantContext;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/**
 * IMP-H5-S1c — مستورد المصروفات تحت **تزامن حقيقي** (PostgreSQL + `pcntl_fork`): مستوردون متسابقون على الصف نفسه، تكرار مؤكَّد بنطاق واحد، ومستوردان بترتيبين متعاكسين
 * لا يتجمّدان. مصروفٌ واحد فقط لكل هوية، والخاسرون يتلقّون `ImportUnitFailureException` مسمّاً. **لا يُتخطّى** إن غاب `pcntl` على PostgreSQL.
 */
class ExpenseImportConcurrencyPostgresTest extends TestCase
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
            $this->markTestSkipped('يتطلب PostgreSQL حقيقياً.');
        }
        $this->assertTrue(function_exists('pcntl_fork') && function_exists('posix_kill'), 'pcntl/posix مطلوبان لاختبارات تزامن PostgreSQL؛ غيابهما فشل لا تخطٍّ.');

        $this->dir = sys_get_temp_dir().'/expense_import_race_'.uniqid();
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

    private function tenant(): string
    {
        $auth = $this->registerTenant('imp-'.substr(md5((string) microtime(true)), 0, 8), 'imp'.uniqid().'@pb.test');
        $this->tenants[] = $auth['tenant_id'];
        app(TenantContext::class)->set($auth['tenant_id']);

        return $auth['tenant_id'];
    }

    /** @param list<array<string,string>> $rows */
    private function csv(array $rows): UploadedFile
    {
        $keys = array_keys($rows[0]);

        return UploadedFile::fake()->createWithContent('e.csv', SpreadsheetWriter::csv($keys, array_map(fn (array $r): array => array_values($r), $rows)));
    }

    private function row(int $n): array
    {
        return ['expense_date' => '2026-10-07', 'amount' => (string) (10 + $n), 'account_code' => '5130', 'vendor_name' => 'مورّد متسابق'];
    }

    /** @param array<int, array<string, mixed>> $results */
    private function assertLosersAreNamedFailures(array $results): void
    {
        foreach ($results as $r) {
            if (($r['ok'] ?? false) !== true) {
                $this->assertSame(ImportUnitFailureException::class, $r['error_class'] ?? null, 'فشلٌ غير متوقع (40P01؟): '.json_encode($r, JSON_UNESCAPED_UNICODE));
            }
        }
    }

    /** @test */
    public function racing_importers_of_the_same_row_create_exactly_one_expense(): void
    {
        $tenant = $this->tenant();

        $jobs = [];
        foreach (range(1, 6) as $unused) {
            $jobs[] = function () use ($tenant) {
                app(TenantContext::class)->set($tenant);

                return app(ExpenseImportService::class)->apply($this->csv([$this->row(1)]), [], null)['created'];
            };
        }
        $results = $this->runConcurrently($jobs);

        app(TenantContext::class)->set($tenant);
        $this->assertSame(1, Expense::query()->count(), json_encode($results, JSON_UNESCAPED_UNICODE));
        $this->assertSame(1, ImportDocumentReservation::query()->count());
        $this->assertCount(1, array_filter($results, fn ($r) => ($r['ok'] ?? false) === true));
        $this->assertLosersAreNamedFailures($results);
    }

    /** @test */
    public function racing_replays_of_one_confirmed_repeat_with_the_same_scope_create_exactly_one_expense(): void
    {
        $tenant = $this->tenant();

        $jobs = [];
        foreach (range(1, 6) as $unused) {
            $jobs[] = function () use ($tenant) {
                app(TenantContext::class)->set($tenant);

                return app(ExpenseImportService::class)->apply($this->csv([$this->row(2)]), ['confirmed_repeat_rows' => [2], 'occurrence_scope' => 'job-X'], null)['created'];
            };
        }
        $results = $this->runConcurrently($jobs);

        app(TenantContext::class)->set($tenant);
        $this->assertSame(1, Expense::query()->count(), json_encode($results, JSON_UNESCAPED_UNICODE));
        $this->assertCount(1, array_filter($results, fn ($r) => ($r['ok'] ?? false) === true));
        $this->assertLosersAreNamedFailures($results);
    }

    /** @test */
    public function importers_with_opposite_row_order_and_a_direct_creator_never_deadlock(): void
    {
        $tenant = $this->tenant();
        $account = \App\Models\Account::where('code', '5130')->firstOrFail()->id;

        $jobs = [];
        foreach ([[1, 2, 3, 4, 5], [5, 4, 3, 2, 1]] as $order) {
            $jobs[] = function () use ($tenant, $order) {
                app(TenantContext::class)->set($tenant);

                return app(ExpenseImportService::class)->apply($this->csv(array_map(fn (int $n): array => $this->row($n), $order)), [], null)['created'];
            };
        }
        $jobs[] = function () use ($tenant, $account) {
            app(TenantContext::class)->set($tenant);

            return app(ExpenseService::class)->create(['account_id' => $account, 'amount' => 9900, 'tax_rate' => 15, 'vendor_name' => 'مورّد متسابق', 'expense_date' => '2026-10-07'])->id;
        };
        $results = $this->runConcurrently($jobs);

        app(TenantContext::class)->set($tenant);
        foreach ($results as $r) {
            if (($r['ok'] ?? false) !== true) {
                $this->assertContains($r['error_class'] ?? null, [ImportUnitFailureException::class, DuplicateDocumentException::class], 'فشلٌ غير متوقع (40P01؟): '.json_encode($r, JSON_UNESCAPED_UNICODE));
            }
        }
        $this->assertSame(Expense::query()->count(), Expense::query()->distinct()->count('amount'), 'لا هوية واسعة مكرّرة مهما كان الفائز.');
        // المستوردان يكتبان الصفوف الخمسة نفسها: واحدٌ ينجح كاملاً والآخر يفشل كاملاً (قطعة ذرّية)، والمنشئ المباشر مصروفه مستقل ⇒ ستة بالضبط.
        $this->assertSame(6, Expense::query()->count(), json_encode($results, JSON_UNESCAPED_UNICODE));
        $this->assertCount(2, array_filter($results, fn ($r) => ($r['ok'] ?? false) === true));
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
            $raw = is_file($file) ? file_get_contents($file) : false;
            $results[$i] = json_decode($raw !== false ? $raw : '{"ok":false,"message":"no output"}', true);
        }

        return $results;
    }
}
