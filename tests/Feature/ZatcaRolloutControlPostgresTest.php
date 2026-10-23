<?php

namespace Tests\Feature;

use App\Models\PlatformAdministrator;
use App\Models\Tenant;
use App\Models\ZatcaRolloutControlEvent;
use App\Services\Accounting\ZatcaRolloutControlService;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * ═══════════════════════════════════════════════════════════════
 *  REM-18b-3a — ضوابط تفعيل ZATCA تحت تزامن حقيقي (PostgreSQL + عمليات `pcntl_fork`)
 * ═══════════════════════════════════════════════════════════════
 *  1) تفعيلات متطابقة متزامنة ⇒ حدث واحد بالضبط.
 *  2) تفعيل/تعطيل متبادلان متزامنان ⇒ تاريخ نسخ متصل متسق الحالتين السابقة والجديدة، وحالة الضابط = آخر حدث، بلا جمود (40P01).
 *  3) أول إيقاف طارئ للمنصة من عدة عمليات ⇒ ضابط واحد وحدث واحد.
 *  4) توافق نموذج المِرساة: كاتب «بأسلوب الترحيل» يقفل مِرساة المستأجر فيصطفّ تغيير الضابط خلفه (فلا يرى الترحيل قيمتين)،
 *     والقارئ بلا قفل لا يُحجب.
 *  5) سباق تغييرات مع كتّاب مِرساة بأسلوب الترحيل مراراً ⇒ لا جمود.
 *  6) موت مفاجئ (SIGKILL) بعد إدراج الحدث وقبل التثبيت ⇒ لا حدث ولا ضابط.
 *
 *  على PostgreSQL **لا يُتخطّى** هذا الصنف إن غاب `pcntl`: يفشل. يُتخطّى على SQLite فقط (لا أقفال صفوف).
 *  صفوف المنصة لا تُحذف بأي مسار تطبيقي (حراس C4/E2)، فينظّفها `tearDown` بتعطيل مُشغّلات المستخدم مؤقتاً داخل try/finally.
 */
class ZatcaRolloutControlPostgresTest extends TestCase
{
    use UsesWorkerDatabaseWithoutTransaction;

    private string $dir;

    /** @var list<string> */
    private array $tenants = [];

    /** @var list<string> */
    private array $admins = [];

    protected function setUp(): void
    {
        parent::setUp();

        if (DB::connection()->getDriverName() !== 'pgsql') {
            $this->markTestSkipped('يتطلب PostgreSQL حقيقياً — SQLite لا يُظهر تنافساً على أقفال الصفوف.');
        }
        $this->assertTrue(function_exists('pcntl_fork') && function_exists('posix_kill'),
            'pcntl/posix مطلوبان لاختبارات تزامن PostgreSQL؛ غيابهما فشل لا تخطٍّ (REM-18b-3a).');

        $this->dir = sys_get_temp_dir().'/zatca_rollout_'.uniqid();
        mkdir($this->dir);
        $this->clearPlatformRows(); // لا بقايا من تشغيل سابق منقطع
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
            // حذف المستأجر المتسلسل يزيل ضوابطه وأحداثه (الحارس يسمح به بعد زوال صفه).
            foreach ($this->tenants as $id) {
                DB::table('tenants')->where('id', $id)->delete();
            }
            $this->clearPlatformRows();
            foreach ($this->admins as $id) {
                DB::table('platform_administrators')->where('id', $id)->delete();
            }
        }

        parent::tearDown();
    }

    /** @test */
    public function identical_concurrent_enables_produce_exactly_one_event(): void
    {
        $tenant = $this->makeTenant();
        $admins = [$this->makeAdmin(), $this->makeAdmin(), $this->makeAdmin()];

        $jobs = [];
        foreach ([0, 1, 2, 0, 1, 2] as $i) {
            $jobs[] = $this->changer('tenant', $tenant, true, $admins[$i], 'تفعيل متزامن');
        }
        $results = $this->runConcurrently($jobs);

        $this->assertAllOk($results);
        $this->assertSame(1, count(array_filter($results, fn ($r) => $r['value']['changed'] === true)), 'تغيير فعلي واحد فقط');
        $this->assertSame(1, DB::table('zatca_rollout_control_events')->where('tenant_id', $tenant)->count());
        $control = DB::table('zatca_rollout_controls')->where('tenant_id', $tenant)->first();
        $this->assertTrue((bool) $control->enabled);
        $this->assertSame(1, (int) $control->version);
    }

    /** @test */
    public function alternating_concurrent_changes_keep_a_contiguous_consistent_history(): void
    {
        $tenant = $this->makeTenant();
        $admins = [$this->makeAdmin(), $this->makeAdmin(), $this->makeAdmin(), $this->makeAdmin()];

        $jobs = [];
        foreach (range(0, 11) as $i) {
            $jobs[] = $this->changer('tenant', $tenant, $i % 2 === 0, $admins[$i % 4], 'تبديل متزامن '.$i);
        }
        $results = $this->runConcurrently($jobs);

        $this->assertAllOk($results);
        $events = DB::table('zatca_rollout_control_events')->where('tenant_id', $tenant)->orderBy('version')->get();
        $this->assertGreaterThanOrEqual(1, $events->count());
        $this->assertSame(range(1, $events->count()), $events->pluck('version')->map(fn ($v) => (int) $v)->all(), 'نسخ متصلة بلا فجوة أو تكرار');
        $previous = false; // الحالة الأساسية للمستأجر
        foreach ($events as $event) {
            $this->assertSame($previous, (bool) $event->previous_enabled, "نسخة {$event->version}: السابقة = الجديدة للحدث قبلها");
            $this->assertNotSame((bool) $event->previous_enabled, (bool) $event->new_enabled);
            $previous = (bool) $event->new_enabled;
        }
        $control = DB::table('zatca_rollout_controls')->where('tenant_id', $tenant)->first();
        $this->assertSame($events->count(), (int) $control->version);
        $this->assertSame($previous, (bool) $control->enabled, 'حالة الضابط = آخر حدث');
        $this->assertSame($events->count(), count(array_filter($results, fn ($r) => $r['value']['changed'] === true)), 'كل تغيير مُبلَّغ يقابله حدث');
    }

    /** @test */
    public function the_first_platform_stop_raced_by_several_processes_creates_one_control_and_one_event(): void
    {
        $admins = [$this->makeAdmin(), $this->makeAdmin()];

        $results = $this->runConcurrently([
            $this->changer('platform', null, false, $admins[0], 'إيقاف طارئ 1'),
            $this->changer('platform', null, false, $admins[1], 'إيقاف طارئ 2'),
            $this->changer('platform', null, false, $admins[0], 'إيقاف طارئ 3'),
            $this->changer('platform', null, false, $admins[1], 'إيقاف طارئ 4'),
        ]);

        $this->assertAllOk($results);
        $this->assertSame(1, DB::table('zatca_rollout_controls')->where('scope', 'platform')->count());
        $this->assertSame(1, DB::table('zatca_rollout_control_events')->where('scope', 'platform')->count());
        $this->assertSame(1, count(array_filter($results, fn ($r) => $r['value']['changed'] === true)));
        $this->assertFalse((bool) DB::table('zatca_rollout_controls')->where('scope', 'platform')->value('enabled'));
    }

    /** @test */
    public function a_change_queues_behind_a_posting_style_anchor_lock_and_a_reader_is_never_blocked(): void
    {
        $tenant = $this->makeTenant();
        $admin = $this->makeAdmin();
        $dir = $this->dir;

        $results = $this->runConcurrently([
            // «ترحيل»: يقفل مِرساة المستأجر أولاً (كـLedgerService) ثم يقرأ الحالة الفعّالة مرة واحدة بعد حجز طويل.
            function () use ($tenant, $dir) {
                return DB::transaction(function () use ($tenant, $dir) {
                    Tenant::query()->whereKey($tenant)->lockForUpdate()->first();
                    touch($dir.'/anchor_locked');
                    usleep(2_000_000);

                    return ['enabled' => app(ZatcaRolloutControlService::class)->effectiveForTenant($tenant)->enabled];
                });
            },
            // مدير المنصة: يغيّر الضابط ⇒ يصطفّ خلف المِرساة.
            function () use ($tenant, $admin, $dir) {
                $this->waitFor($dir.'/anchor_locked');
                $start = microtime(true);
                $change = app(ZatcaRolloutControlService::class)->setTenantState(PlatformAdministrator::findOrFail($admin), $tenant, true, 'تفعيل خلف قفل المِرساة');

                return ['changed' => $change->changed, 'waited_ms' => (int) ((microtime(true) - $start) * 1000)];
            },
            // قارئ بلا قفل: لا يُحجب بقفل المِرساة ولا بالتغيير المنتظر.
            function () use ($tenant, $dir) {
                $this->waitFor($dir.'/anchor_locked');
                usleep(300_000);
                $start = microtime(true);
                $enabled = app(ZatcaRolloutControlService::class)->effectiveForTenant($tenant)->enabled;

                return ['enabled' => $enabled, 'took_ms' => (int) ((microtime(true) - $start) * 1000)];
            },
        ]);

        $this->assertAllOk($results);
        $this->assertFalse($results[0]['value']['enabled'], 'الترحيل لم يرَ التغيير: سبقه في الترتيب خلف مِرساته');
        $this->assertTrue($results[1]['value']['changed']);
        $this->assertGreaterThanOrEqual(1000, $results[1]['value']['waited_ms'], 'التغيير اصطفّ خلف قفل المِرساة');
        $this->assertFalse($results[2]['value']['enabled']);
        $this->assertLessThan(1000, $results[2]['value']['took_ms'], 'القراءة بلا قفل لا تُحجب');
        $this->assertTrue($this->effective($tenant), 'التغيير سرى بعد انتهاء الترحيل');
    }

    /** @test */
    public function changes_racing_posting_style_transactions_never_deadlock(): void
    {
        $tenant = $this->makeTenant();
        $admins = [$this->makeAdmin(), $this->makeAdmin()];

        for ($round = 0; $round < 3; $round++) {
            $jobs = [];
            foreach (range(0, 3) as $i) {
                $jobs[] = function () use ($tenant) {
                    return DB::transaction(function () use ($tenant) {
                        Tenant::query()->whereKey($tenant)->lockForUpdate()->first();
                        usleep(20_000);

                        return ['enabled' => app(ZatcaRolloutControlService::class)->effectiveForTenant($tenant)->enabled];
                    });
                };
                $jobs[] = $this->changer('tenant', $tenant, ($round + $i) % 2 === 0, $admins[$i % 2], "سباق جولة {$round}");
            }
            $results = $this->runConcurrently($jobs);

            $this->assertAllOk($results);
        }

        $events = DB::table('zatca_rollout_control_events')->where('tenant_id', $tenant)->orderBy('version')->pluck('version')->map(fn ($v) => (int) $v)->all();
        $this->assertSame(range(1, count($events)), $events);
    }

    /** @test */
    public function a_process_killed_after_the_event_insert_leaves_no_event_and_no_control(): void
    {
        $tenant = $this->makeTenant();
        $admin = $this->makeAdmin();
        $dir = $this->dir;

        $pid = pcntl_fork();
        $this->assertNotSame(-1, $pid, 'pcntl_fork');
        if ($pid === 0) {
            DB::purge(config('database.default'));
            Event::listen('eloquent.created: '.ZatcaRolloutControlEvent::class, function () use ($dir): void {
                touch($dir.'/event_inserted');
                sleep(30); // يُقتل قبل التثبيت
            });
            try {
                app(ZatcaRolloutControlService::class)->setTenantState(PlatformAdministrator::findOrFail($admin), $tenant, true, 'تفعيل يُقتل');
            } catch (\Throwable) {
            }
            exit(0);
        }

        $this->waitFor($dir.'/event_inserted', 15.0);
        posix_kill($pid, SIGKILL);
        pcntl_waitpid($pid, $status);

        $this->assertSame(0, DB::table('zatca_rollout_control_events')->where('tenant_id', $tenant)->count());
        $this->assertSame(0, DB::table('zatca_rollout_controls')->where('tenant_id', $tenant)->count());
        $this->assertFalse($this->effective($tenant));

        // ولا يعلق شيء خلفه: التغيير التالي ينجح بنسخة 1.
        $change = app(ZatcaRolloutControlService::class)->setTenantState(PlatformAdministrator::findOrFail($admin), $tenant, true, 'تفعيل بعد الموت');
        $this->assertTrue($change->changed);
        $this->assertSame(1, (int) DB::table('zatca_rollout_controls')->where('tenant_id', $tenant)->value('version'));
    }

    // ───────────────────────── مساعدات ─────────────────────────

    private function makeTenant(): string
    {
        $id = Tenant::create([
            'name' => 'مستأجر تفعيل متزامن', 'slug' => 'zatca-rollout-pg-'.Str::random(10),
            'vat_number' => '300000000000003', 'currency' => 'SAR', 'is_active' => true,
        ])->id;
        $this->tenants[] = $id;

        return $id;
    }

    private function makeAdmin(): string
    {
        $id = PlatformAdministrator::create([
            'name' => 'مدير تزامن', 'email' => Str::random(10).'@platform.test', 'password' => 'secret-password-1', 'is_active' => true,
        ])->id;
        $this->admins[] = $id;

        return $id;
    }

    private function changer(string $scope, ?string $tenant, bool $enabled, string $adminId, string $reason): callable
    {
        return function () use ($scope, $tenant, $enabled, $adminId, $reason) {
            $service = app(ZatcaRolloutControlService::class);
            $actor = PlatformAdministrator::findOrFail($adminId);
            $change = $scope === 'platform'
                ? $service->setPlatformState($actor, $enabled, $reason)
                : $service->setTenantState($actor, $tenant, $enabled, $reason);

            return ['changed' => $change->changed];
        };
    }

    private function effective(string $tenant): bool
    {
        return app(ZatcaRolloutControlService::class)->effectiveForTenant($tenant)->enabled;
    }

    /** صفوف المنصة لا تُحذف تطبيقياً (حراس C4/E2): تنظيف الاختبار بتعطيل مُشغّلات المستخدم مؤقتاً فقط. */
    private function clearPlatformRows(): void
    {
        if (! \Illuminate\Support\Facades\Schema::hasTable('zatca_rollout_controls')) {
            return;
        }
        try {
            DB::unprepared('ALTER TABLE zatca_rollout_control_events DISABLE TRIGGER USER');
            DB::unprepared('ALTER TABLE zatca_rollout_controls DISABLE TRIGGER USER');
            DB::table('zatca_rollout_control_events')->whereNull('tenant_id')->delete();
            DB::table('zatca_rollout_controls')->whereNull('tenant_id')->delete();
        } finally {
            DB::unprepared('ALTER TABLE zatca_rollout_controls ENABLE TRIGGER USER');
            DB::unprepared('ALTER TABLE zatca_rollout_control_events ENABLE TRIGGER USER');
        }
    }

    private function waitFor(string $file, float $seconds = 10.0): void
    {
        $deadline = microtime(true) + $seconds;
        while (! file_exists($file) && microtime(true) < $deadline) {
            usleep(1_000);
        }
    }

    private function assertAllOk(array $results): void
    {
        foreach ($results as $i => $result) {
            $this->assertTrue($result['ok'] ?? false, "العملية {$i}: ".($result['error_class'] ?? '').' '.($result['message'] ?? ''));
            $this->assertFalse($this->isDeadlock($result), "جمود في العملية {$i}");
        }
    }

    private function isDeadlock(array $result): bool
    {
        $message = (string) ($result['message'] ?? '');

        return str_contains($message, '40P01') || stripos($message, 'deadlock') !== false;
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
                    $value = $job();
                    file_put_contents($resultFiles[$i], json_encode(['ok' => true, 'value' => $value]));
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
}
