<?php

namespace Tests\Feature;

use App\Models\Tenant;
use App\Services\Communications\CommunicationDispatcher;
use App\Services\Communications\CommunicationProviderRegistry;
use App\Support\Communications\DispatchResult;
use App\Tenancy\TenantContext;
use Illuminate\Support\Facades\DB;
use PHPUnit\Framework\Attributes\Test;
use Tests\TestCase;

/**
 * AWJ-COMMS-03-A — تزامن PostgreSQL حقيقي (`pcntl_fork`) على الموزّع، وتشغيل الأمرين اليدويين على بيانات ملتزَمة.
 * يُهمَل إن لم يكن المحرك pgsql أو pcntl غير متاح — والإهمال لا يُحتسب نجاحاً. بلا RefreshDatabase (بيانات ملتزَمة)،
 * فمستوى المعاملة 0 كما في الإنتاج وحارس «لا معاملة مفتوحة» يعمل فعلياً.
 */
class CommunicationDispatcherPostgresTest extends TestCase
{
    use InteractsWithCommunicationDispatch;
    use InteractsWithCommunicationEnqueue;
    use InteractsWithCommunicationSchema;

    /** @var list<Tenant> */
    private array $tenants = [];

    private string $sendLog;

    protected function setUp(): void
    {
        parent::setUp();

        if (DB::connection()->getDriverName() !== 'pgsql') {
            $this->markTestSkipped('يتطلب PostgreSQL حقيقياً.');
        }
        if (! function_exists('pcntl_fork')) {
            $this->markTestSkipped('امتداد pcntl غير متاح.');
        }

        $this->configureCommunicationsHmac();
        config([
            'communications.policy.transactional' => ['ttl_seconds' => 3600, 'max_attempts' => 3],
            'communications.dispatch' => ['lease_seconds' => 120, 'receipt_window_seconds' => 259200, 'backoff_seconds' => [60, 300, 900]],
        ]);
        $this->sendLog = tempnam(sys_get_temp_dir(), 'dispatch_sends_');
    }

    protected function tearDown(): void
    {
        foreach ($this->tenants as $tenant) {
            DB::table('communication_message_attempts')->where('tenant_id', $tenant->id)->delete();
            DB::table('communication_messages')->where('tenant_id', $tenant->id)->delete();
            DB::table('tenants')->where('id', $tenant->id)->delete();
        }
        if (isset($this->sendLog)) {
            @unlink($this->sendLog);
        }

        parent::tearDown();
    }

    private function makeTenant(string $label): Tenant
    {
        return $this->tenants[] = $this->commTenant($label);
    }

    /** مزوّد يسجّل كل إرسال في ملف مشترك بين العمليات (إلحاق ذرّي). */
    private function loggingProvider(): CommunicationsProbeProvider
    {
        $log = $this->sendLog;

        return $this->probe(function ($intent) use ($log) {
            file_put_contents($log, $intent->idempotencyKey."\n", FILE_APPEND | LOCK_EX);

            return DispatchResult::accepted('p-'.substr($intent->idempotencyKey, 3, 8));
        });
    }

    /**
     * @param  list<callable(): mixed>  $jobs
     * @return list<array{ok: bool, value?: mixed, error_class?: string, message?: string}>
     */
    private function runConcurrently(array $jobs): array
    {
        $barrier = tempnam(sys_get_temp_dir(), 'dispatch_barrier_');
        unlink($barrier);
        $files = [];
        $pids = [];

        foreach ($jobs as $i => $job) {
            $files[$i] = tempnam(sys_get_temp_dir(), 'dispatch_result_');
            $pid = pcntl_fork();
            if ($pid === -1) {
                $this->fail('فشل pcntl_fork.');
            }
            if ($pid === 0) {
                DB::purge(config('database.default'));
                $deadline = microtime(true) + 5.0;
                while (! file_exists($barrier) && microtime(true) < $deadline) {
                    usleep(500);
                }
                try {
                    file_put_contents($files[$i], json_encode(['ok' => true, 'value' => $job()]));
                } catch (\Throwable $e) {
                    file_put_contents($files[$i], json_encode(['ok' => false, 'error_class' => get_class($e), 'message' => $e->getMessage()]));
                }
                exit(0);
            }
            $pids[] = $pid;
        }

        touch($barrier);
        foreach ($pids as $pid) {
            pcntl_waitpid($pid, $status);
        }
        @unlink($barrier);

        $results = [];
        foreach ($files as $i => $file) {
            $raw = file_get_contents($file);
            @unlink($file);
            $results[$i] = json_decode($raw !== false && $raw !== '' ? $raw : '{"ok":false,"message":"no output"}', true);
        }

        return $results;
    }

    /** @return list<string> */
    private function sentKeys(): array
    {
        return array_values(array_filter(array_map('trim', file($this->sendLog) ?: [])));
    }

    #[Test]
    public function concurrent_dispatchers_send_every_message_exactly_once(): void
    {
        $tenant = $this->makeTenant('race');
        $ids = [];
        for ($i = 0; $i < 8; $i++) {
            $ids[] = $this->enqueueMessage($tenant->id);
        }
        $tenantId = $tenant->id;

        $jobs = [];
        for ($i = 0; $i < 5; $i++) {
            $jobs[] = function () use ($tenantId) {
                app(TenantContext::class)->set($tenantId);
                $registry = (new CommunicationProviderRegistry())->register($this->loggingProvider());

                return CommunicationDispatcher::make($registry)->dispatchDue($tenantId, 50)->toArray();
            };
        }

        $results = $this->runConcurrently($jobs);

        $this->assertSame([], array_values(array_filter($results, fn ($r) => $r['ok'] !== true)), json_encode($results));
        $sent = $this->sentKeys();
        $this->assertCount(8, $sent, 'exactly one provider call per message: '.json_encode($results));
        $this->assertSame(array_map(fn ($id) => 'cm:'.$id, $ids), array_values(array_intersect(array_map(fn ($id) => 'cm:'.$id, $ids), $sent)));
        $this->assertCount(8, array_unique($sent));
        $this->assertSame(8, array_sum(array_map(fn ($r) => $r['value']['claimed'] ?? 0, $results)));
        $this->assertSame(8, array_sum(array_map(fn ($r) => $r['value']['accepted'] ?? 0, $results)));

        foreach ($ids as $id) {
            $this->assertSame('accepted', $this->messageRow($id)->status);
            $attempts = $this->attemptRows($id);
            $this->assertCount(1, $attempts, 'a single attempt row per message');
            $this->assertSame('accepted', $attempts[0]->outcome);
        }
    }

    #[Test]
    public function concurrent_recovery_handles_each_stranded_lease_exactly_once(): void
    {
        $tenant = $this->makeTenant('recover');
        $ids = [];
        for ($i = 0; $i < 6; $i++) {
            $ids[] = $id = $this->enqueueMessage($tenant->id);
            $this->strandInSending($tenant->id, $id);
        }
        $tenantId = $tenant->id;

        $jobs = [];
        for ($i = 0; $i < 4; $i++) {
            $jobs[] = function () use ($tenantId) {
                app(TenantContext::class)->set($tenantId);
                $registry = (new CommunicationProviderRegistry())->register($this->loggingProvider());

                return CommunicationDispatcher::make($registry)->recoverExpiredLeases($tenantId, 50)->toArray();
            };
        }

        $results = $this->runConcurrently($jobs);

        $this->assertSame([], array_values(array_filter($results, fn ($r) => $r['ok'] !== true)), json_encode($results));
        $this->assertSame(6, array_sum(array_map(fn ($r) => $r['value']['recovered_unknown'] ?? 0, $results)), json_encode($results));
        $this->assertSame([], $this->sentKeys(), 'recovery never calls a provider');
        foreach ($ids as $id) {
            $this->assertSame('unknown', $this->messageRow($id)->status);
            $this->assertSame(['abandoned'], array_map(fn ($a) => $a->outcome, $this->attemptRows($id)));
        }
    }

    #[Test]
    public function the_manual_commands_dispatch_and_recover_with_counts_only_output(): void
    {
        $tenant = $this->makeTenant('cmd');
        $queued = $this->enqueueMessage($tenant->id, ['address' => '+966555123456']);
        $stranded = $this->enqueueMessage($tenant->id);
        $this->strandInSending($tenant->id, $stranded);
        $provider = $this->loggingProvider();
        $this->app->instance(CommunicationProviderRegistry::class, (new CommunicationProviderRegistry())->register($provider));

        $this->artisan('communications:recover-leases', ['--tenant' => $tenant->id])
            ->expectsOutputToContain('recovered_unknown')->assertExitCode(0);
        $this->artisan('communications:dispatch', ['--tenant' => $tenant->id])
            ->doesntExpectOutputToContain('+966555123456')
            ->expectsOutputToContain('"accepted":1')->assertExitCode(0);

        $this->assertSame('accepted', $this->messageRow($queued)->status);
        $this->assertSame('unknown', $this->messageRow($stranded)->status);
        $this->assertSame(['cm:'.$queued], $this->sentKeys());
    }
}
