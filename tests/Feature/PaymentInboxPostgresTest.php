<?php

namespace Tests\Feature;

use App\Models\PaymentAttempt;
use App\Models\PaymentGateway;
use App\Models\PlatformAdministrator;
use App\Models\Tenant;
use App\Models\User;
use App\Services\FakePaymentGatewayAdapter;
use App\Services\PaymentAttemptReconciler;
use App\Services\PaymentOrchestrator;
use App\Services\PaymentsRolloutControlService;
use App\Services\PaymentWebhookInbox;
use App\Support\SchedulerHeartbeat;
use App\Tenancy\TenantContext;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * ═══════════════════════════════════════════════════════════════
 *  PAY-H1-04 — صندوق الأحداث والمطابِق المجدول تحت تزامن حقيقي (PostgreSQL + `pcntl_fork`)
 * ═══════════════════════════════════════════════════════════════
 *  1) تسليمات متطابقة متزامنة لحدث واحد ⇒ صف واحد، والكل ينجح (200) بلا جمود، والمحاولة ملتقَطة مرة واحدة.
 *  2) أحداث مختلفة لمحاولة واحدة متزامنة ⇒ صفوف بعددها، والحالة النهائية رتيبة بلا مراجعة.
 *  3) مطابِقات متزامنة لمحاولات متعثّرة ⇒ كل محاولة تنتقل مرة واحدة فعلياً بلا جمود ولا إيجار عالق.
 *
 *  لا يُتخطّى على PostgreSQL إن غاب `pcntl` (يفشل). يُتخطّى على SQLite فقط. لا يستعمل RefreshDatabase.
 */
class PaymentInboxPostgresTest extends TestCase
{
    use UsesWorkerDatabaseWithoutTransaction;

    private const SECRET = 'whsec_inbox_pg';

    private string $dir;

    private string $tenantId;

    private PaymentGateway $gateway;

    private FakePaymentGatewayAdapter $fake;

    /** @var list<string> */
    private array $tenants = [];

    protected function setUp(): void
    {
        parent::setUp();

        if (DB::connection()->getDriverName() !== 'pgsql') {
            $this->markTestSkipped('يتطلب PostgreSQL حقيقياً — SQLite لا يُظهر تنافساً على أقفال الصفوف.');
        }
        $this->assertTrue(function_exists('pcntl_fork') && function_exists('posix_kill'),
            'pcntl/posix مطلوبان لاختبارات تزامن PostgreSQL؛ غيابهما فشل لا تخطٍّ (PAY-H1-04).');

        $this->dir = sys_get_temp_dir().'/payment_inbox_'.uniqid();
        mkdir($this->dir);

        $tenant = Tenant::create(['name' => 'صندوق متزامن', 'slug' => 'pay-h1-04-pg-'.Str::random(8), 'vat_number' => '300000000000013', 'currency' => 'SAR']);
        $this->tenants[] = $this->tenantId = $tenant->id;
        app(TenantContext::class)->set($this->tenantId);
        User::create(['tenant_id' => $this->tenantId, 'name' => 'المالك', 'email' => Str::random(8).'@pay.test', 'password' => 'password123', 'role' => 'owner']);
        $admin = PlatformAdministrator::create(['name' => 'مشغّل', 'email' => Str::random(8).'@platform.test', 'password' => 'platform-password-123']);
        SchedulerHeartbeat::record();
        app(PaymentsRolloutControlService::class)->setTenantState($admin, $this->tenantId, true, 'تفعيل اختبار التزامن');

        $this->gateway = PaymentGateway::query()->create(['provider' => 'fake', 'name' => 'Fake', 'environment' => 'sandbox', 'webhook_secret' => self::SECRET]);
        DB::table('payment_gateways')->where('id', $this->gateway->id)->update(['status' => 'active', 'is_active' => true]);
        $this->gateway = $this->gateway->fresh();

        // الأطفال يرثون الذاكرة عند الـfork: برمجة المحوّل الوهمي قبله تصل إليهم.
        $this->app->singleton(FakePaymentGatewayAdapter::class);
        $this->fake = app(FakePaymentGatewayAdapter::class);
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
            DB::table('platform_runtime_heartbeats')->where('component', SchedulerHeartbeat::COMPONENT)->delete();
        }

        parent::tearDown();
    }

    /** @test */
    public function identical_concurrent_deliveries_store_one_event_and_capture_once(): void
    {
        $attempt = $this->attempt('invoice:pg-1', 'pg-key-0001');
        $this->fake->script($attempt->provider_payment_id, 'captured');
        $body = (string) json_encode(['id' => 'evt_pg_1', 'type' => 'payment.updated', 'payment_id' => $attempt->provider_payment_id]);

        $results = $this->runConcurrently(array_fill(0, 6, $this->deliverer($body)));

        $this->assertAllOk($results);
        foreach ($results as $i => $r) {
            $this->assertSame(200, $r['value']['http'], "التسليم {$i}");
        }
        $this->assertSame(1, DB::table('payment_provider_events')->where('tenant_id', $this->tenantId)->count());
        $row = DB::table('payment_attempts')->where('id', $attempt->id)->first();
        $this->assertSame('captured', $row->capture_status);
        $this->assertNull($row->review_reasons);
        $this->assertSame('processed', DB::table('payment_provider_events')->where('tenant_id', $this->tenantId)->value('status'));
    }

    /** @test */
    public function distinct_concurrent_events_for_one_attempt_end_monotonic_without_deadlock(): void
    {
        $attempt = $this->attempt('invoice:pg-2', 'pg-key-0002');
        $this->fake->script($attempt->provider_payment_id, 'captured');

        $jobs = [];
        foreach (range(1, 6) as $i) {
            $jobs[] = $this->deliverer((string) json_encode(['id' => "evt_pg_2_{$i}", 'type' => 'payment.updated', 'payment_id' => $attempt->provider_payment_id]));
        }
        $results = $this->runConcurrently($jobs);

        $this->assertAllOk($results);
        $this->assertSame(6, DB::table('payment_provider_events')->where('tenant_id', $this->tenantId)->count());
        $this->assertSame(6, DB::table('payment_provider_events')->where('tenant_id', $this->tenantId)->where('status', 'processed')->count());
        $row = DB::table('payment_attempts')->where('id', $attempt->id)->first();
        $this->assertSame('captured', $row->capture_status);
        $this->assertNull($row->review_reasons, 'ترتيب الوصول لا يولّد مراجعة');
    }

    /** @test */
    public function concurrent_reconcilers_move_each_stuck_attempt_exactly_once(): void
    {
        $ids = [];
        foreach (range(1, 4) as $i) {
            $attempt = $this->attempt("invoice:pg-rc-{$i}", "pg-rc-key-000{$i}");
            DB::table('payment_attempts')->where('id', $attempt->id)->update(['created_at' => now('UTC')->subHour()]);
            $this->fake->script($attempt->provider_payment_id, 'captured');
            $ids[] = $attempt->id;
        }
        $reconciler = function () {
            app(TenantContext::class)->forget();
            $summary = app(PaymentAttemptReconciler::class)->run();

            return $summary;
        };

        $results = $this->runConcurrently(array_fill(0, 4, $reconciler));

        $this->assertAllOk($results);
        $applied = array_sum(array_map(fn ($r) => $r['value']['applied'], $results));
        $this->assertSame(4, $applied, 'كل محاولة تنتقل مرة واحدة فعلياً');
        foreach ($ids as $id) {
            $row = DB::table('payment_attempts')->where('id', $id)->first();
            $this->assertSame('captured', $row->capture_status);
            $this->assertNull($row->reconcile_lease_until, 'لا إيجار عالق');
            $this->assertNull($row->review_reasons);
        }
    }

    // ───────────────────────── مساعدات ─────────────────────────

    private function attempt(string $payableKey, string $key): object
    {
        app(PaymentOrchestrator::class)->start(new TestPayable(key: $payableKey), $this->gateway, $key);

        return DB::table('payment_attempts')->where('idempotency_key', $key)->first();
    }

    private function deliverer(string $body): callable
    {
        $key = $this->gateway->webhook_key;

        return function () use ($body, $key) {
            app(TenantContext::class)->forget();
            $result = app(PaymentWebhookInbox::class)->receive('fake', $key, $body, ['x-fake-signature' => FakePaymentGatewayAdapter::sign($body, self::SECRET)]);

            return ['http' => $result->httpStatus, 'status' => $result->status];
        };
    }

    private function assertAllOk(array $results): void
    {
        foreach ($results as $i => $result) {
            $this->assertTrue($result['ok'] ?? false, "العملية {$i}: ".($result['error_class'] ?? '').' '.($result['message'] ?? ''));
            $message = (string) ($result['message'] ?? '');
            $this->assertFalse(str_contains($message, '40P01') || stripos($message, 'deadlock') !== false, "جمود في العملية {$i}");
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
