<?php

namespace Tests\Feature;

use App\Models\CommerceOrder;
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
 *  PAY-H4-04a — الدفع الإلكتروني لطلب المتجر تحت تزامن حقيقي (PostgreSQL + `pcntl_fork`)
 * ═══════════════════════════════════════════════════════════════
 *  1) بدء الدفع متزامن (٦ طلبات) ⇒ محاولة واحدة، والكل يحصل على المحاولة نفسها (لا تحصيل مزدوج).
 *  2) تثبيت الالتقاط متزامن (٦ مرات) ⇒ النية مدفوعة مرة واحدة بـ`paid_at` ثابت، بلا جمود ولا خطأ.
 *  3) التقاط يسابق إلغاء الإدارة للنية ⇒ لا حالة هجينة: إما مدفوعة (والإلغاء مرفوض) أو ملغاة (والالتقاط يُوسم late_capture).
 *
 *  على PostgreSQL **لا يُتخطّى** إن غاب `pcntl`: يفشل. يُتخطّى على SQLite فقط. بلا معاملة مُغلِّفة (الأطفال يحتاجون صفوفاً مثبَّتة)؛
 *  `tearDown` يحذف المستأجر المتسلسل.
 */
class CommerceOnlinePaymentPostgresConcurrencyTest extends TestCase
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
    public function concurrent_starts_for_one_order_produce_one_attempt_and_everyone_gets_it(): void
    {
        $results = $this->runConcurrently(array_fill(0, 6, $this->starter()));

        $this->assertAllOk($results);
        $ids = array_unique(array_filter(array_column(array_column($results, 'value'), 'id')));
        $this->assertCount(1, $ids, 'الكل يحصل على المحاولة نفسها');
        $this->assertSame(1, DB::table('payment_attempts')->where('tenant_id', $this->tenantId)->count(), 'محاولة واحدة فقط لدى المزوّد');
        $attempt = DB::table('payment_attempts')->where('tenant_id', $this->tenantId)->first();
        $this->assertSame('pending_customer', $attempt->capture_status);
        $this->assertSame('commerce_payment_intent:'.$this->intentId, $attempt->payable_key);
        $this->assertSame(5000, (int) $attempt->amount_minor);
    }

    #[Test]
    public function concurrent_completions_of_a_capture_mark_the_intent_paid_exactly_once(): void
    {
        $attemptId = $this->startAndCapture();

        $results = $this->runConcurrently(array_fill(0, 6, $this->completer($attemptId)));

        $this->assertAllOk($results);
        foreach (array_column($results, 'value') as $value) {
            $this->assertTrue($value['paid'], 'كل مستدعٍ يرى النية مدفوعة (idempotent)');
        }
        $intent = DB::table('commerce_payment_intents')->where('id', $this->intentId)->first();
        $this->assertSame('paid', $intent->status);
        $this->assertNotNull($intent->paid_at);
        $this->assertSame(1, DB::table('commerce_payment_intents')->where('tenant_id', $this->tenantId)->where('status', 'paid')->count());
        $this->assertSame(1, DB::table('payment_attempts')->where('tenant_id', $this->tenantId)->count());
    }

    #[Test]
    public function a_capture_racing_an_admin_cancel_never_leaves_a_hybrid_state(): void
    {
        foreach (range(1, 4) as $round) {
            $this->resetOrderForRound();
            app(TenantContext::class)->set($this->tenantId);
            $attempt = app(CommerceOnlinePaymentService::class)->start($this->order())['attempt'];
            $tenant = $this->tenantId;
            $intentId = $this->intentId;

            $canceller = function () use ($tenant, $intentId) {
                app(TenantContext::class)->set($tenant);
                try {
                    app(\App\Services\Commerce\CommercePaymentIntentService::class)->cancel(CommercePaymentIntent::findOrFail($intentId));

                    return ['cancelled' => true];
                } catch (\RuntimeException $e) {
                    return ['cancelled' => false];
                }
            };
            $capturer = function () use ($tenant, $attempt) {
                app(TenantContext::class)->set($tenant);
                $fresh = PaymentAttempt::query()->findOrFail($attempt->id);
                app(PaymentOrchestrator::class)->applySnapshot($fresh, new PaymentProviderSnapshot((string) $fresh->provider_payment_id, 'captured', 5000, 'SAR', 5000));

                return ['paid' => app(CommerceOnlinePaymentService::class)->completeCaptured(PaymentAttempt::query()->findOrFail($fresh->id))];
            };
            $results = $this->runConcurrently([$capturer, $canceller]);

            $this->assertAllOk($results);
            $intent = DB::table('commerce_payment_intents')->where('id', $intentId)->first();
            $row = DB::table('payment_attempts')->where('id', $attempt->id)->first();
            $this->assertSame('captured', $row->capture_status, "الجولة {$round}: ما التقطه المزوّد يبقى ملتقَطاً دائماً");
            if ($intent->status === 'paid') {
                $this->assertNull($intent->cancelled_at, "الجولة {$round}: مدفوعة ومُلغاة معاً");
            } else {
                $this->assertSame('cancelled', $intent->status, "الجولة {$round}");
                $reasons = json_decode((string) $row->review_reasons, true) ?: [];
                $this->assertContains(PaymentAttempt::REVIEW_LATE_CAPTURE, $reasons, "الجولة {$round}: التقاط على نية ملغاة يجب أن يُوسم للمراجعة");
            }
        }
    }

    #[Test]
    public function the_unpaid_sweeper_racing_a_capture_never_pays_an_order_whose_hold_was_released(): void
    {
        app(TenantContext::class)->set($this->tenantId);
        $product = \App\Models\Product::create(['name' => 'منتج مكنسة', 'sku' => 'SW-'.uniqid(), 'unit' => 'piece', 'sale_price' => 5000, 'is_active' => true, 'track_inventory' => true]);
        $warehouse = \App\Models\Warehouse::create(['name' => 'مخزن مكنسة', 'code' => 'SW-'.uniqid(), 'is_default' => true]);

        foreach (range(1, 4) as $round) {
            $this->resetOrderForRound();
            DB::table('inventory_reservations')->where('tenant_id', $this->tenantId)->delete();
            \App\Models\InventoryReservation::create([
                'tenant_id' => $this->tenantId, 'warehouse_id' => $warehouse->id, 'product_id' => $product->id, 'base_quantity' => 1,
                'status' => 'active', 'source_type' => CommerceOrder::class, 'source_id' => $this->orderId,
                'idempotency_key' => 'sweep-race-'.$round.'-'.uniqid(), 'request_checksum' => str_repeat('a', 64), 'expires_at' => now('UTC')->subMinute(),
            ]);
            $attempt = app(CommerceOnlinePaymentService::class)->start($this->order())['attempt'];
            $tenant = $this->tenantId;

            $capturer = function () use ($tenant, $attempt) {
                app(TenantContext::class)->set($tenant);
                $fresh = PaymentAttempt::query()->findOrFail($attempt->id);
                app(PaymentOrchestrator::class)->applySnapshot($fresh, new PaymentProviderSnapshot((string) $fresh->provider_payment_id, 'captured', 5000, 'SAR', 5000));

                return ['paid' => app(CommerceOnlinePaymentService::class)->completeCaptured(PaymentAttempt::query()->findOrFail($fresh->id))];
            };
            $sweeper = function () {
                app()->singleton(FakePaymentGatewayAdapter::class);

                return app(\App\Services\Commerce\CommerceUnpaidOrderSweeper::class)->run();
            };
            $results = $this->runConcurrently([$capturer, $sweeper]);

            $this->assertAllOk($results);
            $intent = DB::table('commerce_payment_intents')->where('id', $this->intentId)->first();
            $hold = DB::table('inventory_reservations')->where('tenant_id', $this->tenantId)->first();
            if ($intent->status === 'paid') {
                $this->assertSame('active', $hold->status, "الجولة {$round}: مدفوع بحجز محرَّر");
                $this->assertNull($hold->expires_at, "الجولة {$round}: الحجز المدفوع دائم");
            } else {
                $this->assertSame('cancelled', $intent->status, "الجولة {$round}");
                $this->assertSame('released', $hold->status, "الجولة {$round}");
                $row = DB::table('payment_attempts')->where('id', $attempt->id)->first();
                $this->assertContains(PaymentAttempt::REVIEW_LATE_CAPTURE, json_decode((string) $row->review_reasons, true) ?: [], "الجولة {$round}: التقاط على نية ملغاة");
            }
        }
    }

    #[Test]
    public function concurrent_resolves_for_one_phone_create_exactly_one_web_partner(): void
    {
        app(TenantContext::class)->set($this->tenantId);
        $channelId = $this->order()->sales_channel_id;
        $orderIds = [];
        foreach (range(1, 6) as $i) {
            $order = CommerceOrder::create(['sales_channel_id' => $channelId, 'number' => 'CORD-PR-'.uniqid().$i, 'status' => CommerceOrder::STATUS_CONFIRMED, 'total' => 5000, 'confirmed_at' => now()]);
            DB::table('commerce_order_snapshots')->insert([
                'id' => (string) Str::uuid(), 'tenant_id' => $this->tenantId, 'commerce_order_id' => $order->id,
                'customer_name' => 'سالم الأحمدي', 'phone' => $i % 2 === 0 ? '0501234567' : '+966 50 123 4567',
                'created_at' => now(), 'updated_at' => now(),
            ]);
            $orderIds[] = $order->id;
        }
        $tenant = $this->tenantId;
        $jobs = array_map(fn (string $orderId) => function () use ($tenant, $orderId) {
            app(TenantContext::class)->set($tenant);

            return ['partner' => DB::transaction(
                fn () => app(\App\Services\Commerce\CustomerPartnerResolver::class)->resolveForOrder(CommerceOrder::query()->findOrFail($orderId))->id
            )];
        }, $orderIds);

        $results = $this->runConcurrently($jobs);

        $this->assertAllOk($results);
        $this->assertCount(1, array_unique(array_column(array_column($results, 'value'), 'partner')), 'كل الطلبات تتقارب على طرف واحد');
        $this->assertSame(1, DB::table('partners')->where('tenant_id', $this->tenantId)->where('code', 'like', 'WEB-%')->count(), 'طرف ويب واحد فقط');
    }

    // ───────────────────────── مساعدات ─────────────────────────

    private function order(): CommerceOrder
    {
        return CommerceOrder::query()->findOrFail($this->orderId);
    }

    /** يبدأ محاولة ويطبّق لقطة التقاط مؤكَّدة ثم يعيد النية إلى `pending` (لتجربة التثبيت المتزامن بذاته دون سبق المستمع). */
    private function startAndCapture(): string
    {
        app(TenantContext::class)->set($this->tenantId);
        $attempt = app(CommerceOnlinePaymentService::class)->start($this->order())['attempt'];
        app(PaymentOrchestrator::class)->applySnapshot($attempt, new PaymentProviderSnapshot((string) $attempt->provider_payment_id, 'captured', 5000, 'SAR', 5000));
        DB::table('commerce_payment_intents')->where('id', $this->intentId)->update(['status' => 'pending', 'paid_at' => null]);

        return $attempt->id;
    }

    /** يعيد النية والطلب إلى «بانتظار الدفع بلا محاولات» لجولة جديدة. */
    private function resetOrderForRound(): void
    {
        DB::table('payment_attempts')->where('tenant_id', $this->tenantId)->delete();
        DB::table('commerce_payment_intents')->where('id', $this->intentId)->update(['status' => 'pending', 'paid_at' => null, 'cancelled_at' => null]);
    }

    private function starter(): callable
    {
        $tenant = $this->tenantId;
        $orderId = $this->orderId;

        return function () use ($tenant, $orderId) {
            app(TenantContext::class)->set($tenant);
            config(['payments.commerce_online_checkout.enabled' => true]);
            app()->singleton(FakePaymentGatewayAdapter::class);
            try {
                $result = app(CommerceOnlinePaymentService::class)->start(CommerceOrder::query()->findOrFail($orderId));

                return ['id' => $result['attempt']->id, 'status' => $result['attempt']->capture_status];
            } catch (CommerceOnlinePaymentException $e) {
                return ['reason' => $e->reason];
            }
        };
    }

    private function completer(string $attemptId): callable
    {
        $tenant = $this->tenantId;

        return function () use ($tenant, $attemptId) {
            app(TenantContext::class)->set($tenant);

            return ['paid' => app(CommerceOnlinePaymentService::class)->completeCaptured(PaymentAttempt::query()->findOrFail($attemptId))];
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
