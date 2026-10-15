<?php

namespace Tests\Feature;

use App\Models\Tenant;
use App\Services\Communications\CommunicationOutbox;
use App\Support\Communications\IdempotencyConflictException;
use App\Tenancy\TenantContext;
use Illuminate\Support\Facades\DB;
use PHPUnit\Framework\Attributes\Test;
use Tests\TestCase;

/**
 * AWJ-COMMS-02-B — تزامن PostgreSQL حقيقي (`pcntl_fork`) على خدمة الإدراج: القيد الفريد حَكَم نهائي.
 * يُهمَل إن لم يكن المحرك pgsql أو pcntl غير متاح — والإهمال لا يُحتسب نجاحاً. بلا RefreshDatabase (بيانات ملتزَمة).
 */
class CommunicationOutboxPostgresConcurrencyTest extends TestCase
{
    use InteractsWithCommunicationEnqueue;
    use InteractsWithCommunicationSchema;

    /** @var list<Tenant> */
    private array $tenants = [];

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
        config(['communications.policy.transactional' => ['ttl_seconds' => 3600, 'max_attempts' => 3]]);
    }

    protected function tearDown(): void
    {
        foreach ($this->tenants as $tenant) {
            DB::table('communication_message_attempts')->where('tenant_id', $tenant->id)->delete();
            DB::table('communication_messages')->where('tenant_id', $tenant->id)->delete();
            DB::table('tenants')->where('id', $tenant->id)->delete();
        }

        parent::tearDown();
    }

    private function makeTenant(string $label): Tenant
    {
        return $this->tenants[] = $this->commTenant($label);
    }

    /**
     * @param  list<callable(): mixed>  $jobs
     * @return list<array{ok: bool, value?: mixed, error_class?: string, message?: string}>
     */
    private function runConcurrently(array $jobs): array
    {
        $barrier = tempnam(sys_get_temp_dir(), 'outbox_barrier_');
        unlink($barrier);
        $files = [];
        $pids = [];

        foreach ($jobs as $i => $job) {
            $files[$i] = tempnam(sys_get_temp_dir(), 'outbox_result_');
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

    /** @return callable(): array{0: string, 1: string} */
    private function job(string $tenantId, array $intent, string $label): callable
    {
        return function () use ($tenantId, $intent, $label) {
            app(TenantContext::class)->set($tenantId);
            $result = CommunicationOutbox::make()->enqueue($this->commIntent($tenantId, $intent));

            return [$label, $result->outcome->value, $result->messageId];
        };
    }

    #[Test]
    public function concurrent_identical_requests_create_exactly_one_message_and_replay_the_rest(): void
    {
        $tenant = $this->makeTenant('same');
        $jobs = [];
        for ($i = 0; $i < 6; $i++) {
            $jobs[] = $this->job($tenant->id, [], 'same');
        }

        $results = $this->runConcurrently($jobs);

        $this->assertSame([], array_values(array_filter($results, fn ($r) => $r['ok'] !== true)), 'no request may fail: '.json_encode($results));
        $outcomes = array_column(array_column($results, 'value'), 1);
        $this->assertSame(1, count(array_filter($outcomes, fn ($o) => $o === 'created')), json_encode($results));
        $this->assertSame(5, count(array_filter($outcomes, fn ($o) => $o === 'replayed')));
        $this->assertCount(1, array_unique(array_column(array_column($results, 'value'), 2)), 'every caller sees the same message id');
        $this->assertSame(1, DB::table('communication_messages')->where('tenant_id', $tenant->id)->count());
    }

    #[Test]
    public function concurrent_requests_with_different_content_under_one_key_yield_one_winner_and_explicit_conflicts(): void
    {
        $tenant = $this->makeTenant('mixed');
        $jobs = [];
        foreach (['A', 'A', 'A', 'B', 'B', 'B'] as $label) {
            $jobs[] = $this->job($tenant->id, ['variables' => ['invoice_no' => "INV-{$label}"]], $label);
        }

        $results = $this->runConcurrently($jobs);

        $created = array_values(array_filter($results, fn ($r) => $r['ok'] && $r['value'][1] === 'created'));
        $this->assertCount(1, $created, json_encode($results));
        $winner = $created[0]['value'][0];

        foreach ($results as $i => $result) {
            $label = ['A', 'A', 'A', 'B', 'B', 'B'][$i];
            if ($label === $winner) {
                $this->assertTrue($result['ok'], 'same-content callers succeed: '.json_encode($result));
                $this->assertContains($result['value'][1], ['created', 'replayed']);
            } else {
                $this->assertFalse($result['ok'], 'different-content callers must fail: '.json_encode($result));
                $this->assertSame(IdempotencyConflictException::class, $result['error_class']);
            }
        }
        $this->assertSame(1, DB::table('communication_messages')->where('tenant_id', $tenant->id)->count());
    }

    #[Test]
    public function the_same_key_used_concurrently_by_different_tenants_creates_one_message_each(): void
    {
        $a = $this->makeTenant('a');
        $b = $this->makeTenant('b');
        $jobs = [];
        foreach ([$a, $b, $a, $b, $a, $b] as $tenant) {
            $jobs[] = $this->job($tenant->id, [], $tenant->id);
        }

        $results = $this->runConcurrently($jobs);

        $this->assertSame([], array_values(array_filter($results, fn ($r) => $r['ok'] !== true)), json_encode($results));
        foreach ([$a, $b] as $tenant) {
            $mine = array_filter($results, fn ($r) => $r['value'][0] === $tenant->id);
            $this->assertSame(1, count(array_filter($mine, fn ($r) => $r['value'][1] === 'created')));
            $this->assertSame(1, DB::table('communication_messages')->where('tenant_id', $tenant->id)->count());
        }
        $this->assertNotSame(
            DB::table('communication_messages')->where('tenant_id', $a->id)->value('id'),
            DB::table('communication_messages')->where('tenant_id', $b->id)->value('id'),
        );
    }
}
