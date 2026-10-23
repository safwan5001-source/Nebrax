<?php

namespace Tests\Feature;

use App\Models\AiActionControl;
use App\Models\AiActionControlEvent;
use App\Models\PlatformAdministrator;
use App\Models\Tenant;
use App\Services\AiActionControlService;
use App\Services\AiActionRegistry;
use Illuminate\Support\Str;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/**
 * IMP-X-01a — ضوابط المشغّل تحت **تزامن حقيقي** (PostgreSQL + `pcntl_fork`): أربعة مديرين يمنحون المستأجر النوع نفسه معاً ⇒ حدث تدقيق واحد ونسخة 1 وصف واحد،
 * والبقية «الحالة قائمة أصلاً»؛ وسباق منح وسحب متعاكسين يُنتج سجلاً متسلسلاً بلا فجوات أو تكرار نسخ. **لا يُتخطّى** إن غاب `pcntl` على PostgreSQL.
 */
class AiActionControlConcurrencyPostgresTest extends TestCase
{
    use InteractsWithApi;
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
            $this->markTestSkipped('يتطلب PostgreSQL حقيقياً — SQLite لا يُظهر تنافساً على الأقفال.');
        }
        $this->assertTrue(function_exists('pcntl_fork') && function_exists('posix_kill'), 'pcntl/posix مطلوبان لاختبارات تزامن PostgreSQL؛ غيابهما فشل لا تخطٍّ.');

        $this->dir = sys_get_temp_dir().'/ai_control_race_'.uniqid();
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

    /** @return array{0: string, 1: list<callable>} */
    private function racers(array $enabledByRacer): array
    {
        $this->assertTrue(true);
        $tenant = Tenant::create(['name' => 'سباق ضوابط', 'slug' => 'ai-race-'.Str::random(8), 'vat_number' => '300000000000003', 'currency' => 'SAR', 'is_active' => true])->id;
        $this->tenants[] = $tenant;
        $admins = [];
        foreach ($enabledByRacer as $i => $enabled) {
            $admins[$i] = PlatformAdministrator::create(['name' => "مدير {$i}", 'email' => Str::random(8)."@race{$i}.test", 'password' => 'secret-password-1', 'is_active' => true])->id;
            $this->admins[] = $admins[$i];
        }

        $jobs = [];
        foreach ($enabledByRacer as $i => $enabled) {
            $jobs[] = function () use ($tenant, $admins, $i, $enabled) {
                $admin = PlatformAdministrator::query()->findOrFail($admins[$i]);
                $change = app(AiActionControlService::class)->setTenantState($admin, $tenant, AiActionRegistry::PRODUCT_IMPORT, 'use', $enabled, "سباق رقم {$i}");

                return ['changed' => $change->changed];
            };
        }

        return [$tenant, $jobs];
    }

    /** @test */
    public function four_racing_grants_of_the_same_control_write_exactly_one_event(): void
    {
        [$tenant, $jobs] = $this->racers([true, true, true, true]);

        $results = $this->runConcurrently($jobs);

        $control = AiActionControl::query()->where('tenant_id', $tenant)->get();
        $this->assertCount(1, $control, json_encode($results, JSON_UNESCAPED_UNICODE));
        $this->assertSame([true, 1], [$control[0]->enabled, $control[0]->version]);
        $this->assertSame(1, AiActionControlEvent::query()->where('tenant_id', $tenant)->count());
        $this->assertSame(1, count(array_filter($results, fn ($r) => ($r['ok'] ?? false) && ($r['value']['changed'] ?? false))), json_encode($results, JSON_UNESCAPED_UNICODE));
        $this->assertSame(4, count(array_filter($results, fn ($r) => ($r['ok'] ?? false) === true)), 'لا خطأ قاعدة لأي متسابق: '.json_encode($results, JSON_UNESCAPED_UNICODE));
    }

    /** @test */
    public function two_administrators_making_the_first_platform_grant_at_once_create_one_control_and_one_event(): void
    {
        $this->assertTrue(true);
        $admins = [];
        foreach ([0, 1, 2, 3] as $i) {
            $admins[$i] = PlatformAdministrator::create(['name' => "مدير {$i}", 'email' => Str::random(8)."@first{$i}.test", 'password' => 'secret-password-1', 'is_active' => true])->id;
            $this->admins[] = $admins[$i];
        }
        // مفتاح لم يُنشأ صفّه بعد: السباق على الإنشاء الأول (insertOrIgnore ثم قراءة الصف الفائز بقفل) لا على صف قائم.
        $jobs = array_map(fn (int $i) => function () use ($admins, $i) {
            $change = app(AiActionControlService::class)->setPlatformState(PlatformAdministrator::query()->findOrFail($admins[$i]), '*', 'execution', true, "أول منحة رقم {$i}");

            return ['changed' => $change->changed];
        }, [0, 1, 2, 3]);

        $results = $this->runConcurrently($jobs);

        $this->assertSame(4, count(array_filter($results, fn ($r) => ($r['ok'] ?? false) === true)), json_encode($results, JSON_UNESCAPED_UNICODE));
        $this->assertSame(1, AiActionControl::query()->where('scope', 'platform')->where('action_type', '*')->where('capability', 'execution')->count());
        $this->assertSame(1, AiActionControlEvent::query()->where('scope', 'platform')->where('action_type', '*')->where('capability', 'execution')->count());
        $this->assertSame(1, count(array_filter($results, fn ($r) => ($r['value']['changed'] ?? false) === true)));
    }

    /** @test */
    public function racing_grants_and_revocations_leave_a_gapless_consistent_audit_trail(): void
    {
        [$tenant, $jobs] = $this->racers([true, false, true, false]);

        $results = $this->runConcurrently($jobs);

        $events = AiActionControlEvent::query()->where('tenant_id', $tenant)->orderBy('version')->get();
        $control = AiActionControl::query()->where('tenant_id', $tenant)->first();
        $this->assertNotNull($control, json_encode($results, JSON_UNESCAPED_UNICODE));
        $this->assertSame($events->count(), (int) $control->version);
        $this->assertSame(range(1, $events->count()), $events->pluck('version')->all());
        $previous = false;
        foreach ($events as $event) {
            $this->assertSame($previous, $event->previous_enabled, 'سلسلة الحالات متصلة');
            $previous = $event->new_enabled;
        }
        $this->assertSame($previous, (bool) $control->enabled);
        $this->assertSame(4, count(array_filter($results, fn ($r) => ($r['ok'] ?? false) === true)), json_encode($results, JSON_UNESCAPED_UNICODE));
    }

    private function clearPlatformRows(): void
    {
        try {
            DB::unprepared('ALTER TABLE ai_action_control_events DISABLE TRIGGER USER');
            DB::unprepared('ALTER TABLE ai_action_controls DISABLE TRIGGER USER');
            DB::table('ai_action_control_events')->whereNull('tenant_id')->delete();
            DB::table('ai_action_controls')->whereNull('tenant_id')->delete();
        } finally {
            DB::unprepared('ALTER TABLE ai_action_controls ENABLE TRIGGER USER');
            DB::unprepared('ALTER TABLE ai_action_control_events ENABLE TRIGGER USER');
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
