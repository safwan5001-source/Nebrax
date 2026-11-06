<?php

namespace Tests\Feature;

use App\Models\Account;
use App\Models\Tenant;
use App\Services\Accounting\ChartOfAccountsSeeder;
use App\Services\Accounting\LedgerService;
use App\Tenancy\TenantContext;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use PDO;
use Tests\TestCase;

/**
 * CUR-1 — سباق حقيقي بين عمليتين (pcntl_fork) على PostgreSQL: «تغيير عملة المؤسسة» ↔ «ترحيل قيد».
 *
 * لماذا صنف منفصل عن `CompanyCurrencyProtectionPostgresTest`؟ ذاك يثبت **الانتظار** بمهلة قفل؛ لكنه لا يميّز «قفل ثم فحص»
 * عن «فحص ثم كتابة» (الثانية تنتظر أيضاً عند `UPDATE`). الفرق الجوهري لا يظهر إلا حين **ينتهي الانتظار فعلاً**: هنا يُودِع
 * المنافس قيده والطلب الحقيقي لا يزال معلّقاً، فيجب أن يُرفض الطلب لا أن يكمل بعملة جديدة فوق قيد مرحّل.
 *
 * الأسس ثابتة بلا معاملة مُغلِّفة (`UsesWorkerDatabaseWithoutTransaction`) لأن العمليات الفرعية تحتاج صفوفاً مثبَّتة.
 * على PostgreSQL لا يُتخطّى هذا الصنف إن غاب pcntl: يفشل. يُتخطّى على SQLite فقط.
 *
 * تشغيل: php artisan test --filter=CompanyCurrencyRacePostgresTest
 */
class CompanyCurrencyRacePostgresTest extends TestCase
{
    use UsesWorkerDatabaseWithoutTransaction;

    private string $dir = '';

    /** @var list<string> */
    private array $tenants = [];

    private ?PDO $rival = null;

    protected function setUp(): void
    {
        parent::setUp();

        if (DB::connection()->getDriverName() !== 'pgsql') {
            $this->markTestSkipped('يتطلب PostgreSQL حقيقياً — SQLite لا يُظهر تنافساً على أقفال الصفوف.');
        }
        $this->assertTrue(function_exists('pcntl_fork') && function_exists('posix_kill'),
            'pcntl/posix مطلوبان لاختبارات تزامن PostgreSQL؛ غيابهما فشل لا تخطٍّ.');

        $this->dir = sys_get_temp_dir().'/cur1_race_'.uniqid();
        mkdir($this->dir);
    }

    protected function tearDown(): void
    {
        if ($this->rival !== null) {
            try {
                $this->rival->exec('ROLLBACK');
            } catch (\Throwable) {
            }
        }
        if ($this->dir !== '') {
            foreach (glob($this->dir.'/*') ?: [] as $f) {
                @unlink($f);
            }
            @rmdir($this->dir);
        }
        if (DB::connection()->getDriverName() === 'pgsql') {
            foreach ($this->tenants as $id) {
                DB::table('tenants')->where('id', $id)->delete(); // CASCADE: القيود والسطور والحسابات
            }
        }

        parent::tearDown();
    }

    private function makeTenant(bool $withChart = false): string
    {
        $id = Tenant::create([
            'name' => 'مستأجر سباق العملة', 'slug' => 'cur1-race-'.Str::random(10),
            'vat_number' => '300000000000003', 'currency' => 'SAR', 'is_active' => true,
        ])->id;
        $this->tenants[] = $id;
        if ($withChart) {
            app(TenantContext::class)->set($id);
            app(ChartOfAccountsSeeder::class)->seed($id);
        }

        return $id;
    }

    private function rival(): PDO
    {
        if ($this->rival === null) {
            $c = config('database.connections.pgsql');
            $this->rival = new PDO(
                sprintf('pgsql:host=%s;port=%s;dbname=%s', $c['host'], $c['port'], $c['database']),
                $c['username'], $c['password'], [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION],
            );
        }

        return $this->rival;
    }

    /** يطلق عملية فرعية تغيّر العملة عبر مسار HTTP الحقيقي (بلا وسطاء)، وتكتب نتيجتها في ملف ثم تموت بلا destructors. */
    private function forkChange(string $tenant, string $currency, string $tag, ?string $barrier = null): int
    {
        $out = $this->dir."/change_{$tag}.json";
        $pid = pcntl_fork();
        $this->assertNotSame(-1, $pid, 'pcntl_fork');
        if ($pid === 0) {
            DB::purge(config('database.default'));
            app(TenantContext::class)->set($tenant);
            $result = ['status' => 0, 'reason' => null, 'error' => null];
            try {
                if ($barrier !== null) {
                    $this->waitFor($barrier, 10.0);
                }
                $response = $this->withoutMiddleware()->putJson('/api/company', ['name' => 'شركة السباق', 'currency' => $currency, 'city' => 'الخبر']);
                $result['status'] = $response->getStatusCode();
                $result['reason'] = $response->json('reason');
            } catch (\Throwable $e) {
                $result['error'] = get_class($e).': '.$e->getMessage();
            }
            file_put_contents($out, json_encode($result));
            posix_kill(getmypid(), SIGKILL);
            exit(0);
        }

        return $pid;
    }

    /** @return array{status:int,reason:?string,error:?string} */
    private function changeResult(string $tag): array
    {
        $f = $this->dir."/change_{$tag}.json";
        $this->assertFileExists($f, "لا نتيجة للعملية {$tag}");

        return json_decode((string) file_get_contents($f), true);
    }

    private function waitFor(string $file, float $seconds): void
    {
        $deadline = microtime(true) + $seconds;
        while (! file_exists($file) && microtime(true) < $deadline) {
            usleep(1_000);
        }
    }

    /** ينتظر حتى تعلق عملية على قفل صفّ (الطلب الفرعي وصل إلى نقطة الانتظار). */
    private function waitForLockWaiter(int $childPid, string $tag, float $seconds = 15.0): void
    {
        $deadline = microtime(true) + $seconds;
        while (microtime(true) < $deadline) {
            if (pcntl_waitpid($childPid, $status, WNOHANG) === $childPid) {
                $this->fail('الطلب الفرعي انتهى قبل أن ينتظر: '.(string) @file_get_contents($this->dir."/change_{$tag}.json"));
            }
            // المنافس داخل معاملة مفتوحة: pg_stat_activity لقطة تُخزَّن داخل المعاملة فلا تتحدّث ما لم تُمسَح.
            $this->rival()->query('SELECT pg_stat_clear_snapshot()');
            $n = (int) $this->rival()->query(
                "SELECT count(*) FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'"
            )->fetchColumn();
            if ($n > 0) {
                return;
            }
            usleep(20_000);
        }
        $this->fail('الطلب الفرعي لم يصل إلى الانتظار على قفل.');
    }

    private function currency(string $tenant): string
    {
        return (string) DB::table('tenants')->where('id', $tenant)->value('currency');
    }

    /** @test */
    public function a_change_in_flight_is_rejected_when_a_posting_commits_while_it_waits_never_applied_over_a_posted_entry(): void
    {
        $tenant = $this->makeTenant();
        $pdo = $this->rival();

        // المرحِّل (الأب): يحجز المِرساة ويُدرج قيداً مرحّلاً غير مودَع — كما يفعل LedgerService قبل الإيداع.
        $pdo->exec('BEGIN');
        $pdo->prepare('SELECT id FROM tenants WHERE id = ? FOR UPDATE')->execute([$tenant]);
        $pdo->prepare(
            "INSERT INTO journal_entries (id, tenant_id, number, entry_date, status, posted_at, created_at, updated_at)
             VALUES (?, ?, 'JE-CUR1-RACE', '2026-01-01', 'posted', now(), now(), now())"
        )->execute([(string) Str::uuid(), $tenant]);

        // الطلب الحقيقي لتغيير العملة يبدأ والقيد غير مودَع بعد ⇒ يعلق على المِرساة (قفل ثم فحص) أو على UPDATE (فحص ثم كتابة).
        $pid = $this->forkChange($tenant, 'USD', 'a');
        $this->waitForLockWaiter($pid, 'a');

        $pdo->exec('COMMIT'); // الآن يُودَع القيد والطلب لا يزال معلّقاً
        pcntl_waitpid($pid, $status);

        $r = $this->changeResult('a');
        $this->assertNull($r['error'], (string) $r['error']);
        $this->assertSame(422, $r['status'], 'التغيير المعلّق مرّ فوق قيد أُودِع أثناء انتظاره: السباق غير محكوم.');
        $this->assertSame('company_currency_locked', $r['reason']);
        $this->assertSame('SAR', $this->currency($tenant));
        $this->assertFalse(isset(Tenant::find($tenant)->settings['company']['city']), 'لا حفظ جزئي لبقية الحقول');
    }

    /** @test */
    public function concurrent_real_changes_without_entries_serialize_without_deadlock_and_end_on_one_requested_value(): void
    {
        $tenant = $this->makeTenant();
        $barrier = $this->dir.'/go';

        $pids = [];
        foreach (['USD', 'EUR', 'GBP', 'AED'] as $i => $cur) {
            $pids[] = $this->forkChange($tenant, $cur, (string) $i, $barrier);
        }
        usleep(300_000);
        touch($barrier);
        foreach ($pids as $pid) {
            pcntl_waitpid($pid, $status);
        }

        foreach (range(0, 3) as $i) {
            $r = $this->changeResult((string) $i);
            $this->assertNull($r['error'], (string) $r['error']);
            $this->assertSame(200, $r['status'], 'لا قيود ⇒ كل تغيير مشروع ويُسلسَل');
        }
        $this->assertContains($this->currency($tenant), ['USD', 'EUR', 'GBP', 'AED']);
    }

    /** @test */
    public function a_real_posting_racing_a_real_change_never_leaves_a_changed_currency_over_a_posted_entry(): void
    {
        for ($round = 0; $round < 6; $round++) {
            $tenant = $this->makeTenant(withChart: true);
            $barrier = $this->dir."/go_{$round}";

            $changePid = $this->forkChange($tenant, 'USD', "r{$round}", $barrier);

            $postOut = $this->dir."/post_{$round}.json";
            $postPid = pcntl_fork();
            $this->assertNotSame(-1, $postPid, 'pcntl_fork');
            if ($postPid === 0) {
                DB::purge(config('database.default'));
                app(TenantContext::class)->set($tenant);
                $res = ['ok' => false, 'error' => null];
                try {
                    $this->waitFor($barrier, 10.0);
                    $cash = Account::where('code', '1110')->firstOrFail();
                    $capital = Account::where('code', '3110')->firstOrFail();
                    app(LedgerService::class)->post([
                        ['account_id' => $cash->id, 'debit' => 5000, 'credit' => 0],
                        ['account_id' => $capital->id, 'debit' => 0, 'credit' => 5000],
                    ], ['description' => 'CUR-1 race']);
                    $res['ok'] = true;
                } catch (\Throwable $e) {
                    $res['error'] = get_class($e).': '.$e->getMessage();
                }
                file_put_contents($postOut, json_encode($res));
                posix_kill(getmypid(), SIGKILL);
                exit(0);
            }

            usleep(200_000);
            touch($barrier);
            pcntl_waitpid($changePid, $s1);
            pcntl_waitpid($postPid, $s2);

            $change = $this->changeResult("r{$round}");
            $post = json_decode((string) file_get_contents($postOut), true);
            foreach ([(string) $change['error'], (string) $post['error']] as $msg) {
                $this->assertStringNotContainsString('40P01', $msg);
                $this->assertStringNotContainsStringIgnoringCase('deadlock', $msg);
            }
            $this->assertNull($change['error'], (string) $change['error']);
            $this->assertTrue($post['ok'], "الترحيل فشل: {$post['error']}");

            // القيد الوحيد مرحّل دائماً؛ فلا يجوز أن تكون العملة تغيّرت إلا إن سبق التغيير الترحيلَ (ولم تكن قيود).
            $posted = DB::table('journal_entries')->where('tenant_id', $tenant)->whereIn('status', ['posted', 'reversed'])->count();
            $this->assertSame(1, $posted);
            if ($change['status'] === 200) {
                $this->assertSame('USD', $this->currency($tenant), 'التغيير سبق الترحيل: يُسمح');
            } else {
                $this->assertSame(422, $change['status']);
                $this->assertSame('company_currency_locked', $change['reason']);
                $this->assertSame('SAR', $this->currency($tenant), 'الترحيل سبق التغيير: لا تغيير فوق قيد مرحّل');
            }
        }
    }
}
