<?php

namespace Tests\Feature;

use App\Models\CommerceOrder;
use App\Models\InventoryReservation;
use App\Models\Product;
use App\Models\Warehouse;
use App\Services\Commerce\CommercePaymentIntentService;
use App\Models\CommercePaymentIntent;
use App\Models\PaymentAttempt;
use App\Models\PaymentGateway;
use App\Models\PaymentMethod;
use App\Models\PlatformAdministrator;
use App\Models\SalesChannel;
use App\Models\Tenant;
use App\Services\Commerce\CommerceOnlinePaymentException;
use App\Services\Commerce\CommerceOnlinePaymentService;
use App\Services\FakePaymentGatewayAdapter;
use App\Services\PaymentOrchestrator;
use App\Support\PaymentProviderSnapshot;
use App\Support\SchedulerHeartbeat;
use App\Tenancy\TenantContext;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use PHPUnit\Framework\Attributes\Test;
use Tests\TestCase;

/**
 * ═══════════════════════════════════════════════════════════════
 *  COMMERCE-ORDERS-O3a-2a (ADR-28 §4.1) — فصل إلغاء النية عن التنظيف على PostgreSQL حقيقي
 * ═══════════════════════════════════════════════════════════════
 *  1) لا أقفال صف على النية/الطلب/الحجز أثناء اتصال التنظيف بالمزوّد (اتصال ثانٍ بـ`FOR UPDATE NOWAIT`) ولا معاملة مفتوحة.
 *  2) لا جمود بين الإلغاء ومسار يمسك المحاولة ثم النية (ترتيب الترحيل/الالتقاط) — جولات متكرّرة بترتيبي بدء.
 *  3) إلغاءان متزامنان لنية واحدة ⇒ واحد ينجح والآخر يُرفض، والتنظيف أثر واحد بلا خطأ قاعدة.
 *  4) الإلغاء مقابل الالتقاط يبقى بلا حالة هجينة (تغطيته الأصلية في CommerceOnlinePaymentPostgresConcurrencyTest، وتُعاد هنا على الدالة المعاد هيكلتها).
 *
 *  على PostgreSQL **لا يُتخطّى** إن غاب `pcntl`: يفشل. يُتخطّى على SQLite فقط. بلا معاملة مُغلِّفة (الأطفال يحتاجون صفوفاً مثبَّتة).
 */
class CommerceIntentCancelPostgresTest extends TestCase
{
    use DiagnosesUnprovenScheduler;
    use UsesWorkerDatabaseWithoutTransaction;

    private string $dir;

    private string $tenantId;

    private string $orderId;

    private string $intentId;

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
            'pcntl/posix مطلوبان لاختبارات تزامن PostgreSQL؛ غيابهما فشل لا تخطٍّ (PAY-H4-04a).');
        config(['payments.commerce_online_checkout.enabled' => true]);

        $this->dir = sys_get_temp_dir().'/commerce_online_'.uniqid();
        mkdir($this->dir);

        $tenant = Tenant::create(['name' => 'دفع المتجر المتزامن', 'slug' => 'pay-h4-pg-'.Str::random(8), 'vat_number' => '300000000000013', 'currency' => 'SAR']);
        $this->tenants[] = $this->tenantId = $tenant->id;
        app(TenantContext::class)->set($this->tenantId);
        $admin = PlatformAdministrator::create(['name' => 'مشغّل', 'email' => Str::random(8).'@platform.test', 'password' => 'platform-password-123']);
        $this->admins[] = $admin->id;
        SchedulerHeartbeat::record();
        $this->enableTenantPaymentsOrDiagnose($admin, $this->tenantId, 'تفعيل اختبار التزامن');

        $channel = SalesChannel::create(['slug' => 'web', 'name' => 'Web', 'type' => SalesChannel::TYPE_WEB, 'is_active' => true]);
        $method = PaymentMethod::create(['name' => 'بطاقة', 'name_en' => 'Card', 'settlement_type' => 'bank', 'available_online' => true]);
        $gateway = PaymentGateway::query()->create(['provider' => 'fake', 'name' => 'Fake', 'environment' => 'sandbox', 'payment_method_id' => $method->id]);
        DB::table('payment_gateways')->where('id', $gateway->id)->update(['status' => 'active', 'is_active' => true]);

        $order = CommerceOrder::create(['sales_channel_id' => $channel->id, 'number' => 'CORD-OPC-'.uniqid(), 'status' => CommerceOrder::STATUS_CONFIRMED, 'total' => 5000, 'confirmed_at' => now()]);
        $this->orderId = $order->id;
        $this->intentId = CommercePaymentIntent::create([
            'commerce_order_id' => $order->id, 'payment_method_id' => $method->id, 'payment_method_name' => $method->name,
            'method' => CommercePaymentIntent::METHOD_ONLINE, 'status' => CommercePaymentIntent::STATUS_PENDING,
            'amount_minor' => 5000, 'currency' => 'SAR',
        ])->id;
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


    #[Test]
    public function the_provider_is_contacted_only_after_commit_and_with_no_row_lock_held(): void
    {
        $fake = $this->freshFake();
        $this->leaveCreatedAttempt($fake);
        $probe = [];
        $fake->onCheckout = function () use (&$probe): void {
            $probe = ['level' => DB::transactionLevel()] + $this->probeLocks();
        };

        app(CommercePaymentIntentService::class)->cancel(CommercePaymentIntent::findOrFail($this->intentId));

        $this->assertNotEmpty($probe, 'the cleanup must have contacted the provider (resolve checkout of the created attempt)');
        $this->assertSame(0, $probe['level'], 'no transaction is open while the provider is contacted');
        foreach (['commerce_payment_intents', 'commerce_orders', 'inventory_reservations'] as $table) {
            $this->assertSame('free', $probe[$table], "row of {$table} must not be locked during the provider call");
        }
        $this->assertSame('cancelled', DB::table('payment_attempts')->where('tenant_id', $this->tenantId)->value('capture_status'));
    }

    #[Test]
    public function nested_cancellation_holds_locks_until_the_outer_commit_and_contacts_the_provider_only_after(): void
    {
        $fake = $this->freshFake();
        $this->leaveCreatedAttempt($fake);
        $during = null;
        $afterCommitProbe = [];
        $fake->onCheckout = function () use (&$afterCommitProbe): void {
            $afterCommitProbe = ['level' => DB::transactionLevel()] + $this->probeLocks();
        };
        $callsBefore = count($fake->checkoutCalls);

        DB::transaction(function () use (&$during, $fake, $callsBefore): void {
            app(CommercePaymentIntentService::class)->cancel(CommercePaymentIntent::findOrFail($this->intentId));
            $during = ['provider_calls' => count($fake->checkoutCalls) - $callsBefore, 'level' => DB::transactionLevel()];
        });

        $this->assertSame(['provider_calls' => 0, 'level' => 1], $during, 'nothing is sent to the provider while the outer transaction is open');
        $this->assertSame(0, $afterCommitProbe['level'] ?? -1);
        $this->assertSame('free', $afterCommitProbe['commerce_payment_intents'] ?? null, 'locks are released by the time the provider is contacted');
    }

    #[Test]
    public function cancel_never_deadlocks_against_a_path_that_holds_the_attempt_then_the_intent(): void
    {
        foreach (range(1, 5) as $round) {
            $this->resetRound();
            $fake = $this->freshFake();
            $attemptId = $this->liveAttempt($fake);
            $tenant = $this->tenantId;
            $intentId = $this->intentId;
            $delay = 100000 + ($round % 3) * 80000;

            // مسار الترحيل/الالتقاط: المحاولة ثم النية (الترتيب القائم).
            $postingLike = function () use ($tenant, $attemptId, $intentId, $delay) {
                app(TenantContext::class)->set($tenant);
                DB::transaction(function () use ($attemptId, $intentId, $delay) {
                    PaymentAttempt::query()->lockForUpdate()->findOrFail($attemptId);
                    usleep($delay);
                    CommercePaymentIntent::query()->lockForUpdate()->findOrFail($intentId);
                    usleep(20000);
                });

                return ['held' => true];
            };
            $canceller = function () use ($tenant, $intentId, $round) {
                app(TenantContext::class)->set($tenant);
                config(['payments.commerce_online_checkout.enabled' => true]);
                app()->singleton(FakePaymentGatewayAdapter::class);
                usleep(($round % 2) * 40000); // بدء قبل/بعد المسار الآخر بالتناوب
                try {
                    app(CommercePaymentIntentService::class)->cancel(CommercePaymentIntent::findOrFail($intentId));

                    return ['cancelled' => true];
                } catch (\RuntimeException $e) {
                    return ['cancelled' => false, 'message' => $e->getMessage()];
                }
            };

            $results = $this->runConcurrently([$postingLike, $canceller]);
            $this->assertAllOk($results);
            $this->assertTrue($results[1]['value']['cancelled'], "الجولة {$round}: ".json_encode($results[1]));
            $this->assertSame('cancelled', DB::table('commerce_payment_intents')->where('id', $intentId)->value('status'));
            $this->assertSame('cancelled', DB::table('payment_attempts')->where('id', $attemptId)->value('capture_status'), "الجولة {$round}: التنظيف جرى بعد التحرّر");
        }
    }

    #[Test]
    public function two_concurrent_cancellations_produce_one_cancellation_and_one_cleanup(): void
    {
        foreach (range(1, 4) as $round) {
            $this->resetRound();
            $fake = $this->freshFake();
            $attemptId = $this->liveAttempt($fake);
            $tenant = $this->tenantId;
            $intentId = $this->intentId;

            $canceller = function () use ($tenant, $intentId) {
                app(TenantContext::class)->set($tenant);
                config(['payments.commerce_online_checkout.enabled' => true]);
                app()->singleton(FakePaymentGatewayAdapter::class);
                try {
                    app(CommercePaymentIntentService::class)->cancel(CommercePaymentIntent::findOrFail($intentId));

                    return ['cancelled' => true];
                } catch (\RuntimeException $e) {
                    return ['cancelled' => false];
                }
            };
            $results = $this->runConcurrently([$canceller, $canceller]);

            $this->assertAllOk($results);
            $winners = array_sum(array_map(fn ($r) => $r['value']['cancelled'] ? 1 : 0, $results));
            $this->assertSame(1, $winners, "الجولة {$round}: إلغاء واحد فقط ينجح");
            $this->assertSame('cancelled', DB::table('payment_attempts')->where('id', $attemptId)->value('capture_status'));
            $this->assertSame(1, DB::table('payment_attempts')->where('tenant_id', $this->tenantId)->count());
        }
    }

    #[Test]
    public function a_capture_racing_the_refactored_cancel_never_leaves_a_hybrid_state(): void
    {
        foreach (range(1, 4) as $round) {
            $this->resetRound();
            $fake = $this->freshFake();
            $attemptId = $this->liveAttempt($fake);
            $tenant = $this->tenantId;
            $intentId = $this->intentId;

            $canceller = function () use ($tenant, $intentId) {
                app(TenantContext::class)->set($tenant);
                try {
                    app(CommercePaymentIntentService::class)->cancel(CommercePaymentIntent::findOrFail($intentId));

                    return ['cancelled' => true];
                } catch (\RuntimeException $e) {
                    return ['cancelled' => false];
                }
            };
            $capturer = function () use ($tenant, $attemptId) {
                app(TenantContext::class)->set($tenant);
                $fresh = PaymentAttempt::query()->findOrFail($attemptId);
                app(PaymentOrchestrator::class)->applySnapshot($fresh, new PaymentProviderSnapshot((string) $fresh->provider_payment_id, 'captured', 5000, 'SAR', 5000));

                return ['paid' => app(CommerceOnlinePaymentService::class)->completeCaptured(PaymentAttempt::query()->findOrFail($fresh->id))];
            };
            $results = $this->runConcurrently([$capturer, $canceller]);

            $this->assertAllOk($results);
            $intent = DB::table('commerce_payment_intents')->where('id', $intentId)->first();
            if ($intent->status === 'paid') {
                $this->assertNull($intent->cancelled_at, "الجولة {$round}: مدفوعة ومُلغاة معاً");
            } else {
                $this->assertSame('cancelled', $intent->status);
                $reasons = json_decode((string) DB::table('payment_attempts')->where('id', $attemptId)->value('review_reasons'), true) ?: [];
                $this->assertContains(PaymentAttempt::REVIEW_LATE_CAPTURE, $reasons, "الجولة {$round}");
            }
        }
    }

    // ───────────────────────── مساعدات ─────────────────────────

    private function freshFake(): FakePaymentGatewayAdapter
    {
        config(['payments.commerce_online_checkout.enabled' => true]);
        app()->singleton(FakePaymentGatewayAdapter::class);
        app(TenantContext::class)->set($this->tenantId);

        return app(FakePaymentGatewayAdapter::class);
    }

    /** محاولة عالقة في `created` (انقطع المزوّد عند البدء): إغلاقها يتطلب اتصالاً بالمزوّد. */
    private function leaveCreatedAttempt(FakePaymentGatewayAdapter $fake): void
    {
        $this->seedHold();
        $fake->failNextCheckouts();
        try {
            app(CommerceOnlinePaymentService::class)->start(CommerceOrder::query()->findOrFail($this->orderId));
            $this->fail('the provider outage must surface at start');
        } catch (CommerceOnlinePaymentException) {
            // المتوقَّع.
        }
        $this->assertSame('created', DB::table('payment_attempts')->where('tenant_id', $this->tenantId)->value('capture_status'));
    }

    private function liveAttempt(FakePaymentGatewayAdapter $fake): string
    {
        $this->seedHold();

        return app(CommerceOnlinePaymentService::class)->start(CommerceOrder::query()->findOrFail($this->orderId))['attempt']->id;
    }

    /** حجز فعّال لطلب الاختبار (لتمرين قفل صفوف الحجز). */
    private function seedHold(): void
    {
        $warehouse = Warehouse::query()->first() ?? Warehouse::create(['name' => 'مخزن', 'code' => 'W-'.Str::random(4), 'is_default' => true]);
        $product = Product::query()->first() ?? Product::create(['name' => 'منتج', 'sku' => 'P-'.Str::random(6), 'unit' => 'piece', 'sale_price' => 5000, 'is_active' => true, 'track_inventory' => true]);
        DB::table('inventory_reservations')->where('source_id', $this->orderId)->delete();
        InventoryReservation::create([
            'warehouse_id' => $warehouse->id, 'product_id' => $product->id, 'base_quantity' => 1, 'status' => InventoryReservation::STATUS_ACTIVE,
            'source_type' => CommerceOrder::class, 'source_id' => $this->orderId, 'idempotency_key' => 'hold-'.Str::random(10), 'request_checksum' => Str::random(16),
            'expires_at' => now('UTC')->addHour(),
        ]);
    }

    /**
     * يجرّب قفل صف النية والطلب والحجز من **اتصال ثانٍ** بـ`FOR UPDATE NOWAIT`: `free` إن نجح (لا قفل)، `LOCKED` إن فشل.
     *
     * @return array<string, string>
     */
    private function probeLocks(): array
    {
        $second = app(\Illuminate\Database\Connectors\ConnectionFactory::class)->make(config('database.connections.'.config('database.default')), 'lock_probe');
        $ids = [
            'commerce_payment_intents' => $this->intentId,
            'commerce_orders' => $this->orderId,
            'inventory_reservations' => (string) DB::table('inventory_reservations')->where('source_id', $this->orderId)->value('id'),
        ];
        $out = [];
        foreach ($ids as $table => $id) {
            try {
                $second->select("select id from {$table} where id = ? for update nowait", [$id]);
                $out[$table] = 'free';
            } catch (\Throwable $e) {
                $out[$table] = str_contains($e->getMessage(), '55P03') ? 'LOCKED' : 'error: '.$e->getMessage();
            }
        }
        $second->disconnect();

        return $out;
    }

    private function resetRound(): void
    {
        DB::table('payment_attempts')->where('tenant_id', $this->tenantId)->delete();
        DB::table('inventory_reservations')->where('source_id', $this->orderId)->delete();
        DB::table('commerce_payment_intents')->where('id', $this->intentId)->update(['status' => 'pending', 'paid_at' => null, 'cancelled_at' => null]);
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
