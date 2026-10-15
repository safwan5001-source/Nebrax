<?php

namespace Tests\Feature;

use App\Models\Account;
use App\Models\FiscalYear;
use App\Models\FiscalYearClose;
use App\Models\JournalEntry;
use App\Models\JournalLine;
use App\Models\Tenant;
use App\Services\Accounting\ChartOfAccountsSeeder;
use App\Support\FiscalCloseJournals;
use App\Services\Accounting\FiscalCloseService;
use App\Services\Accounting\FiscalYearClosedException;
use App\Services\Accounting\FiscalYearService;
use App\Services\Accounting\LedgerService;
use App\Tenancy\BranchContext;
use App\Tenancy\TenantContext;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/**
 * FC-3 — تزامن الإقفال/الفتح مع ترحيلٍ مؤرَّخ داخل السنة على PostgreSQL بعمليتين حقيقيتين (`pcntl_fork`).
 *
 * الإقفال والفتح والترحيل كلها تقفل صفّ المستأجر أولاً فتتسلسل. فحص «سنة مقفلة» في `AccountingDateGuard` يجري
 * **بعد** ذلك القفل، فيرى في READ COMMITTED آخر حالةٍ مودَعة. النتيجة المقبولة لكل جولة واحدةٌ من اثنتين فقط:
 *
 *  - إقفال ↔ ترحيل: إمّا رُحّل القيد قبل الإقفال فدخل حساب الجيل (إيراد الجيل = إيراد الدفتر داخل السنة)،
 *    وإمّا رُفض بـ`FiscalYearClosedException` بلا أثر. لا قيدَ داخل سنةٍ مقفلة خارج نتيجة جيلها.
 *  - فتح ↔ ترحيل: إمّا رُفض قبل الفتح، وإمّا قُبل بعده والسنة مفتوحة.
 *
 * وفي الحالتين: لا جمود (40P01)، ولا مهلة قفل، ولا قيد غير متوازن.
 *
 * لا يعمل إلا على PostgreSQL حقيقي. تشغيل: php artisan test --filter=FiscalYearClosedPostingPostgresTest
 */
class FiscalYearClosedPostingPostgresTest extends TestCase
{
    private Tenant $tenant;
    private string $dir;
    private string $yearId;

    /** @var list<string> */
    private array $tenantsToPurge = [];

    protected function setUp(): void
    {
        parent::setUp();

        if (DB::connection()->getDriverName() !== 'pgsql') {
            $this->markTestSkipped('يتطلب PostgreSQL حقيقياً — SQLite لا يُظهر تنافساً على أقفال الصفوف.');
        }
        if (! function_exists('pcntl_fork')) {
            $this->markTestSkipped('امتداد pcntl غير متاح في هذه البيئة.');
        }

        $this->dir = sys_get_temp_dir().'/fc3_'.uniqid();
        mkdir($this->dir);

        $this->tenant = Tenant::create([
            'name' => 'نبراس fc3', 'slug' => 'fc3-'.uniqid(),
            'vat_number' => '300000000000003', 'currency' => 'SAR',
        ]);
        $this->tenantsToPurge[] = $this->tenant->id;
        app(TenantContext::class)->set($this->tenant->id);
        app(BranchContext::class)->forget();
        app(ChartOfAccountsSeeder::class)->seed($this->tenant->id);

        $this->yearId = app(FiscalYearService::class)->create(
            ['name' => '2026', 'start_date' => '2026-01-01', 'end_date' => '2026-12-31'], null
        )['id'];
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
            foreach ($this->tenantsToPurge as $id) {
                $this->purgeTenant($id);
            }
        }

        parent::tearDown();
    }

    private function purgeTenant(string $tenantId): void
    {
        DB::statement(
            'DELETE FROM journal_lines WHERE journal_entry_id IN (SELECT id FROM journal_entries WHERE tenant_id = ?)',
            [$tenantId]
        );
        $tables = array_map(
            fn ($row) => $row->table_name,
            DB::select("SELECT table_name FROM information_schema.columns WHERE table_schema = current_schema() AND column_name = 'tenant_id'")
        );
        for ($pass = 0; $pass < 8; $pass++) {
            $remaining = 0;
            foreach ($tables as $table) {
                try {
                    DB::table($table)->where('tenant_id', $tenantId)->delete();
                } catch (QueryException) {
                    $remaining++;
                }
            }
            if ($remaining === 0) {
                break;
            }
        }
        DB::table('tenants')->where('id', $tenantId)->delete();
    }

    /**
     * @param  list<callable(): mixed>  $jobs
     * @return list<array{ok: bool, error_class?: string, message?: string, value?: mixed}>
     */
    private function runConcurrently(array $jobs): array
    {
        $barrier = $this->dir.'/barrier';
        @unlink($barrier);
        $resultFiles = [];
        $pids = [];

        foreach ($jobs as $i => $job) {
            $resultFiles[$i] = $this->dir."/result_{$i}";
            @unlink($resultFiles[$i]);
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
                    file_put_contents($resultFiles[$i], json_encode([
                        'ok' => false, 'error_class' => get_class($e), 'message' => $e->getMessage(),
                    ]));
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

    private function accountId(string $code): string
    {
        return Account::where('code', $code)->firstOrFail()->id;
    }

    /** مهمة ترحيل إيراد داخل السنة من عملية مستقلة؛ تُعيد رقم القيد. */
    private function postJob(string $date, int $amount): callable
    {
        $tenantId = $this->tenant->id;
        $debit = $this->accountId('1130');
        $credit = $this->accountId('4110');

        return function () use ($tenantId, $debit, $credit, $date, $amount) {
            app(TenantContext::class)->set($tenantId);
            app(BranchContext::class)->forget();

            return app(LedgerService::class)->post([
                ['account_id' => $debit, 'debit' => $amount],
                ['account_id' => $credit, 'credit' => $amount],
            ], ['entry_date' => $date, 'branch_id' => null])->id;
        };
    }

    private function inProcess(callable $job): callable
    {
        $tenantId = $this->tenant->id;

        return function () use ($tenantId, $job) {
            app(TenantContext::class)->set($tenantId);
            app(BranchContext::class)->forget();

            return $job();
        };
    }

    /** إيراد الدفتر داخل السنة باستثناء قيود الإقفال وعكسها — ما يجب أن يحسبه أي جيل إقفال. */
    private function ordinaryRevenueIn2026(): int
    {
        return (int) JournalLine::query()
            ->where('account_id', $this->accountId('4110'))
            ->whereHas('entry', function ($q) {
                $q->whereIn('status', ['posted', 'reversed'])
                    ->whereDate('entry_date', '>=', '2026-01-01')->whereDate('entry_date', '<=', '2026-12-31');
                FiscalCloseJournals::exclude($q);
            })
            ->sum('credit');
    }

    private function assertNoLockFailure(array $r): void
    {
        $message = (string) ($r['message'] ?? '');
        $this->assertStringNotContainsString('40P01', $message, 'جمود: '.$message);
        $this->assertStringNotContainsString('55P03', $message, 'مهلة قفل: '.$message);
        $this->assertStringNotContainsString('deadlock', strtolower($message));
    }

    private function assertBooksBalanced(): void
    {
        $this->assertSame((int) JournalLine::sum('debit'), (int) JournalLine::sum('credit'));
        foreach (JournalEntry::with('lines')->get() as $entry) {
            $this->assertSame((int) $entry->lines->sum('debit'), (int) $entry->lines->sum('credit'));
        }
    }

    /** @test */
    public function a_close_racing_a_backdated_post_either_includes_it_in_the_generation_or_rejects_it(): void
    {
        // نشاط أساسي كي يُنشئ الإقفال قيداً فعلياً.
        $this->postJob('2026-03-01', 100000)();

        $rounds = 6;
        $accepted = $rejected = 0;

        for ($i = 0; $i < $rounds; $i++) {
            $yearId = $this->yearId;
            $results = $this->runConcurrently([
                $this->inProcess(fn () => app(FiscalCloseService::class)->close($yearId, null)['status']),
                $this->postJob('2026-12-31', 1000 + $i),
            ]);

            [$close, $post] = $results;
            $this->assertNoLockFailure($close);
            $this->assertNoLockFailure($post);
            $this->assertTrue($close['ok'], 'فشل الإقفال: '.json_encode($close, JSON_UNESCAPED_UNICODE));
            $this->assertSame(FiscalYear::STATUS_CLOSED, $close['value']);

            if ($post['ok']) {
                $accepted++;
            } else {
                $this->assertSame(FiscalYearClosedException::class, $post['error_class'], json_encode($post, JSON_UNESCAPED_UNICODE));
                $rejected++;
            }

            // الثابت الحاسم: الجيل النشط يحسب كل إيرادٍ عادي داخل السنة — لا قيدَ تسلّل بعد الحساب.
            $generation = FiscalYearClose::query()
                ->where('fiscal_year_id', $yearId)->where('status', FiscalYearClose::STATUS_ACTIVE)->sole();
            $this->assertSame($this->ordinaryRevenueIn2026(), (int) $generation->total_revenue, "الجولة {$i}");
            $this->assertSame(FiscalYear::STATUS_CLOSED, FiscalYear::findOrFail($yearId)->status);
            $this->assertBooksBalanced();

            // سنةٌ مقفلة الآن: ترحيلٌ لاحق يُرفض حتماً.
            $late = $this->runConcurrently([$this->postJob('2026-06-30', 7)]);
            $this->assertFalse($late[0]['ok']);
            $this->assertSame(FiscalYearClosedException::class, $late[0]['error_class']);

            app(FiscalCloseService::class)->reopen($yearId, "جولة {$i}", null);
        }

        $this->assertSame($rounds, $accepted + $rejected);
        $this->assertSame($rounds, FiscalYearClose::where('fiscal_year_id', $this->yearId)->count());
    }

    /** @test */
    public function a_reopen_racing_a_backdated_post_either_rejects_it_before_or_accepts_it_after(): void
    {
        $this->postJob('2026-03-01', 100000)();

        $rounds = 6;
        $accepted = $rejected = 0;

        for ($i = 0; $i < $rounds; $i++) {
            app(FiscalCloseService::class)->close($this->yearId, null);
            $before = $this->ordinaryRevenueIn2026();

            $yearId = $this->yearId;
            $results = $this->runConcurrently([
                $this->inProcess(fn () => app(FiscalCloseService::class)->reopen($yearId, "فتح {$i}", null)['status']),
                $this->postJob('2026-01-01', 2000 + $i),
            ]);

            [$reopen, $post] = $results;
            $this->assertNoLockFailure($reopen);
            $this->assertNoLockFailure($post);
            $this->assertTrue($reopen['ok'], 'فشل الفتح: '.json_encode($reopen, JSON_UNESCAPED_UNICODE));
            $this->assertSame(FiscalYear::STATUS_OPEN, $reopen['value']);

            if ($post['ok']) {
                $accepted++;
                $this->assertSame($before + 2000 + $i, $this->ordinaryRevenueIn2026());
            } else {
                $this->assertSame(FiscalYearClosedException::class, $post['error_class'], json_encode($post, JSON_UNESCAPED_UNICODE));
                $rejected++;
                $this->assertSame($before, $this->ordinaryRevenueIn2026());
            }

            $this->assertSame(FiscalYear::STATUS_OPEN, FiscalYear::findOrFail($yearId)->status);
            $this->assertSame(0, FiscalYearClose::where('fiscal_year_id', $yearId)->where('status', FiscalYearClose::STATUS_ACTIVE)->count());
            $this->assertBooksBalanced();
        }

        $this->assertSame($rounds, $accepted + $rejected);
    }
}
