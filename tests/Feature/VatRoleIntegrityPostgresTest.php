<?php

namespace Tests\Feature;

use App\Models\Account;
use App\Models\AccountRoleMapping;
use App\Models\AccountRoleMappingEvent;
use App\Models\JournalLine;
use App\Models\Tenant;
use App\Services\Accounting\AccountRoutingService;
use App\Services\Accounting\ChartOfAccountsSeeder;
use App\Services\Accounting\LedgerService;
use App\Tenancy\BranchContext;
use App\Tenancy\TenantContext;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/**
 * REM-05 / ACC-01 — تزامن تعيينات الأدوار الضريبية على PostgreSQL.
 *
 * عمليتان حقيقيتان (`pcntl_fork`، لكلٍّ اتصالها) تتنافسان على الحساب نفسه. الضمان: تُفحص الأهلية
 * بعد قفل صفّ المستأجر وداخل المعاملة، فالمعاملة الثانية ترى التعيين الذي أتمّته الأولى ⇒ يفوز واحد فقط
 * ويُرفض الآخر بـ422-سبب (RuntimeException)، ولا يبقى الحساب في دورين متعارضين.
 *
 * لا يعمل إلا على PostgreSQL حقيقي (يُتجاهل على SQLite لعدم وجود أقفال صفوف).
 * تشغيل: php artisan test --filter=VatRoleIntegrityPostgresTest
 */
class VatRoleIntegrityPostgresTest extends TestCase
{
    private Tenant $tenant;
    private string $dir;

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

        $this->dir = sys_get_temp_dir().'/rem05_'.uniqid();
        mkdir($this->dir);
        $this->tenant = $this->makeTenant('rem05-a-');
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

    private function makeTenant(string $prefix): Tenant
    {
        $tenant = Tenant::create([
            'name' => 'نبراس '.$prefix, 'slug' => $prefix.uniqid(),
            'vat_number' => '300000000000003', 'currency' => 'SAR',
        ]);
        $this->tenantsToPurge[] = $tenant->id;
        app(TenantContext::class)->set($tenant->id);
        app(BranchContext::class)->forget();
        app(ChartOfAccountsSeeder::class)->seed($tenant->id);

        return $tenant;
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
        $resultFiles = [];
        $pids = [];

        foreach ($jobs as $i => $job) {
            $resultFiles[$i] = $this->dir."/result_{$i}";
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

    private function asset(string $code): Account
    {
        return Account::create([
            'tenant_id' => $this->tenant->id, 'code' => $code, 'name' => "حساب {$code}", 'type' => 'asset',
            'normal_balance' => 'debit', 'is_group' => false, 'is_active' => true,
        ]);
    }

    private function mapJob(string $role, string $accountId): callable
    {
        $tenantId = $this->tenant->id;

        return function () use ($tenantId, $role, $accountId) {
            app(TenantContext::class)->set($tenantId);
            app(BranchContext::class)->forget();
            app(AccountRoutingService::class)->setMapping($role, $accountId, null);

            return 'mapped';
        };
    }

    /** @test */
    public function two_roles_racing_for_one_account_exactly_one_wins_and_no_deadlock_occurs(): void
    {
        for ($round = 0; $round < 5; $round++) {
            $account = $this->asset('881'.$round);
            // tax_input (دور ضريبي) مقابل purchase_expense (دور آخر) على الحساب نفسه.
            $results = $this->runConcurrently([
                $this->mapJob('tax_input', $account->id),
                $this->mapJob('purchase_expense', $account->id),
            ]);

            $wins = collect($results)->where('ok', true)->count();
            $this->assertSame(1, $wins, 'يجب أن يفوز تعيين واحد فقط: '.json_encode($results, JSON_UNESCAPED_UNICODE));
            foreach (collect($results)->where('ok', false) as $failure) {
                $this->assertStringNotContainsString('40P01', (string) $failure['message']);
                $this->assertStringNotContainsStringIgnoringCase('deadlock', (string) $failure['message']);
                $this->assertSame(\App\Services\Accounting\VatRoleMappingException::class, $failure["error_class"]);
            }

            // لا يوجد حساب في دورين: مرة واحدة فقط ضمن التعيينات الحالية.
            $this->assertSame(1, AccountRoleMapping::where('account_id', $account->id)->count());

            // نعيد الأدوار إلى وضعها قبل الجولة التالية.
            app(AccountRoutingService::class)->reset('tax_input', null);
            app(AccountRoutingService::class)->reset('purchase_expense', null);
        }
    }

    /** @test */
    public function a_mapping_racing_a_ledger_post_to_the_same_clean_account_is_serialised(): void
    {
        $account = $this->asset('8890');
        $cash = Account::where('code', '3110')->firstOrFail();
        $tenantId = $this->tenant->id;
        $accountId = $account->id;
        $cashId = $cash->id;

        $postJob = function () use ($tenantId, $accountId, $cashId) {
            app(TenantContext::class)->set($tenantId);
            app(BranchContext::class)->forget();
            app(LedgerService::class)->post([
                ['account_id' => $accountId, 'debit' => 1000],
                ['account_id' => $cashId, 'credit' => 1000],
            ], ['entry_date' => '2026-01-05']);

            return 'posted';
        };

        $results = $this->runConcurrently([$this->mapJob('tax_input', $account->id), $postJob]);

        // النتيجة مقبولة في كلا الترتيبين، لكن لا يجوز أن تُترك حالة غير متسقة:
        // إن فاز التعيين أولاً فالحركة لاحقة ⇒ الحساب نظيف عند الربط؛ وإن فازت الحركة أولاً فالتعيين مرفوض.
        $mapped = AccountRoleMapping::where('role_key', 'tax_input')->value('account_id') === $account->id;
        $posted = JournalLine::where('account_id', $account->id)->exists();
        $this->assertTrue($posted, 'القيد يجب أن يُرحَّل في الحالتين');
        $mapResult = $results[0];
        if ($mapped) {
            $this->assertTrue($mapResult['ok']);
            $event = AccountRoleMappingEvent::where('role_key', 'tax_input')->where('new_account_id', $account->id)->firstOrFail();
            $firstLine = DB::table('journal_lines as l')->join('journal_entries as e', 'e.id', '=', 'l.journal_entry_id')
                ->where('l.account_id', $account->id)->min('e.created_at');
            $this->assertLessThanOrEqual(strtotime((string) $firstLine) + 1, strtotime((string) $event->created_at), 'الربط سابق لأول حركة على الحساب');
        } else {
            $this->assertFalse($mapResult['ok']);
            $this->assertStringContainsString('حركات', (string) $mapResult['message']);
        }
    }
}
