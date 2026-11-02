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
use App\Services\Commerce\CommerceOrderFulfillmentException;
use App\Services\Commerce\CommerceOrderFulfillmentLockedException;
use App\Services\Commerce\CommerceOrderFulfillmentService;
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
 *  COPS-H2-1 (خطة H2-0 §5) — تزامن تنفيذ طلب المتجر على PostgreSQL حقيقي
 * ═══════════════════════════════════════════════════════════════
 *  انتقال ↔ انتقال · بدء ↔ إلغاء · إرسال ↔ إلغاء الطلب · إرسال ↔ إلغاء النية القديم (الإلغاء-أولاً) · بدء ↔ تحصيل COD · بدء ↔ التقاط إلكتروني · تسليم ↔ فشل.
 *  الثوابت في كل جولة: لا `40P01`، لا «ملغى ∧ في النقل»، لا «في النقل ∧ نية ملغاة»، لا «تنفيذ ∧ دفع غير جاهز»، تسلسل التغذية بلا فجوة، لا قيد/مخزون.
 *
 *  على PostgreSQL **لا يُتخطّى** إن غاب `pcntl`: يفشل. يُتخطّى على SQLite فقط. بلا معاملة مُغلِّفة (الأطفال يحتاجون صفوفاً مثبَّتة).
 */
class CommerceOrderFulfillmentPostgresTest extends TestCase
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
            'commerce.order_fulfillment_enabled' => true,
            'commerce.order_cancellation_enabled' => true,
            'commerce.order_acceptance_enabled' => true,
        ]);

        $this->dir = sys_get_temp_dir().'/commerce_accept_'.uniqid();
        mkdir($this->dir);

        $tenant = Tenant::create(['name' => 'تنفيذ متزامن', 'slug' => 'cops-h21-pg-'.Str::random(8), 'vat_number' => '300000000000013', 'currency' => 'SAR']);
        $this->tenants[] = $this->tenantId = $tenant->id;
        app(TenantContext::class)->set($this->tenantId);
        $admin = PlatformAdministrator::create(['name' => 'مشغّل', 'email' => Str::random(8).'@platform.test', 'password' => 'platform-password-123']);
        SchedulerHeartbeat::record();
        $this->enableTenantPaymentsOrDiagnose($admin, $this->tenantId, 'تفعيل اختبار التنفيذ المتزامن');

        $channel = SalesChannel::create(['slug' => 'web', 'name' => 'Web', 'type' => SalesChannel::TYPE_WEB, 'is_active' => true]);
        $warehouse = Warehouse::create(['name' => 'مخزن التنفيذ', 'code' => 'FPG-'.Str::random(4), 'is_default' => true]);
        app(\App\Services\Commerce\FulfillmentPolicyService::class)->setFixedWarehouse($channel->id, $warehouse->id);
        $method = PaymentMethod::create(['name' => 'بطاقة', 'name_en' => 'Card', 'settlement_type' => 'bank', 'available_online' => true]);
        $gateway = PaymentGateway::query()->create(['provider' => 'fake', 'name' => 'Fake', 'environment' => 'sandbox', 'payment_method_id' => $method->id]);
        DB::table('payment_gateways')->where('id', $gateway->id)->update(['status' => 'active', 'is_active' => true]);

        $order = new CommerceOrder(['sales_channel_id' => $channel->id, 'number' => 'CORD-ACP-'.uniqid(), 'status' => CommerceOrder::STATUS_CONFIRMED, 'total' => 5000, 'confirmed_at' => now()]);
        $order->forceFill(['delivery_method' => 'standard'])->save();
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
    private function fulfil(string $action, array $input = [], ?int $expected = null): array
    {
        app(TenantContext::class)->set($this->tenantId);
        config(['commerce.order_fulfillment_enabled' => true, 'commerce.order_cancellation_enabled' => true, 'commerce.order_acceptance_enabled' => true]);
        $order = CommerceOrder::query()->findOrFail($this->orderId);
        $actor = User::query()->withoutGlobalScopes()->findOrFail($this->actorId);
        $expected ??= (int) (DB::table('commerce_order_fulfillments')->where('commerce_order_id', $this->orderId)->value('version') ?? 0);
        try {
            app(CommerceOrderFulfillmentService::class)->act($order, $actor, $action, $expected, $input);

            return ['op' => $action, 'ok' => true, 'reason' => null];
        } catch (CommerceOrderFulfillmentException $e) {
            return ['op' => $action, 'ok' => false, 'reason' => $e->reason];
        }
    }

    /** @return array{op: string, ok: bool, reason: ?string} */
    private function cancelOrder(): array
    {
        app(TenantContext::class)->set($this->tenantId);
        config(['commerce.order_fulfillment_enabled' => true, 'commerce.order_cancellation_enabled' => true]);
        $order = CommerceOrder::query()->findOrFail($this->orderId);
        $actor = User::query()->withoutGlobalScopes()->findOrFail($this->actorId);
        try {
            app(CommerceOrderLifecycleService::class)->cancel($order, $actor, 'customer_request', null);

            return ['op' => 'cancel', 'ok' => true, 'reason' => null];
        } catch (CommerceOrderCancellationException $e) {
            return ['op' => 'cancel', 'ok' => false, 'reason' => $e->reason];
        }
    }

    /** @return array{op: string, ok: bool, reason: ?string} */
    private function cancelIntent(): array
    {
        app(TenantContext::class)->set($this->tenantId);
        $intent = CommercePaymentIntent::query()->findOrFail($this->intentId);
        try {
            app(CommercePaymentIntentService::class)->cancel($intent);

            return ['op' => 'cancel_intent', 'ok' => true, 'reason' => null];
        } catch (CommerceOrderFulfillmentLockedException $e) {
            return ['op' => 'cancel_intent', 'ok' => false, 'reason' => $e->reason];
        }
    }

    /** @return array{op: string, ok: bool, reason: ?string} */
    private function collect(): array
    {
        app(TenantContext::class)->set($this->tenantId);
        $actor = User::query()->withoutGlobalScopes()->findOrFail($this->actorId);
        app(CommercePaymentIntentService::class)->markCollected(CommercePaymentIntent::query()->findOrFail($this->intentId), null, $actor);

        return ['op' => 'collect', 'ok' => true, 'reason' => null];
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

    /** يدفع الطلب (متسلسلاً) إلى حالة تنفيذ معطاة قبل الجولة. */
    private function driveTo(string $state): void
    {
        $steps = [
            'none' => [], 'preparing' => [['start']], 'ready' => [['start'], ['mark_ready']],
            'out_for_delivery' => [['start'], ['mark_ready'], ['dispatch', ['carrier_name' => 'ن']]],
        ][$state];
        foreach ($steps as $step) {
            $this->assertTrue($this->fulfil($step[0], $step[1] ?? [])['ok'], "تهيئة {$state}");
        }
    }

    #[Test]
    public function a_double_click_creates_one_row_one_event_and_both_requests_succeed(): void
    {
        foreach (range(1, 6) as $round) {
            $this->resetRound();
            $results = $this->values($this->runConcurrently([fn () => $this->fulfil('mark_ready', [], 0), fn () => $this->fulfil('mark_ready', [], 0)]));

            $this->assertTrue($results[0]['ok'] && $results[1]['ok'], "الجولة {$round}: الثاني idempotent (الهدف متحقق)");
            $this->assertSame(1, DB::table('commerce_order_fulfillments')->where('commerce_order_id', $this->orderId)->count());
            $this->assertSame('ready', $this->fulfillmentRow()->status);
            $this->assertSame(1, (int) $this->fulfillmentRow()->version);
            $this->assertSame(['fulfillment.ready'], $this->eventTypes());
            $this->assertFeedContiguous();
        }
    }

    #[Test]
    public function two_different_first_actions_have_exactly_one_winner(): void
    {
        foreach (range(1, 6) as $round) {
            $this->resetRound();
            $jobs = [fn () => $this->fulfil('start', [], 0), fn () => $this->fulfil('mark_ready', [], 0)];
            $results = $this->values($round % 2 === 0 ? $this->runConcurrently(array_reverse($jobs)) : $this->runConcurrently($jobs));

            $this->assertCount(1, array_filter($results, fn ($r) => $r['ok']), "الجولة {$round}: فائز واحد");
            $loser = collect($results)->firstWhere('ok', false);
            $this->assertSame('fulfillment_version_conflict', $loser['reason']);
            $this->assertSame(1, (int) $this->fulfillmentRow()->version);
            $this->assertCount(1, $this->eventTypes());
            $this->assertFeedContiguous();
        }
    }

    #[Test]
    public function starting_vs_cancelling_the_order_never_leaves_a_cancelled_order_in_transit(): void
    {
        foreach (range(1, 6) as $round) {
            $this->resetRound();
            $jobs = [fn () => $this->fulfil('start', [], 0), fn () => $this->cancelOrder()];
            $results = $this->values($round % 2 === 0 ? $this->runConcurrently(array_reverse($jobs)) : $this->runConcurrently($jobs));
            $byOp = collect($results)->keyBy('op');

            $this->assertTrue($byOp['cancel']['ok'], "الجولة {$round}: الإلغاء ينجح دائماً (قبل البدء أو أثناء التحضير)");
            $this->assertNotNull($this->orderRow()->cancelled_at);
            $row = $this->fulfillmentRow();
            if ($byOp['start']['ok']) {
                $this->assertSame('preparing', $row->status, "الجولة {$round}: البدء سبق الإلغاء");
                $this->assertSame(['fulfillment.started', 'order.cancelled'], $this->eventTypes());
            } else {
                $this->assertSame('already_cancelled', $byOp['start']['reason']);
                $this->assertNull($row, "الجولة {$round}: لا تنفيذ بعد الإلغاء");
                $this->assertSame(['order.cancelled'], $this->eventTypes());
            }
            $this->assertFeedContiguous();
        }
    }

    #[Test]
    public function dispatching_vs_cancelling_the_order_has_exactly_one_winner(): void
    {
        foreach (range(1, 8) as $round) {
            $this->resetRound();
            $this->driveTo('ready');
            $jobs = [fn () => $this->fulfil('dispatch', ['carrier_name' => 'ناقل']), fn () => $this->cancelOrder()];
            $results = $this->values($round % 2 === 0 ? $this->runConcurrently(array_reverse($jobs)) : $this->runConcurrently($jobs));
            $byOp = collect($results)->keyBy('op');

            $dispatched = $this->fulfillmentRow()->status === 'out_for_delivery';
            $cancelled = $this->orderRow()->cancelled_at !== null;
            $this->assertNotSame($dispatched, $cancelled, "الجولة {$round}: فائز واحد — لا «ملغى ∧ في النقل» ولا «لا هذا ولا ذاك»");
            if ($dispatched) {
                $this->assertSame('fulfillment_in_transit', $byOp['cancel']['reason']);
            } else {
                $this->assertSame('already_cancelled', $byOp['dispatch']['reason']);
            }
            $this->assertFeedContiguous();
        }
    }

    #[Test]
    public function dispatching_vs_cancelling_the_intent_through_the_legacy_path_never_leaves_an_in_transit_order_with_a_cancelled_intent(): void
    {
        foreach (range(1, 8) as $round) {
            $this->resetRound();
            $this->driveTo('ready');
            $jobs = [fn () => $this->fulfil('dispatch', ['carrier_name' => 'ناقل']), fn () => $this->cancelIntent()];
            $results = $this->values($round % 2 === 0 ? $this->runConcurrently(array_reverse($jobs)) : $this->runConcurrently($jobs));
            $byOp = collect($results)->keyBy('op');

            $inTransit = $this->fulfillmentRow()->status === 'out_for_delivery';
            $intentCancelled = $this->intentRow()->status === 'cancelled';
            $this->assertNotSame($inTransit, $intentCancelled, "الجولة {$round}: فائز واحد — لا «في النقل ∧ نية ملغاة»");
            if ($inTransit) {
                $this->assertSame('fulfillment_in_transit', $byOp['cancel_intent']['reason'], "الجولة {$round}: الإرسال أولاً ⇒ رفض الإلغاء");
            } else {
                $this->assertSame('payment_cancelled', $byOp['dispatch']['reason'], "الجولة {$round}: الإلغاء أولاً ⇒ رفض الإرسال");
                $this->assertSame('ready', $this->fulfillmentRow()->status);
            }
            $this->assertFeedContiguous();
        }
    }

    #[Test]
    public function starting_vs_cod_collection_both_succeed_without_deadlock(): void
    {
        foreach (range(1, 6) as $round) {
            $this->resetRound();
            $jobs = [fn () => $this->fulfil('start', [], 0), fn () => $this->collect()];
            $results = $this->values($round % 2 === 0 ? $this->runConcurrently(array_reverse($jobs)) : $this->runConcurrently($jobs));

            $this->assertTrue(collect($results)->every(fn ($r) => $r['ok']), "الجولة {$round}");
            $this->assertSame('preparing', $this->fulfillmentRow()->status);
            $this->assertSame('collected', $this->intentRow()->status);
            $this->assertEqualsCanonicalizing(['fulfillment.started', 'payment.collected'], $this->eventTypes());
            $this->assertFeedContiguous();
        }
    }

    #[Test]
    public function starting_vs_online_capture_never_starts_an_unpaid_order(): void
    {
        foreach (range(1, 5) as $round) {
            $this->resetRound(online: true);
            $attemptId = $this->liveAttempt();
            $jobs = [fn () => $this->fulfil('start', [], 0), $this->capturer($attemptId)];
            $results = $this->values($round % 2 === 0 ? $this->runConcurrently(array_reverse($jobs)) : $this->runConcurrently($jobs));
            $start = collect($results)->firstWhere('op', 'start');

            $this->assertSame('paid', $this->intentRow()->status, "الجولة {$round}: الالتقاط يكتمل دائماً");
            if ($start['ok']) {
                $this->assertSame('preparing', $this->fulfillmentRow()->status);
                $this->assertSame(['payment.paid', 'fulfillment.started'], $this->eventTypes(), "الجولة {$round}: البدء بعد تأكيد الدفع فقط");
            } else {
                $this->assertSame('payment_pending', $start['reason']);
                $this->assertNull($this->fulfillmentRow());
            }
            $this->assertFeedContiguous();
        }
    }

    #[Test]
    public function delivering_vs_failing_has_exactly_one_winner(): void
    {
        foreach (range(1, 8) as $round) {
            $this->resetRound();
            $this->driveTo('out_for_delivery');
            $jobs = [fn () => $this->fulfil('deliver'), fn () => $this->fulfil('fail', ['reason' => 'address_issue'])];
            $results = $this->values($round % 2 === 0 ? $this->runConcurrently(array_reverse($jobs)) : $this->runConcurrently($jobs));

            $this->assertCount(1, array_filter($results, fn ($r) => $r['ok']), "الجولة {$round}: فائز واحد");
            $row = $this->fulfillmentRow();
            $this->assertContains($row->status, ['delivered', 'delivery_failed']);
            $this->assertSame($row->status === 'delivery_failed' ? 1 : 0, (int) $row->delivery_attempts);
            $this->assertFeedContiguous();
        }
    }

    #[Test]
    public function parallel_first_actions_across_many_orders_keep_the_feed_gap_free(): void
    {
        $this->resetRound();
        $orderIds = [$this->orderId];
        for ($i = 0; $i < 3; $i++) {
            $o = new CommerceOrder(['sales_channel_id' => CommerceOrder::query()->findOrFail($this->orderId)->sales_channel_id, 'number' => 'CORD-FPG-'.uniqid(), 'status' => CommerceOrder::STATUS_CONFIRMED, 'total' => 5000, 'confirmed_at' => now(), 'delivery_method' => 'standard']);
            $o->save();
            CommercePaymentIntent::create(['commerce_order_id' => $o->id, 'method' => CommercePaymentIntent::METHOD_COD, 'status' => CommercePaymentIntent::STATUS_AWAITING_COLLECTION, 'amount_minor' => 5000, 'currency' => 'SAR']);
            $orderIds[] = $o->id;
        }
        $jobs = array_map(fn (string $id) => function () use ($id) {
            app(TenantContext::class)->set($this->tenantId);
            app(CommerceOrderFulfillmentService::class)->act(CommerceOrder::query()->findOrFail($id), User::query()->withoutGlobalScopes()->findOrFail($this->actorId), 'start', 0);

            return ['op' => 'start', 'ok' => true, 'reason' => null];
        }, $orderIds);
        $this->values($this->runConcurrently($jobs));

        $this->assertSame(4, DB::table('commerce_order_events')->where('tenant_id', $this->tenantId)->where('type', 'fulfillment.started')->count());
        $this->assertFeedContiguous();
        $this->assertSame(0, DB::table('journal_entries')->where('tenant_id', $this->tenantId)->count());
        $this->assertSame(0, DB::table('stock_movements')->where('tenant_id', $this->tenantId)->count());
    }

    // ───────────────────────── مساعدات ─────────────────────────

    private function fulfillmentRow(): ?object
    {
        return DB::table('commerce_order_fulfillments')->where('commerce_order_id', $this->orderId)->first();
    }

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
        DB::statement('ALTER TABLE commerce_order_fulfillments DISABLE TRIGGER USER');
        DB::table('commerce_order_fulfillments')->where('tenant_id', $this->tenantId)->delete();
        DB::statement('ALTER TABLE commerce_order_fulfillments ENABLE TRIGGER USER');
        DB::table('payment_attempts')->where('tenant_id', $this->tenantId)->delete();
        DB::table('inventory_reservations')->where('source_id', $this->orderId)->delete();
        DB::table('commerce_payment_intents')->where('id', $this->intentId)->update([
            'method' => $online ? 'online' : 'cod', 'status' => $online ? 'pending' : 'awaiting_collection',
            'paid_at' => null, 'cancelled_at' => null, 'collected_at' => null,
        ]);
        DB::statement('ALTER TABLE commerce_orders DISABLE TRIGGER USER');
        DB::table('commerce_orders')->where('id', $this->orderId)->update([
            'status' => 'confirmed', 'cancelled_at' => null, 'cancelled_by_user_id' => null, 'cancellation_reason' => null, 'cancellation_note' => null,
            'accepted_at' => null, 'accepted_by_user_id' => null, 'acceptance_mode' => null,
        ]);
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
