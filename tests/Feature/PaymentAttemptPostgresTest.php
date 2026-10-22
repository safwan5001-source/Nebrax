<?php

namespace Tests\Feature;

use App\Models\PaymentAttempt;
use App\Models\PaymentGateway;
use App\Models\PlatformAdministrator;
use App\Models\Tenant;
use App\Services\Payments\FakeGatewayAdapter;
use App\Services\Payments\PaymentOrchestrator;
use App\Services\PaymentsRolloutControlService;
use App\Support\Payments\PaymentOrchestrationException;
use App\Support\Payments\ProviderPaymentSnapshot;
use App\Support\SchedulerHeartbeat;
use App\Tenancy\TenantContext;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\Support\TestPayable;
use Tests\TestCase;

/**
 * ═══════════════════════════════════════════════════════════════
 *  PAY-H1-03 — نواة التنسيق تحت تزامن حقيقي (PostgreSQL + عمليات `pcntl_fork`)
 * ═══════════════════════════════════════════════════════════════
 *  1) طلبات متطابقة (مفتاح idempotency واحد) متزامنة ⇒ محاولة واحدة والكل يعيد معرّفها نفسه.
 *  2) مفاتيح مختلفة لـPayable واحد ⇒ محاولة نشطة واحدة فقط، والباقي `active_attempt_exists` (لا جمود).
 *  3) لقطات مزوّد متضاربة/متأخرة متزامنة ⇒ الحالة النهائية رتيبة (captured) بلا مراجعة ولا جمود.
 *  4) مزامنات متطابقة للالتقاط ⇒ انتقال واحد فعلي؛ الباقي مكرر.
 *  5) حذف المستأجر المتسلسل يزيل محاولاته وبوابته معاً رغم FK البوابة.
 *
 *  على PostgreSQL **لا يُتخطّى** إن غاب `pcntl`: يفشل. يُتخطّى على SQLite فقط.
 *  لا يستعمل RefreshDatabase (الأطفال يحتاجون بيانات مُثبَتة): ينظّف `tearDown` بحذف المستأجرين المتسلسل.
 */
class PaymentAttemptPostgresTest extends TestCase
{
    private string $dir;

    private string $tenantId;

    private string $gatewayId;

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
            'pcntl/posix مطلوبان لاختبارات تزامن PostgreSQL؛ غيابهما فشل لا تخطٍّ (PAY-H1-03).');

        $this->dir = sys_get_temp_dir().'/payment_attempts_'.uniqid();
        mkdir($this->dir);

        $tenant = Tenant::create(['name' => 'منسّق متزامن', 'slug' => 'pay-h1-03-pg-'.Str::random(8), 'vat_number' => '300000000000013', 'currency' => 'SAR']);
        $this->tenants[] = $this->tenantId = $tenant->id;
        app(TenantContext::class)->set($this->tenantId);

        $admin = PlatformAdministrator::create(['name' => 'مشغّل', 'email' => Str::random(8).'@platform.test', 'password' => 'platform-password-123']);
        $this->admins[] = $admin->id;
        SchedulerHeartbeat::record();
        app(PaymentsRolloutControlService::class)->setTenantState($admin, $this->tenantId, true, 'تفعيل اختبار التزامن');

        $gateway = PaymentGateway::query()->create(['provider' => 'fake', 'name' => 'Fake', 'environment' => 'sandbox']);
        DB::table('payment_gateways')->where('id', $gateway->id)->update(['status' => 'active']);
        $this->gatewayId = $gateway->id;
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
            // الحذف المتسلسل يجب أن ينجح رغم FK المحاولات → البوابة (يُختبر صراحةً أدناه أيضاً).
            foreach ($this->tenants as $id) {
                DB::table('tenants')->where('id', $id)->delete();
            }
            DB::table('platform_runtime_heartbeats')->where('component', SchedulerHeartbeat::COMPONENT)->delete();
        }

        parent::tearDown();
    }

    /** @test */
    public function identical_concurrent_starts_produce_one_attempt_and_everyone_gets_it(): void
    {
        $results = $this->runConcurrently(array_fill(0, 6, $this->starter('invoice:same', 'concurrent-key-1')));

        $this->assertAllOk($results);
        $ids = array_unique(array_column(array_column($results, 'value'), 'id'));
        $this->assertCount(1, $ids, 'الكل يعيد المحاولة نفسها');
        $this->assertSame(1, DB::table('payment_attempts')->where('tenant_id', $this->tenantId)->count());
        $attempt = DB::table('payment_attempts')->where('tenant_id', $this->tenantId)->first();
        $this->assertSame('pending_customer', $attempt->capture_status);
        $this->assertSame('fake_'.$attempt->id, $attempt->provider_payment_id);
    }

    /** @test */
    public function different_keys_for_one_payable_leave_exactly_one_active_attempt(): void
    {
        $jobs = [];
        foreach (range(1, 6) as $i) {
            $jobs[] = $this->starter('invoice:contested', "contested-key-{$i}");
        }
        $results = $this->runConcurrently($jobs);

        $this->assertAllOk($results);
        $values = array_column($results, 'value');
        $this->assertSame(1, count(array_filter($values, fn ($v) => isset($v['id']))), 'نجاح واحد فقط');
        foreach ($values as $v) {
            if (! isset($v['id'])) {
                $this->assertSame('active_attempt_exists', $v['reason']);
            }
        }
        $this->assertSame(1, DB::table('payment_attempts')->where('tenant_id', $this->tenantId)->whereIn('capture_status', PaymentAttempt::ACTIVE_STATUSES)->count());
        $this->assertSame(1, DB::table('payment_attempts')->where('tenant_id', $this->tenantId)->count(), 'الخاسرون لا يتركون صفوفاً');
    }

    /** @test */
    public function conflicting_and_late_snapshots_applied_concurrently_end_monotonic_without_deadlock(): void
    {
        $attempt = $this->startOne('invoice:snapshots', 'snapshot-key-1');

        $jobs = [];
        foreach (['pending_customer', 'authorized', 'captured', 'captured', 'authorized', 'pending_customer'] as $status) {
            $jobs[] = $this->applier($attempt->id, $attempt->provider_payment_id, $status);
        }
        $results = $this->runConcurrently($jobs);

        $this->assertAllOk($results);
        $final = DB::table('payment_attempts')->where('id', $attempt->id)->first();
        $this->assertSame('captured', $final->capture_status);
        $this->assertSame(11500, (int) $final->captured_minor);
        $this->assertNotNull($final->captured_at);
        $this->assertNull($final->review_reasons, 'ترتيب الوصول لا يولّد مراجعة');
    }

    /** @test */
    public function identical_concurrent_syncs_of_a_capture_apply_exactly_once(): void
    {
        $attempt = $this->startOne('invoice:dupes', 'dupe-key-1');

        $results = $this->runConcurrently(array_fill(0, 6, $this->applier($attempt->id, $attempt->provider_payment_id, 'captured')));

        $this->assertAllOk($results);
        $applied = array_filter(array_column($results, 'value'), fn ($v) => $v['applied'] === true);
        $this->assertCount(1, $applied, 'انتقال فعلي واحد فقط');
        $this->assertSame('captured', DB::table('payment_attempts')->where('id', $attempt->id)->value('capture_status'));
    }

    /** @test */
    public function a_hard_tenant_delete_removes_attempts_and_gateways_together_despite_the_gateway_foreign_key(): void
    {
        $this->startOne('invoice:cascade', 'cascade-key-1');
        $this->assertSame(1, DB::table('payment_attempts')->where('tenant_id', $this->tenantId)->count());

        DB::table('tenants')->where('id', $this->tenantId)->delete();

        $this->assertSame(0, DB::table('payment_attempts')->where('tenant_id', $this->tenantId)->count());
        $this->assertSame(0, DB::table('payment_gateways')->where('tenant_id', $this->tenantId)->count());
    }

    // ───────────────────────── مساعدات ─────────────────────────

    private function startOne(string $payableKey, string $key): object
    {
        app(PaymentOrchestrator::class)->start(new TestPayable(key: $payableKey), PaymentGateway::query()->findOrFail($this->gatewayId), $key);

        return DB::table('payment_attempts')->where('idempotency_key', $key)->first();
    }

    private function starter(string $payableKey, string $key): callable
    {
        $tenant = $this->tenantId;
        $gateway = $this->gatewayId;

        return function () use ($payableKey, $key, $tenant, $gateway) {
            app(TenantContext::class)->set($tenant);
            app()->singleton(FakeGatewayAdapter::class);
            try {
                $attempt = app(PaymentOrchestrator::class)->start(new TestPayable(key: $payableKey), PaymentGateway::query()->findOrFail($gateway), $key);

                return ['id' => $attempt->id, 'status' => $attempt->capture_status];
            } catch (PaymentOrchestrationException $e) {
                return ['reason' => $e->reason];
            }
        };
    }

    private function applier(string $attemptId, string $providerPaymentId, string $status): callable
    {
        $tenant = $this->tenantId;

        return function () use ($attemptId, $providerPaymentId, $status, $tenant) {
            app(TenantContext::class)->set($tenant);
            $captured = $status === 'captured' ? 11500 : 0;
            $result = app(PaymentOrchestrator::class)->applySnapshot(
                PaymentAttempt::query()->findOrFail($attemptId),
                new ProviderPaymentSnapshot($providerPaymentId, $status, 11500, 'SAR', $captured),
            );

            return ['applied' => $result->applied, 'status' => $result->attempt->capture_status];
        };
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
