<?php

namespace Tests\Feature;

use App\Models\Tenant;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use PHPUnit\Framework\Attributes\Test;
use Tests\TestCase;

/**
 * AWJ-COMMS-FOUNDATION-02-A — إثبات تزامن PostgreSQL حقيقي لقيدين: التفرّد `(tenant_id, idempotency_hash)`
 * ومحاولة جارية واحدة لكل رسالة. عمليات نظام حقيقية عبر `pcntl_fork()` (لا محاكاة متسلسلة).
 *
 * يُهمَل إن لم يكن المحرك `pgsql` حقيقياً أو `pcntl` غير متاح — والإهمال لا يُحتسب نجاحاً.
 * لا RefreshDatabase: العمليات الفرعية تحتاج بيانات مُلتزَمة فعلياً، والتنظيف يدوي في tearDown.
 *
 * تشغيل: php artisan test --filter=CommunicationSchemaPostgresConcurrencyTest
 */
class CommunicationSchemaPostgresConcurrencyTest extends TestCase
{
    use InteractsWithCommunicationSchema;

    private Tenant $tenant;

    protected function setUp(): void
    {
        parent::setUp();

        if (DB::connection()->getDriverName() !== 'pgsql') {
            $this->markTestSkipped('يتطلب PostgreSQL حقيقياً — SQLite لا يُظهر تنافساً حقيقياً.');
        }
        if (! function_exists('pcntl_fork')) {
            $this->markTestSkipped('امتداد pcntl غير متاح في هذه البيئة.');
        }

        $this->tenant = $this->commTenant('concurrency');
    }

    protected function tearDown(): void
    {
        if (isset($this->tenant)) {
            DB::table('communication_message_attempts')->where('tenant_id', $this->tenant->id)->delete();
            DB::table('communication_messages')->where('tenant_id', $this->tenant->id)->delete();
            DB::table('tenants')->where('id', $this->tenant->id)->delete();
        }

        parent::tearDown();
    }

    /**
     * @param  list<callable(): mixed>  $jobs
     * @return list<array{ok: bool, error_class?: string, message?: string, value?: mixed}>
     */
    private function runConcurrently(array $jobs): array
    {
        $barrier = tempnam(sys_get_temp_dir(), 'comm_barrier_');
        unlink($barrier);

        $resultFiles = [];
        $pids = [];

        foreach ($jobs as $i => $job) {
            $resultFile = tempnam(sys_get_temp_dir(), 'comm_result_');
            $resultFiles[$i] = $resultFile;

            $pid = pcntl_fork();
            if ($pid === -1) {
                $this->fail('فشل pcntl_fork — لا يمكن إثبات تزامن حقيقي بدونه.');
            }

            if ($pid === 0) {
                DB::purge(config('database.default'));

                $deadline = microtime(true) + 5.0;
                while (! file_exists($barrier) && microtime(true) < $deadline) {
                    usleep(500);
                }

                try {
                    $value = $job();
                    file_put_contents($resultFile, json_encode(['ok' => true, 'value' => $value]));
                } catch (\Throwable $e) {
                    file_put_contents($resultFile, json_encode([
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
        @unlink($barrier);

        $results = [];
        foreach ($resultFiles as $i => $file) {
            $raw = file_get_contents($file);
            @unlink($file);
            $results[$i] = json_decode($raw !== false && $raw !== '' ? $raw : '{"ok":false,"message":"no output"}', true);
        }

        return $results;
    }

    #[Test]
    public function concurrent_inserts_with_the_same_idempotency_key_leave_exactly_one_row(): void
    {
        $tenantId = $this->tenant->id;
        $hash = hash('sha256', $tenantId."\n".'concurrent-key');

        $jobs = [];
        for ($i = 0; $i < 4; $i++) {
            $jobs[] = function () use ($tenantId, $hash) {
                $row = $this->commMessageRow($tenantId, ['idempotency_hash' => $hash]);

                return DB::table('communication_messages')->insert($row);
            };
        }

        $results = $this->runConcurrently($jobs);

        $this->assertCount(1, array_filter($results, fn (array $r) => $r['ok'] === true), 'exactly one insert may win: '.json_encode($results));
        foreach (array_filter($results, fn (array $r) => $r['ok'] === false) as $failure) {
            $this->assertStringContainsString('comm_msg_idem_unique', $failure['message']);
        }
        $this->assertSame(1, DB::table('communication_messages')->where('tenant_id', $tenantId)->where('idempotency_hash', $hash)->count());
    }

    #[Test]
    public function insert_or_ignore_with_the_same_key_never_aborts_and_leaves_one_row(): void
    {
        $tenantId = $this->tenant->id;
        $hash = hash('sha256', $tenantId."\n".'ignore-key');

        $jobs = [];
        for ($i = 0; $i < 4; $i++) {
            $jobs[] = function () use ($tenantId, $hash) {
                $row = $this->commMessageRow($tenantId, ['idempotency_hash' => $hash]);

                return DB::table('communication_messages')->insertOrIgnore($row);
            };
        }

        $results = $this->runConcurrently($jobs);

        $this->assertCount(4, array_filter($results, fn (array $r) => $r['ok'] === true), json_encode($results));
        $this->assertSame(1, array_sum(array_map(fn (array $r) => (int) $r['value'], $results)), 'exactly one insertOrIgnore reports an inserted row');
        $this->assertSame(1, DB::table('communication_messages')->where('tenant_id', $tenantId)->where('idempotency_hash', $hash)->count());
    }

    #[Test]
    public function concurrent_started_attempts_for_one_message_leave_exactly_one_in_flight(): void
    {
        $tenantId = $this->tenant->id;
        $messageId = $this->insertCommMessage($tenantId);

        $jobs = [];
        for ($i = 1; $i <= 4; $i++) {
            $jobs[] = function () use ($tenantId, $messageId, $i) {
                return DB::table('communication_message_attempts')->insert($this->commAttemptRow($tenantId, $messageId, ['attempt_no' => $i]));
            };
        }

        $results = $this->runConcurrently($jobs);

        $this->assertCount(1, array_filter($results, fn (array $r) => $r['ok'] === true), 'exactly one started attempt may win: '.json_encode($results));
        $this->assertSame(1, DB::table('communication_message_attempts')->where('message_id', $messageId)->where('outcome', 'started')->count());
    }
}
