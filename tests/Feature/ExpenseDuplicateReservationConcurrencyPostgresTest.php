<?php

namespace Tests\Feature;

use App\Models\Account;
use App\Models\Expense;
use App\Models\ImportDocumentReservation;
use App\Services\Accounting\ExpenseService;
use App\Services\DocumentDuplicateReservationService as Dup;
use App\Support\DuplicateDocumentException;
use App\Support\Settings;
use App\Tenancy\TenantContext;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/**
 * IMP-H5-S1b — استيراد ضد إنشاء مباشر (سياسة block) ضد استيراد آخر للمصروف نفسه تحت **تزامن حقيقي** (PostgreSQL + `pcntl_fork`):
 * مستندٌ واحد فقط مهما كان الترتيب، والخاسرون يتلقّون `DuplicateDocumentException`. **لا يُتخطّى** إن غاب `pcntl` على PostgreSQL.
 */
class ExpenseDuplicateReservationConcurrencyPostgresTest extends TestCase
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

        $this->dir = sys_get_temp_dir().'/expense_dup_race_'.uniqid();
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

    /** @return array{0: string, 1: string} */
    private function tenantWithAccount(): array
    {
        $auth = $this->registerTenant('exp-'.substr(md5((string) microtime(true)), 0, 8), 'exp'.uniqid().'@pb.test');
        $this->tenants[] = $auth['tenant_id'];
        app(TenantContext::class)->set($auth['tenant_id']);

        return [$auth['tenant_id'], Account::where('code', '5130')->firstOrFail()->id];
    }

    /** @test */
    public function imports_and_direct_creations_of_the_same_expense_yield_exactly_one_document(): void
    {
        [$tenant, $account] = $this->tenantWithAccount();
        Settings::put('finance', ['duplicate_reference_policy' => 'block']);

        $jobs = [];
        foreach (range(1, 8) as $i) {
            $jobs[] = function () use ($tenant, $account, $i) {
                app(TenantContext::class)->set($tenant);
                $data = ['account_id' => $account, 'amount' => 7700, 'tax_rate' => 15, 'vendor_name' => 'مورّد السباق', 'expense_date' => '2026-10-05'];

                // نصف المتسابقين مستوردون والنصف الآخر إنشاء مباشر تحت block
                return app(ExpenseService::class)->create($data, $i % 2 === 0 ? ['source' => Dup::SOURCE_STANDARD, 'reference' => 'R-1'] : null)->id;
            };
        }

        $results = $this->runConcurrently($jobs);

        app(TenantContext::class)->set($tenant);
        $this->assertSame(1, Expense::query()->count(), json_encode($results, JSON_UNESCAPED_UNICODE));
        $this->assertSame(1, ImportDocumentReservation::query()->count());
        $this->assertCount(1, array_filter($results, fn ($r) => ($r['ok'] ?? false) === true));
        foreach ($results as $r) {
            if (($r['ok'] ?? false) !== true) {
                $this->assertSame(DuplicateDocumentException::class, $r['error_class'] ?? null, json_encode($r, JSON_UNESCAPED_UNICODE));
            }
        }
    }

    /** @test */
    public function an_importer_creating_many_expenses_in_one_transaction_never_deadlocks_with_direct_creates(): void
    {
        [$tenant, $account] = $this->tenantWithAccount();
        Settings::put('finance', ['duplicate_reference_policy' => 'block']);
        $row = fn (int $n): array => ['account_id' => $account, 'amount' => 1000 + $n, 'tax_rate' => 15, 'vendor_name' => 'مورّد متعدد', 'expense_date' => '2026-10-07'];

        $jobs = [];
        // مستوردان يكتبان الصفوف نفسها في معاملة واحدة بترتيبين متعاكسين + منشئان مباشران لصفوف متقاطعة
        foreach ([[1, 2, 3, 4, 5], [5, 4, 3, 2, 1]] as $order) {
            $jobs[] = function () use ($tenant, $order, $row) {
                app(TenantContext::class)->set($tenant);

                return DB::transaction(function () use ($order, $row) {
                    foreach ($order as $n) {
                        app(ExpenseService::class)->create($row($n), ['source' => Dup::SOURCE_STANDARD, 'reference' => "M-{$n}"]);
                        usleep(20_000);
                    }

                    return 'ok';
                });
            };
        }
        foreach ([3, 5] as $n) {
            $jobs[] = function () use ($tenant, $n, $row) {
                app(TenantContext::class)->set($tenant);

                return app(ExpenseService::class)->create($row($n))->id;
            };
        }

        $results = $this->runConcurrently($jobs);

        app(TenantContext::class)->set($tenant);
        foreach ($results as $r) {
            if (($r['ok'] ?? false) !== true) {
                $this->assertSame(DuplicateDocumentException::class, $r['error_class'] ?? null, 'فشلٌ غير متوقع (40P01؟): '.json_encode($r, JSON_UNESCAPED_UNICODE));
            }
        }
        // لا هوية واسعة مكرّرة مهما كان الفائز
        $this->assertSame(Expense::query()->count(), Expense::query()->distinct()->count('amount'));
    }

    /** @test */
    public function a_delete_racing_a_reimport_leaves_no_orphan_reservation(): void
    {
        [$tenant, $account] = $this->tenantWithAccount();
        $data = ['account_id' => $account, 'amount' => 900, 'tax_rate' => 15, 'vendor_name' => 'مورّد الحذف', 'expense_date' => '2026-10-06'];
        $first = app(ExpenseService::class)->create($data + ['number' => 'EXP-D-0'], ['source' => Dup::SOURCE_STANDARD, 'reference' => 'D-1']);

        $jobs = [
            function () use ($tenant, $first) {
                app(TenantContext::class)->set($tenant);
                app(ExpenseService::class)->discardDraft(Expense::query()->findOrFail($first->id));

                return 'deleted';
            },
            function () use ($tenant, $account, $data) {
                app(TenantContext::class)->set($tenant);

                return app(ExpenseService::class)->create($data + ['number' => 'EXP-D-1'], ['source' => Dup::SOURCE_STANDARD, 'reference' => 'D-1'])->id;
            },
        ];
        $results = $this->runConcurrently($jobs);

        app(TenantContext::class)->set($tenant);
        // كل حجز قائم يقابله مصروف موجود، وكل مصروف مستورد محجوز: لا يتيم في أي ترتيب.
        $ids = Expense::query()->pluck('id')->all();
        foreach (ImportDocumentReservation::query()->get() as $r) {
            $this->assertContains($r->document_id, $ids, 'حجز يتيم: '.json_encode($results, JSON_UNESCAPED_UNICODE));
        }
        $this->assertSame(count($ids), ImportDocumentReservation::query()->count(), json_encode($results, JSON_UNESCAPED_UNICODE));
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
