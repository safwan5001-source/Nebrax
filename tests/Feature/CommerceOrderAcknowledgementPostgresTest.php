<?php

namespace Tests\Feature;

use App\Models\CommerceOrder;
use App\Models\CommercePaymentIntent;
use App\Models\InventoryReservation;
use App\Models\PaymentAttempt;
use App\Models\PaymentGateway;
use App\Models\PaymentMethod;
use App\Models\PlatformAdministrator;
use App\Models\Product;
use App\Models\SalesChannel;
use App\Models\Tenant;
use App\Models\User;
use App\Models\Warehouse;
use App\Services\Commerce\CommerceOnlinePaymentService;
use App\Services\Commerce\CommerceOrderAcceptanceException;
use App\Services\Commerce\CommerceOrderAcknowledgementException;
use App\Services\Commerce\CommerceOrderAcknowledgementService;
use App\Services\Commerce\CommerceOrderCancellationException;
use App\Services\Commerce\CommerceOrderLifecycleService;
use App\Services\Commerce\CommercePaymentIntentService;
use App\Services\Commerce\CommerceUnpaidOrderSweeper;
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
 *  COPS-H3-4 (ADR-30 §4، R-10) — تزامن إقرار تنبيه الطلب على PostgreSQL حقيقي
 * ═══════════════════════════════════════════════════════════════
 *  إقراران متزامنان (idempotent: صف وحدث واحد) · إقرار ↔ إلغاء · إقرار ↔ التقاط إلكتروني · إقرار ↔ قبول يدوي · إقرار ↔ تحصيل COD.
 *  الثوابت في كل جولة: لا `40P01`، لا إقرار لطلب ملغى (أول مرة)، لا إقرار قبل تأكيد الدفع (R-5)، حدث إقرار واحد كحدّ أقصى، تسلسل التغذية بلا فجوة (رأس التغذية آخر قفل).
 *
 *  على PostgreSQL **لا يُتخطّى** إن غاب `pcntl`: يفشل. يُتخطّى على SQLite فقط. بلا معاملة مُغلِّفة (الأطفال يحتاجون صفوفاً مثبَّتة).
 */
class CommerceOrderAcknowledgementPostgresTest extends TestCase
{
    use DiagnosesUnprovenScheduler;
    use UsesWorkerDatabaseWithoutTransaction;

    private string $dir;

    private string $tenantId;

    private string $orderId;

    private string $intentId;

    private string $actorId;

    /** @var list<string> */
    private array $tenants = [];

    protected function setUp(): void
    {
        parent::setUp();

        if (DB::connection()->getDriverName() !== 'pgsql') {
            $this->markTestSkipped('يتطلب PostgreSQL حقيقياً — SQLite لا يُظهر تنافساً على أقفال الصفوف.');
        }
        $this->assertTrue(function_exists('pcntl_fork') && function_exists('posix_kill'),
            'pcntl/posix مطلوبان لاختبارات تزامن PostgreSQL؛ غيابهما فشل لا تخطٍّ.');
        config([
            'payments.commerce_online_checkout.enabled' => true,
            'commerce.order_acceptance_enabled' => true,
            'commerce.order_cancellation_enabled' => true,
        ]);

        $this->dir = sys_get_temp_dir().'/commerce_accept_'.uniqid();
        mkdir($this->dir);

        $tenant = Tenant::create(['name' => 'قبول متزامن', 'slug' => 'cops-h34-pg-'.Str::random(8), 'vat_number' => '300000000000013', 'currency' => 'SAR']);
        $this->tenants[] = $this->tenantId = $tenant->id;
        app(TenantContext::class)->set($this->tenantId);
        $admin = PlatformAdministrator::create(['name' => 'مشغّل', 'email' => Str::random(8).'@platform.test', 'password' => 'platform-password-123']);
        SchedulerHeartbeat::record();
        $this->enableTenantPaymentsOrDiagnose($admin, $this->tenantId, 'تفعيل اختبار الإقرار المتزامن');

        $channel = SalesChannel::create(['slug' => 'web', 'name' => 'Web', 'type' => SalesChannel::TYPE_WEB, 'is_active' => true]);
        $method = PaymentMethod::create(['name' => 'بطاقة', 'name_en' => 'Card', 'settlement_type' => 'bank', 'available_online' => true]);
        $gateway = PaymentGateway::query()->create(['provider' => 'fake', 'name' => 'Fake', 'environment' => 'sandbox', 'payment_method_id' => $method->id]);
        DB::table('payment_gateways')->where('id', $gateway->id)->update(['status' => 'active', 'is_active' => true]);

        $order = new CommerceOrder(['sales_channel_id' => $channel->id, 'number' => 'CORD-ACK-'.uniqid(), 'status' => CommerceOrder::STATUS_CONFIRMED, 'total' => 5000, 'confirmed_at' => now()]);
        $order->forceFill(['acceptance_mode' => CommerceOrder::ACCEPTANCE_MANUAL])->save();
        $this->orderId = $order->id;
        $this->intentId = CommercePaymentIntent::create([
            'commerce_order_id' => $order->id, 'payment_method_id' => $method->id, 'payment_method_name' => $method->name,
            'method' => CommercePaymentIntent::METHOD_COD, 'status' => CommercePaymentIntent::STATUS_AWAITING_COLLECTION,
            'amount_minor' => 5000, 'currency' => 'SAR',
        ])->id;
        $this->actorId = User::create(['tenant_id' => $this->tenantId, 'name' => 'مشرف', 'email' => 'sup-'.Str::random(6).'@pg.test', 'password' => 'password123', 'role' => 'admin'])->id;
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

    // ───────────────────────── العمليات داخل الأطفال (الخدمات الحقيقية) ─────────────────────────

    /** @return array{op: string, ok: bool, reason: ?string} */
    private function lifecycle(string $op, ?string $actorId = null): array
    {
        app(TenantContext::class)->set($this->tenantId);
        config(['commerce.order_acceptance_enabled' => true, 'commerce.order_cancellation_enabled' => true]);
        $service = app(CommerceOrderLifecycleService::class);
        $order = CommerceOrder::query()->findOrFail($this->orderId);
        $actor = User::query()->withoutGlobalScopes()->findOrFail($actorId ?? $this->actorId);
        try {
            match ($op) {
                'accept' => $service->accept($order, $actor),
                'cancel' => $service->cancel($order, $actor, 'customer_request', null),
                'ack' => app(CommerceOrderAcknowledgementService::class)->acknowledge($order, $actor),
            };

            return ['op' => $op, 'ok' => true, 'reason' => null];
        } catch (CommerceOrderAcceptanceException|CommerceOrderCancellationException|CommerceOrderAcknowledgementException $e) {
            return ['op' => $op, 'ok' => false, 'reason' => $e->reason];
        }
    }

    private function capturer(string $attemptId): callable
    {
        $tenant = $this->tenantId;

        return function () use ($tenant, $attemptId) {
            app(TenantContext::class)->set($tenant);
            config(['payments.commerce_online_checkout.enabled' => true]);
            $fresh = PaymentAttempt::query()->findOrFail($attemptId);
            app(PaymentOrchestrator::class)->applySnapshot($fresh, new PaymentProviderSnapshot((string) $fresh->provider_payment_id, 'captured', 5000, 'SAR', 5000));

            return ['op' => 'capture', 'paid' => app(CommerceOnlinePaymentService::class)->completeCaptured(PaymentAttempt::query()->findOrFail($fresh->id))];
        };
    }

    // ───────────────────────── السباقات ─────────────────────────

    private function ackCount(): int
    {
        return DB::table('commerce_order_acknowledgements')->where('commerce_order_id', $this->orderId)->count();
    }

    #[Test]
    public function concurrent_acknowledgements_by_different_users_are_idempotent_with_one_row_and_one_event(): void
    {
        $second = User::create(['tenant_id' => $this->tenantId, 'name' => 'مشرف ٢', 'email' => 'sup2-'.Str::random(6).'@pg.test', 'password' => 'password123', 'role' => 'admin'])->id;
        foreach (range(1, 6) as $round) {
            $this->resetRound();
            $results = $this->values($this->runConcurrently([
                fn () => $this->lifecycle('ack'), fn () => $this->lifecycle('ack', $second), fn () => $this->lifecycle('ack'),
            ]));

            foreach ($results as $i => $r) {
                $this->assertTrue($r['ok'], "الجولة {$round}: الاستدعاء {$i} ينجح (فائز واحد والباقي idempotent)");
            }
            $this->assertSame(1, $this->ackCount(), "الجولة {$round}: صف إقرار واحد");
            $this->assertSame(['order.acknowledged'], $this->eventTypes(), "الجولة {$round}: حدث واحد");
            $this->assertFeedContiguous();
        }
    }

    #[Test]
    public function acknowledgement_vs_cancellation_never_acknowledges_a_cancelled_order_for_the_first_time(): void
    {
        foreach (range(1, 8) as $round) {
            $this->resetRound();
            $jobs = [fn () => $this->lifecycle('ack'), fn () => $this->lifecycle('cancel')];
            $results = $this->values($round % 2 === 0 ? $this->runConcurrently(array_reverse($jobs)) : $this->runConcurrently($jobs));
            $byOp = collect($results)->keyBy('op');

            $this->assertTrue($byOp['cancel']['ok'], "الجولة {$round}: الإلغاء ينجح دائماً (الإقرار لا يمنعه)");
            $this->assertNotNull($this->orderRow()->cancelled_at);
            if ($byOp['ack']['ok']) {
                $this->assertSame(1, $this->ackCount());
                $this->assertSame(['order.acknowledged', 'order.cancelled'], $this->eventTypes(), "الجولة {$round}: الإقرار سبق الإلغاء");
            } else {
                $this->assertSame('already_cancelled', $byOp['ack']['reason']);
                $this->assertSame(0, $this->ackCount(), "الجولة {$round}: لا إقرار بعد الإلغاء");
                $this->assertSame(['order.cancelled'], $this->eventTypes());
            }
            $this->assertFeedContiguous();
        }
    }

    #[Test]
    public function acknowledgement_vs_online_capture_never_acknowledges_before_the_payment_is_confirmed(): void
    {
        foreach (range(1, 5) as $round) {
            $this->resetRound(online: true);
            $attemptId = $this->liveAttempt();
            $jobs = [fn () => $this->lifecycle('ack'), $this->capturer($attemptId)];
            $results = $this->values($round % 2 === 0 ? $this->runConcurrently(array_reverse($jobs)) : $this->runConcurrently($jobs));
            $ack = collect($results)->firstWhere('op', 'ack');

            $this->assertSame('paid', $this->intentRow()->status, "الجولة {$round}: الالتقاط يكتمل دائماً");
            if ($ack['ok']) {
                $this->assertSame(1, $this->ackCount());
                $this->assertSame(['payment.paid', 'order.acknowledged'], $this->eventTypes(), "الجولة {$round}: الإقرار بعد التأكيد فقط");
            } else {
                $this->assertSame('not_alertable', $ack['reason']);
                $this->assertSame(0, $this->ackCount());
            }
            $this->assertSame(0, DB::table('journal_entries')->where('tenant_id', $this->tenantId)->count());
            $this->assertFeedContiguous();
        }
    }

    #[Test]
    public function acknowledgement_vs_manual_acceptance_and_cod_collection_all_succeed_without_deadlock(): void
    {
        foreach (range(1, 5) as $round) {
            $this->resetRound();
            $tenant = $this->tenantId;
            $intentId = $this->intentId;
            $collector = function () use ($tenant, $intentId) {
                app(TenantContext::class)->set($tenant);
                app(CommercePaymentIntentService::class)->markCollected(CommercePaymentIntent::findOrFail($intentId));

                return ['op' => 'collect', 'ok' => true];
            };
            $jobs = [fn () => $this->lifecycle('ack'), fn () => $this->lifecycle('accept'), $collector];
            $results = $this->values($round % 2 === 0 ? $this->runConcurrently(array_reverse($jobs)) : $this->runConcurrently($jobs));

            $this->assertTrue(collect($results)->every(fn ($r) => $r['ok']), "الجولة {$round}");
            $this->assertSame(1, $this->ackCount());
            $this->assertNotNull($this->orderRow()->accepted_at);
            $this->assertEqualsCanonicalizing(['order.acknowledged', 'order.accepted', 'payment.collected'], $this->eventTypes());
            $this->assertFeedContiguous();
        }
    }

    // ───────────────────────── مساعدات ─────────────────────────

    private function orderRow(): object
    {
        return DB::table('commerce_orders')->where('id', $this->orderId)->first();
    }

    private function intentRow(): object
    {
        return DB::table('commerce_payment_intents')->where('id', $this->intentId)->first();
    }

    /** @return list<string> */
    private function eventTypes(): array
    {
        return DB::table('commerce_order_events')->where('commerce_order_id', $this->orderId)->orderBy('feed_seq')->pluck('type')->all();
    }

    private function assertFeedContiguous(): void
    {
        $seqs = DB::table('commerce_order_events')->where('tenant_id', $this->tenantId)->orderBy('feed_seq')->pluck('feed_seq')->map(fn ($s) => (int) $s)->all();
        $this->assertSame($seqs === [] ? [] : range(1, count($seqs)), $seqs, 'تسلسل التغذية متصل بلا فجوة ولا تكرار');
    }

    private function liveAttempt(): string
    {
        $this->seedHold();
        app()->singleton(FakePaymentGatewayAdapter::class);
        app(TenantContext::class)->set($this->tenantId);

        return app(CommerceOnlinePaymentService::class)->start(CommerceOrder::query()->findOrFail($this->orderId))['attempt']->id;
    }

    private function seedHold(): void
    {
        app(TenantContext::class)->set($this->tenantId);
        $warehouse = Warehouse::query()->first() ?? Warehouse::create(['name' => 'مخزن', 'code' => 'W-'.Str::random(4), 'is_default' => true]);
        $product = Product::query()->first() ?? Product::create(['name' => 'منتج', 'sku' => 'P-'.Str::random(6), 'unit' => 'piece', 'sale_price' => 5000, 'is_active' => true, 'track_inventory' => true]);
        DB::table('inventory_reservations')->where('source_id', $this->orderId)->delete();
        InventoryReservation::create([
            'warehouse_id' => $warehouse->id, 'product_id' => $product->id, 'base_quantity' => 1, 'status' => InventoryReservation::STATUS_ACTIVE,
            'source_type' => CommerceOrder::class, 'source_id' => $this->orderId, 'idempotency_key' => 'hold-'.Str::random(10), 'request_checksum' => Str::random(16),
            'expires_at' => now('UTC')->addHour(),
        ]);
    }

    /** يعيد الطلب إلى «يدوي مؤكَّد غير مقبول وغير ملغى» بنية COD أو إلكترونية معلَّقة، ويمسح أحداث المستأجر (مُشغِّلات معطَّلة مؤقتاً — إعداد اختبار فقط). */
    private function resetRound(bool $online = false): void
    {
        DB::table('payment_attempts')->where('tenant_id', $this->tenantId)->delete();
        DB::table('inventory_reservations')->where('source_id', $this->orderId)->delete();
        DB::table('commerce_payment_intents')->where('id', $this->intentId)->update([
            'method' => $online ? 'online' : 'cod', 'status' => $online ? 'pending' : 'awaiting_collection',
            'paid_at' => null, 'cancelled_at' => null, 'collected_at' => null,
        ]);
        DB::statement('ALTER TABLE commerce_orders DISABLE TRIGGER USER');
        DB::table('commerce_orders')->where('id', $this->orderId)->update([
            'status' => 'confirmed', 'cancelled_at' => null, 'cancelled_by_user_id' => null, 'cancellation_reason' => null, 'cancellation_note' => null,
            'accepted_at' => null, 'accepted_by_user_id' => null,
        ]);
        DB::table('commerce_order_acknowledgements')->where('commerce_order_id', $this->orderId)->delete();
        DB::statement('ALTER TABLE commerce_orders ENABLE TRIGGER USER');
        DB::statement('ALTER TABLE commerce_order_events DISABLE TRIGGER USER');
        DB::table('commerce_order_events')->where('tenant_id', $this->tenantId)->delete();
        DB::statement('ALTER TABLE commerce_order_events ENABLE TRIGGER USER');
    }

    /** يفشل عند أي خطأ في عملية (يشمل الجمود) ويعيد قيمها. @return list<array<string, mixed>> */
    private function values(array $results): array
    {
        foreach ($results as $i => $result) {
            $message = (string) ($result['message'] ?? '');
            $this->assertFalse(str_contains($message, '40P01') || stripos($message, 'deadlock') !== false, "جمود في العملية {$i}: {$message}");
            $this->assertTrue($result['ok'] ?? false, "العملية {$i}: ".($result['error_class'] ?? '').' '.$message);
        }

        return array_map(fn ($r) => $r['value'], $results);
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
