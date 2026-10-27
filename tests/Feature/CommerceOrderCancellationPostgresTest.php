<?php

namespace Tests\Feature;

use App\Models\CommerceOrder;
use App\Models\InventoryReservation;
use App\Models\Product;
use App\Models\Warehouse;
use App\Models\User;
use App\Services\Commerce\CommerceOrderLifecycleService;
use App\Services\Commerce\CommerceOrderCancellationException;
use App\Services\Commerce\CommerceUnpaidOrderSweeper;
use App\Services\Commerce\OrderCancellationCleanup;
use App\Services\Commerce\CommercePaymentIntentService;
use Illuminate\Support\Facades\Event;
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
 *  COMMERCE-ORDERS-O3a-2b (ADR-28 §4/§7) — تزامن إلغاء الطلب على PostgreSQL حقيقي
 * ═══════════════════════════════════════════════════════════════
 *  إلغاء ↔ التقاط · إلغاء ↔ مسار الترحيل (ترتيب الأقفال: محاولة ← نية ← طلب) · إلغاء ↔ تحصيل COD · إلغاء ↔ المكنسة · إلغاءان متزامنان ·
 *  تراجع كامل بفشل بعد انتقال النية · فشل المزوّد بعد الالتزام · لا أقفال صف أثناء اتصال التنظيف بالمزوّد · لا جمود (40P01) · لا «ملغى ∧ مدفوع».
 *
 *  على PostgreSQL **لا يُتخطّى** إن غاب `pcntl`: يفشل. يُتخطّى على SQLite فقط. بلا معاملة مُغلِّفة (الأطفال يحتاجون صفوفاً مثبَّتة).
 */
class CommerceOrderCancellationPostgresTest extends TestCase
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


    private string $actorId;

    /** @return array{cancelled: bool, reason: ?string} نتيجة إلغاء الطلب بالخدمة الحقيقية داخل عملية الطفل. */
    private function lifecycleCancel(string $tenant, string $orderId, string $actor): array
    {
        app(TenantContext::class)->set($tenant);
        try {
            $order = CommerceOrder::query()->findOrFail($orderId);
            app(CommerceOrderLifecycleService::class)->cancel($order, User::query()->withoutGlobalScopes()->findOrFail($actor), 'customer_request', null);

            return ['cancelled' => true, 'reason' => null];
        } catch (CommerceOrderCancellationException $e) {
            return ['cancelled' => false, 'reason' => $e->reason];
        }
    }

    private function actor(): string
    {
        return $this->actorId ??= User::create(['tenant_id' => $this->tenantId, 'name' => 'مشرف', 'email' => 'sup-'.Str::random(6).'@pg.test', 'password' => 'password123', 'role' => 'admin'])->id;
    }

    private function orderRow(): object
    {
        return DB::table('commerce_orders')->where('id', $this->orderId)->first();
    }

    private function intentRow(): object
    {
        return DB::table('commerce_payment_intents')->where('id', $this->intentId)->first();
    }

    #[Test]
    public function the_provider_is_contacted_only_after_commit_with_no_row_lock_held_and_no_open_transaction(): void
    {
        $fake = $this->freshFake();
        $this->leaveCreatedAttempt($fake);
        $probe = [];
        $fake->onCheckout = function () use (&$probe): void {
            $probe = ['level' => DB::transactionLevel()] + $this->probeLocks();
        };

        $result = $this->lifecycleCancel($this->tenantId, $this->orderId, $this->actor());

        $this->assertTrue($result['cancelled']);
        $this->assertNotEmpty($probe, 'cleanup must contact the provider (resolve the created attempt)');
        $this->assertSame(0, $probe['level']);
        foreach (['commerce_payment_intents', 'commerce_orders', 'inventory_reservations'] as $table) {
            $this->assertSame('free', $probe[$table], "row of {$table} must not be locked during the provider call");
        }
        $this->assertSame('cancelled', DB::table('payment_attempts')->where('tenant_id', $this->tenantId)->value('capture_status'));
        $this->assertNotNull($this->orderRow()->cancelled_at);
    }

    #[Test]
    public function a_failure_after_the_intent_transition_rolls_everything_back_on_postgres_and_releases_every_lock(): void
    {
        $fake = $this->freshFake();
        $this->leaveCreatedAttempt($fake);
        $calls = count($fake->checkoutCalls);
        Event::listen('eloquent.updating: '.CommerceOrder::class, function (CommerceOrder $order): void {
            if ($order->isDirty('cancelled_at')) {
                throw new \RuntimeException('injected failure after the intent transition');
            }
        });

        try {
            $this->lifecycleCancel($this->tenantId, $this->orderId, $this->actor());
            $this->fail('the injected failure must surface');
        } catch (\RuntimeException $e) {
            $this->assertStringContainsString('injected failure', $e->getMessage());
        }
        Event::forget('eloquent.updating: '.CommerceOrder::class);

        $this->assertNull($this->orderRow()->cancelled_at);
        $this->assertSame('pending', $this->intentRow()->status);
        $this->assertNull($this->intentRow()->cancelled_at);
        $this->assertSame('active', DB::table('inventory_reservations')->where('source_id', $this->orderId)->value('status'));
        $this->assertSame('created', DB::table('payment_attempts')->where('tenant_id', $this->tenantId)->value('capture_status'), 'the attempt was never touched');
        $this->assertSame($calls, count($fake->checkoutCalls), 'the provider was never contacted');
        $this->assertSame(0, DB::transactionLevel());
        foreach ($this->probeLocks() as $table => $state) {
            $this->assertSame('free', $state, "{$table} must be unlocked after the rollback");
        }
    }

    #[Test]
    public function a_provider_failure_after_the_commit_leaves_a_consistent_order_and_the_reconciler_recovers(): void
    {
        $fake = $this->freshFake();
        $this->leaveCreatedAttempt($fake);
        $fake->failNextCheckouts();

        $result = $this->lifecycleCancel($this->tenantId, $this->orderId, $this->actor());

        $this->assertTrue($result['cancelled'], 'the response reflects the transaction, not the cleanup');
        $this->assertNotNull($this->orderRow()->cancelled_at);
        $this->assertSame('cancelled', $this->intentRow()->status);
        $this->assertSame('released', DB::table('inventory_reservations')->where('source_id', $this->orderId)->value('status'));
        $this->assertSame('created', DB::table('payment_attempts')->where('tenant_id', $this->tenantId)->value('capture_status'));

        DB::table('commerce_payment_intents')->where('id', $this->intentId)->update(['cancelled_at' => now('UTC')->subMinutes(10)]);
        $this->assertSame(1, app(OrderCancellationCleanup::class)->runPending()['cleaned']);
        $this->assertSame('cancelled', DB::table('payment_attempts')->where('tenant_id', $this->tenantId)->value('capture_status'));
    }

    #[Test]
    public function cancel_vs_capture_never_leaves_a_cancelled_and_paid_order(): void
    {
        foreach (range(1, 5) as $round) {
            $this->resetRound();
            $fake = $this->freshFake();
            $attemptId = $this->liveAttempt($fake);
            $tenant = $this->tenantId;
            $orderId = $this->orderId;
            $actor = $this->actor();

            $canceller = fn () => $this->lifecycleCancel($tenant, $orderId, $actor);
            $capturer = function () use ($tenant, $attemptId) {
                app(TenantContext::class)->set($tenant);
                $fresh = PaymentAttempt::query()->findOrFail($attemptId);
                app(PaymentOrchestrator::class)->applySnapshot($fresh, new PaymentProviderSnapshot((string) $fresh->provider_payment_id, 'captured', 5000, 'SAR', 5000));

                return ['paid' => app(CommerceOnlinePaymentService::class)->completeCaptured(PaymentAttempt::query()->findOrFail($fresh->id))];
            };
            $results = $round % 2 === 0 ? $this->runConcurrently([$capturer, $canceller]) : $this->runConcurrently([$canceller, $capturer]);

            $this->assertAllOk($results);
            $order = $this->orderRow();
            $intent = $this->intentRow();
            $this->assertFalse($order->cancelled_at !== null && in_array($intent->status, ['paid', 'collected'], true), "الجولة {$round}: ملغى ومدفوع معاً");
            if ($order->cancelled_at !== null) {
                $this->assertSame('cancelled', $intent->status);
                $this->assertSame('released', DB::table('inventory_reservations')->where('source_id', $this->orderId)->value('status'));
                $reasons = json_decode((string) DB::table('payment_attempts')->where('id', $attemptId)->value('review_reasons'), true) ?: [];
                $captured = DB::table('payment_attempts')->where('id', $attemptId)->value('capture_status') === 'captured';
                $this->assertTrue(! $captured || in_array(PaymentAttempt::REVIEW_LATE_CAPTURE, $reasons, true), "الجولة {$round}: التقاط بعد الإلغاء يُوسم late_capture");
            } else {
                $this->assertSame('paid', $intent->status, "الجولة {$round}");
                $cancelResult = collect($results)->pluck('value')->first(fn ($v) => array_key_exists('cancelled', $v ?? []));
                $this->assertFalse($cancelResult['cancelled'], "الجولة {$round}");
                $this->assertContains($cancelResult['reason'], ['payment_paid', 'payment_captured'], "الجولة {$round}: رفض بالرمز الصحيح لا بخطأ عام");
            }
        }
    }

    #[Test]
    public function cancel_vs_the_posting_lock_path_never_deadlocks_and_stays_consistent(): void
    {
        // مسار الترحيل الحقيقي يقفل المحاولة ثم النية ثم الطلب (PaymentAttemptPostingService → CommerceOrderPostingService). نعيد
        // هذا الترتيب نفسه بالتوازي مع الإلغاء (النية ← الطلب ← الحجز) بترتيبي بدء وفواصل مختلفة: لا 40P01، ونتيجة واحدة متسقة.
        foreach (range(1, 6) as $round) {
            $this->resetRound();
            $fake = $this->freshFake();
            $attemptId = $this->liveAttempt($fake);
            $tenant = $this->tenantId;
            $orderId = $this->orderId;
            $intentId = $this->intentId;
            $actor = $this->actor();
            $delay = 100000 + ($round % 3) * 80000;

            $postingLike = function () use ($tenant, $attemptId, $intentId, $orderId, $delay) {
                app(TenantContext::class)->set($tenant);
                DB::transaction(function () use ($attemptId, $intentId, $orderId, $delay) {
                    PaymentAttempt::query()->lockForUpdate()->findOrFail($attemptId);
                    usleep($delay);
                    CommercePaymentIntent::query()->lockForUpdate()->findOrFail($intentId);
                    usleep(20000);
                    CommerceOrder::query()->lockForUpdate()->findOrFail($orderId);
                    usleep(20000);
                });

                return ['held' => true];
            };
            $canceller = function () use ($tenant, $orderId, $actor, $round) {
                usleep(($round % 2) * 40000);

                return $this->lifecycleCancel($tenant, $orderId, $actor);
            };
            $results = $this->runConcurrently([$postingLike, $canceller]);

            $this->assertAllOk($results);
            $this->assertTrue($results[1]['value']['cancelled'], "الجولة {$round}: ".json_encode($results[1]));
            $this->assertNotNull($this->orderRow()->cancelled_at);
            $this->assertSame('cancelled', $this->intentRow()->status);
            $this->assertSame('cancelled', DB::table('payment_attempts')->where('id', $attemptId)->value('capture_status'), "الجولة {$round}: التنظيف بعد التحرّر");
        }
    }

    #[Test]
    public function cancel_vs_cod_collection_has_exactly_one_winner(): void
    {
        foreach (range(1, 5) as $round) {
            $this->resetRound();
            DB::table('payment_attempts')->where('tenant_id', $this->tenantId)->delete();
            DB::table('commerce_payment_intents')->where('id', $this->intentId)->update(['method' => 'cod', 'status' => 'awaiting_collection', 'collected_at' => null]);
            $tenant = $this->tenantId;
            $orderId = $this->orderId;
            $intentId = $this->intentId;
            $actor = $this->actor();

            $canceller = fn () => $this->lifecycleCancel($tenant, $orderId, $actor);
            $collector = function () use ($tenant, $intentId) {
                app(TenantContext::class)->set($tenant);
                try {
                    app(CommercePaymentIntentService::class)->markCollected(CommercePaymentIntent::findOrFail($intentId));

                    return ['collected' => true];
                } catch (\RuntimeException) {
                    return ['collected' => false];
                }
            };
            $results = $round % 2 === 0 ? $this->runConcurrently([$collector, $canceller]) : $this->runConcurrently([$canceller, $collector]);

            $this->assertAllOk($results);
            $byCancel = $this->orderRow()->cancelled_at !== null;
            $byCollect = $this->intentRow()->status === 'collected';
            $this->assertNotSame($byCancel, $byCollect, "الجولة {$round}: فائز واحد بالضبط");
            $this->assertFalse($byCancel && $byCollect);
            if (! $byCancel) {
                $this->assertSame('payment_collected', collect($results)->pluck('value.reason')->filter()->first());
            }
        }
    }

    #[Test]
    public function cancel_vs_the_sweeper_converges_to_one_cancelled_order_with_one_release(): void
    {
        foreach (range(1, 5) as $round) {
            $this->resetRound();
            DB::table('payment_attempts')->where('tenant_id', $this->tenantId)->delete();
            $this->seedHold();
            DB::table('inventory_reservations')->where('source_id', $this->orderId)->update(['expires_at' => now('UTC')->subMinute()]);
            $tenant = $this->tenantId;
            $orderId = $this->orderId;
            $actor = $this->actor();

            $canceller = fn () => $this->lifecycleCancel($tenant, $orderId, $actor);
            $sweeper = function () {
                config(['payments.commerce_online_checkout.enabled' => true]);
                app()->singleton(FakePaymentGatewayAdapter::class);

                return app(CommerceUnpaidOrderSweeper::class)->run();
            };
            $results = $round % 2 === 0 ? $this->runConcurrently([$sweeper, $canceller]) : $this->runConcurrently([$canceller, $sweeper]);

            $this->assertAllOk($results);
            $this->assertTrue($results[$round % 2 === 0 ? 1 : 0]['value']['cancelled'], "الجولة {$round}: إلغاء الموظف ينجح (إما فعّالاً أو إقفالاً إدارياً صف 9)");
            $this->assertNotNull($this->orderRow()->cancelled_at);
            $this->assertSame('cancelled', $this->intentRow()->status);
            $this->assertSame(['released'], DB::table('inventory_reservations')->where('source_id', $this->orderId)->pluck('status')->all());
            $this->assertSame(0, DB::table('stock_movements')->count());
        }
    }

    #[Test]
    public function two_concurrent_cancellations_are_idempotent_with_one_effect(): void
    {
        foreach (range(1, 4) as $round) {
            $this->resetRound();
            $fake = $this->freshFake();
            $attemptId = $this->liveAttempt($fake);
            $tenant = $this->tenantId;
            $orderId = $this->orderId;
            $actor = $this->actor();

            $canceller = fn () => $this->lifecycleCancel($tenant, $orderId, $actor);
            $results = $this->runConcurrently([$canceller, $canceller]);

            $this->assertAllOk($results);
            foreach ($results as $i => $r) {
                $this->assertTrue($r['value']['cancelled'], "الجولة {$round}: الاستدعاء {$i} يرجع بالحالة نفسها (idempotent)");
            }
            $order = $this->orderRow();
            $this->assertNotNull($order->cancelled_at);
            $this->assertSame($actor, $order->cancelled_by_user_id);
            $this->assertSame('cancelled', DB::table('payment_attempts')->where('id', $attemptId)->value('capture_status'));
            $this->assertSame(['released'], DB::table('inventory_reservations')->where('source_id', $this->orderId)->pluck('status')->all());
            $this->assertSame(1, DB::table('payment_attempts')->where('tenant_id', $this->tenantId)->count());
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
        DB::table('commerce_payment_intents')->where('id', $this->intentId)->update(['method' => 'online', 'status' => 'pending', 'paid_at' => null, 'cancelled_at' => null, 'collected_at' => null]);
        DB::table('commerce_orders')->where('id', $this->orderId)->update(['status' => 'confirmed']);
        DB::statement('ALTER TABLE commerce_orders DISABLE TRIGGER USER');
        DB::table('commerce_orders')->where('id', $this->orderId)->update(['cancelled_at' => null, 'cancelled_by_user_id' => null, 'cancellation_reason' => null, 'cancellation_note' => null]);
        DB::statement('ALTER TABLE commerce_orders ENABLE TRIGGER USER');
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
