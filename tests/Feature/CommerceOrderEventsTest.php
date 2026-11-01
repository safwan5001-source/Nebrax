<?php

namespace Tests\Feature;

use App\Models\CommerceOrder;
use App\Models\CommerceOrderEvent;
use App\Models\CommercePaymentIntent;
use App\Models\Tenant;
use App\Models\User;
use App\Services\Commerce\CommerceOnlinePaymentService;
use App\Services\Commerce\CommerceOrderEventRecorder;
use App\Services\TenantApplicationService;
use App\Support\ApplicationCatalog;
use App\Tenancy\TenantContext;
use Illuminate\Database\Events\QueryExecuted;
use Illuminate\Database\Events\TransactionCommitted;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Str;
use PHPUnit\Framework\Attributes\Test;
use Tests\TestCase;

/**
 * COPS-H1-1 (ADR-29 §2.4) — سجل أحداث طلب المتجر وتسلسل التغذية، على SQLite وPostgreSQL.
 *
 * الأحداث تأتي من المسارات الحقيقية: إتمام Checkout (`order.placed`)، الالتقاط الإلكتروني (`payment.paid`)، تحصيل الاستلام/COD
 * (`payment.collected`)، إلغاء الموظف (`order.cancelled`). يُثبت: حدث واحد لكل انتقال فعلي وصفر للإعادات، تسلسل 1..N لكل مستأجر بلا فجوات،
 * تراجع المعاملة يُرجع الحدث والعدّاد معاً، حراس القاعدة (لا تعديل/حذف/قفز/نوع غير معتمد)، أن رأس التغذية **آخر** كتابة/قفل في كل مسار،
 * أن الكاتب لا يلمس `tenants`، الخط الزمني للموظف (إضافي، RBAC، عزل، بلا N+1)، وأن لا قيد ولا حركة مخزون تنشأ عن الأحداث.
 * التزامن والاكتمال والجمود والأداء على PostgreSQL الحقيقي: `CommerceOrderEventsPostgresTest`.
 */
class CommerceOrderEventsTest extends TestCase
{
    use InteractsWithApi;
    use OnlineStorefrontHarness;
    use RefreshDatabase;

    private string $ownerToken;

    protected function setUp(): void
    {
        parent::setUp();
        $this->bootOnlineStore();
        $this->enableApplications($this->tenant);
        $this->ownerToken = $this->tokenFor($this->tenant, 'owner');
        config(['commerce.order_cancellation_enabled' => true]);
    }

    // ───────────────────────── أدوات ─────────────────────────

    private function enableApplications(Tenant $tenant): void
    {
        app(TenantContext::class)->set($tenant->id);
        foreach (ApplicationCatalog::all() as $key => $application) {
            if (! $application['mandatory'] && $application['maturity'] === ApplicationCatalog::MATURITY_BUILT) {
                app(TenantApplicationService::class)->enable($key, null);
            }
        }
        app(TenantContext::class)->forget();
    }

    private function tokenFor(Tenant $tenant, string $role): string
    {
        app(TenantContext::class)->set($tenant->id);
        $user = User::create(['tenant_id' => $tenant->id, 'name' => 'مستخدم '.$role, 'email' => $role.'-'.Str::random(6).'@events.test', 'password' => 'password123', 'role' => $role]);
        $token = $user->createToken('api')->plainTextToken;
        app(TenantContext::class)->forget();

        return $token;
    }

    /** طلب استلام (pay_on_pickup) بانتظار التحصيل عبر Checkout حقيقي. */
    private function pickupOrder(string $key): string
    {
        $token = $this->readyCheckout($this->product($this->tenant, $this->channel), null);

        return (string) $this->complete($token, $key)->assertCreated()->json('data.order.id');
    }

    /** @return list<array{seq: int, type: string, actor_type: string, actor_id: ?string, data: ?array}> */
    private function events(?string $orderId = null, ?string $tenantId = null): array
    {
        return CommerceOrderEvent::query()->withoutGlobalScopes()
            ->where('tenant_id', $tenantId ?? $this->tenant->id)
            ->when($orderId !== null, fn ($q) => $q->where('commerce_order_id', $orderId))
            ->orderBy('feed_seq')->get()
            ->map(fn (CommerceOrderEvent $e) => ['seq' => $e->feed_seq, 'type' => $e->type, 'actor_type' => $e->actor_type, 'actor_id' => $e->actor_id, 'data' => $e->data])
            ->all();
    }

    /** آخر رقم تسلسل ملتزم للمستأجر (الرأس صف قفل ثابت؛ التسلسل من الفهرس الفريد). */
    private function feedHead(?string $tenantId = null): int
    {
        return (int) DB::table('commerce_order_events')->where('tenant_id', $tenantId ?? $this->tenant->id)->max('feed_seq');
    }

    private function collect(string $orderId): void
    {
        $intent = $this->intent($orderId);
        $this->withToken($this->ownerToken)->postJson("/api/commerce/payment-intents/{$intent->id}/collect", ['note' => 'سالم 0501234567'])->assertOk();
    }

    /** يلتقط دفع طلب إلكتروني فعلياً لدى المزوّد الوهمي ويثبّته عبر قراءة الحالة من الخادم. */
    private function pay(array $order): void
    {
        $this->startPayment($order)->assertSuccessful();
        $attempt = $this->attempts($order['order_id'])->first();
        $this->capture($attempt);
        $this->elapse($attempt);
        $this->paymentStatus($order)->assertOk()->assertJsonPath('data.payment.status', 'paid');
    }

    /**
     * يلتقط كل العبارات وعلامات الالتزام أثناء $action، ثم يثبت أن صف رأس التغذية آخر ما يُكتب/يُقفل في معاملته: بين أول عبارة تمسّ
     * `commerce_order_feed_heads` وأول التزام بعدها لا تقع إلا كتابات الأحداث/الرأس أو قراءات SELECT بلا قفل.
     */
    private function assertFeedHeadIsTheLastLock(callable $action, string $label): void
    {
        $log = [];
        Event::listen(QueryExecuted::class, function (QueryExecuted $q) use (&$log): void {
            $log[] = ['sql' => strtolower($q->sql)];
        });
        Event::listen(TransactionCommitted::class, function () use (&$log): void {
            $log[] = ['commit' => true];
        });
        $action();

        $start = null;
        foreach ($log as $i => $entry) {
            if (isset($entry['sql']) && str_contains($entry['sql'], 'commerce_order_feed_heads')) {
                $start = $i;
                break;
            }
        }
        $this->assertNotNull($start, "{$label}: لم يُقفل رأس التغذية");
        $committed = false;
        for ($i = $start; $i < count($log); $i++) {
            if (isset($log[$i]['commit'])) {
                $committed = true;
                break;
            }
            $sql = $log[$i]['sql'];
            $isFeed = str_contains($sql, 'commerce_order_feed_heads') || str_contains($sql, 'commerce_order_events');
            $isPlainRead = str_starts_with(ltrim($sql), 'select') && ! preg_match('/for (update|share|key share|no key update)/', $sql);
            $this->assertTrue($isFeed || $isPlainRead, "{$label}: عبارة بعد قفل رأس التغذية داخل المعاملة نفسها: {$sql}");
            $this->assertStringNotContainsString('"tenants"', $sql, "{$label}: الكاتب لمس tenants بعد الرأس");
        }
        $this->assertTrue($committed, "{$label}: لا التزام بعد قفل الرأس");
    }

    // ───────────────────────── الأحداث من المسارات الحقيقية ─────────────────────────

    #[Test]
    public function a_guest_checkout_records_exactly_one_order_placed_event_and_a_replay_records_none(): void
    {
        $token = $this->readyCheckout($this->product($this->tenant, $this->channel), null);
        $orderId = (string) $this->complete($token, 'idem-ev-1')->assertCreated()->json('data.order.id');

        $this->assertSame([[
            'seq' => 1, 'type' => 'order.placed', 'actor_type' => 'guest', 'actor_id' => null,
            'data' => ['delivery_method' => 'pickup', 'payment_method' => CommercePaymentIntent::METHOD_PAY_ON_PICKUP],
        ]], $this->events($orderId));
        $this->assertSame(1, $this->feedHead());

        // إعادة الإتمام بالمفتاح نفسه (إعادة تشغيل) لا تكتب حدثاً ثانياً ولا تُقدّم الرأس.
        $this->complete($token, 'idem-ev-1')->assertSuccessful();
        $this->assertCount(1, $this->events());
        $this->assertSame(1, $this->feedHead());
    }

    #[Test]
    public function an_online_order_records_placed_then_paid_once_and_repeated_confirmation_adds_nothing(): void
    {
        $order = $this->onlineOrder(product: $this->product($this->tenant, $this->channel), key: 'idem-ev-online');
        $this->assertSame(['order.placed'], array_column($this->events($order['order_id']), 'type'));
        $this->assertSame('online', $this->events($order['order_id'])[0]['data']['payment_method']);

        $this->pay($order);
        $events = $this->events($order['order_id']);
        $this->assertSame(['order.placed', 'payment.paid'], array_column($events, 'type'));
        $this->assertSame(['system', null, null], [$events[1]['actor_type'], $events[1]['actor_id'], $events[1]['data']]);

        // تكرار القراءة/الإكمال/المطابقة الدورية: النية مدفوعة أصلاً ⇒ لا حدث ثانٍ.
        $this->paymentStatus($order)->assertOk();
        app(TenantContext::class)->set($this->tenant->id);
        app(CommerceOnlinePaymentService::class)->completeCaptured($this->attempts($order['order_id'])->first());
        app(TenantContext::class)->forget();
        $this->artisan('payments:complete-commerce-captures')->assertSuccessful();
        $this->assertCount(2, $this->events($order['order_id']));
        $this->assertSame(2, $this->feedHead());
    }

    #[Test]
    public function collecting_a_pickup_payment_records_one_event_by_the_staff_actor_without_the_free_text_note(): void
    {
        $orderId = $this->pickupOrder('idem-ev-collect');
        $this->collect($orderId);

        $collected = collect($this->events($orderId))->firstWhere('type', 'payment.collected');
        $owner = User::query()->withoutGlobalScopes()->where('tenant_id', $this->tenant->id)->where('role', 'owner')->firstOrFail();
        $this->assertSame(['user', (string) $owner->id, null], [$collected['actor_type'], $collected['actor_id'], $collected['data']]);
        $this->assertStringNotContainsString('0501234567', (string) json_encode($this->events($orderId)));

        // تحصيل ثانٍ مرفوض (الحالة لم تعد بانتظار التحصيل) ⇒ لا حدث.
        $intent = $this->intent($orderId);
        $this->withToken($this->ownerToken)->postJson("/api/commerce/payment-intents/{$intent->id}/collect", [])->assertStatus(422);
        $this->assertSame(['order.placed', 'payment.collected'], array_column($this->events($orderId), 'type'));
    }

    #[Test]
    public function a_staff_cancellation_records_one_event_with_its_reason_and_an_idempotent_repeat_records_none(): void
    {
        $orderId = $this->pickupOrder('idem-ev-cancel');
        $this->withToken($this->ownerToken)->postJson("/api/commerce/orders/{$orderId}/cancel", ['reason' => 'out_of_stock'])->assertOk();
        $this->withToken($this->ownerToken)->postJson("/api/commerce/orders/{$orderId}/cancel", ['reason' => 'other', 'note' => 'سبب آخر'])->assertOk();

        $events = $this->events($orderId);
        $this->assertSame(['order.placed', 'order.cancelled'], array_column($events, 'type'));
        $this->assertSame(['reason' => 'out_of_stock'], $events[1]['data']);
        $this->assertSame('user', $events[1]['actor_type']);
        $this->assertSame([1, 2], array_column($events, 'seq'));
    }

    #[Test]
    public function a_refused_transition_records_no_event_and_does_not_advance_the_head(): void
    {
        $orderId = $this->pickupOrder('idem-ev-refused');
        $this->collect($orderId);
        $before = $this->feedHead();
        // طلب محصَّل لا يُلغى مباشرة (409) ⇒ لا حدث إلغاء.
        $this->withToken($this->ownerToken)->postJson("/api/commerce/orders/{$orderId}/cancel", ['reason' => 'customer_request'])->assertStatus(409);
        $this->assertSame($before, $this->feedHead());
        $this->assertNotContains('order.cancelled', array_column($this->events($orderId), 'type'));
    }

    #[Test]
    public function the_feed_sequence_is_gap_free_per_tenant_and_independent_across_tenants(): void
    {
        $a1 = $this->pickupOrder('idem-ev-a1');
        $a2 = $this->pickupOrder('idem-ev-a2');
        $this->collect($a1);
        $this->withToken($this->ownerToken)->postJson("/api/commerce/orders/{$a2}/cancel", ['reason' => 'duplicate_order'])->assertOk();

        ['tenant' => $other, 'channel' => $otherChannel] = $this->makeStore('events-other.test', 'events-other');
        $this->wirePayments($other, $otherChannel);
        $otherToken = $this->readyCheckout($this->product($other, $otherChannel), null, 'events-other.test');
        $this->complete($otherToken, 'idem-ev-other', 'events-other.test')->assertCreated();

        $this->assertSame([1, 2, 3, 4], array_column($this->events(), 'seq'));
        $this->assertSame(4, $this->feedHead());
        $this->assertSame([1], array_column($this->events(null, $other->id), 'seq'));
        $this->assertSame(1, $this->feedHead($other->id));
    }

    // ───────────────────────── ترتيب الأقفال (الرأس آخراً، لا مساس بـtenants) ─────────────────────────

    #[Test]
    public function the_feed_head_is_the_last_lock_on_every_transition_path(): void
    {
        $token = $this->readyCheckout($this->product($this->tenant, $this->channel), null);
        $this->assertFeedHeadIsTheLastLock(fn () => $this->complete($token, 'idem-ev-lock-1')->assertCreated(), 'checkout complete');
        $pickup = (string) CommerceOrder::query()->withoutGlobalScopes()->where('tenant_id', $this->tenant->id)->latest('created_at')->value('id');

        $this->assertFeedHeadIsTheLastLock(fn () => $this->collect($pickup), 'mark collected');

        $other = $this->pickupOrder('idem-ev-lock-2');
        $this->assertFeedHeadIsTheLastLock(
            fn () => $this->withToken($this->ownerToken)->postJson("/api/commerce/orders/{$other}/cancel", ['reason' => 'customer_request'])->assertOk(),
            'staff cancel',
        );

        $online = $this->onlineOrder(product: $this->product($this->tenant, $this->channel), key: 'idem-ev-lock-3');
        $this->startPayment($online)->assertSuccessful();
        $attempt = $this->attempts($online['order_id'])->first();
        $this->capture($attempt);
        $this->elapse($attempt);
        $this->assertFeedHeadIsTheLastLock(fn () => $this->paymentStatus($online)->assertOk(), 'capture completion');
    }

    // ───────────────────────── الكاتب نفسه ─────────────────────────

    #[Test]
    public function the_recorder_refuses_unknown_types_actors_foreign_contexts_and_data_outside_the_whitelist(): void
    {
        $orderId = $this->pickupOrder('idem-ev-rec');
        app(TenantContext::class)->set($this->tenant->id);
        $order = CommerceOrder::query()->findOrFail($orderId);
        $recorder = app(CommerceOrderEventRecorder::class);

        // الرفض خارج المعاملة يُثبَت في CommerceOrderEventsPostgresTest (بلا معاملة اختبار مُغلِّفة).
        DB::transaction(function () use ($recorder, $order): void {
            $this->assertThrows(fn () => $recorder->append($order, 'order.shipped', 'system'), \InvalidArgumentException::class);
            $this->assertThrows(fn () => $recorder->append($order, 'order.cancelled', 'robot'), \InvalidArgumentException::class);
            $this->assertThrows(fn () => $recorder->append($order, 'order.cancelled', 'user'), \InvalidArgumentException::class);
            $this->assertThrows(fn () => $recorder->append($order, 'order.cancelled', 'system', (string) Str::uuid()), \InvalidArgumentException::class);
            $this->assertThrows(fn () => $recorder->append($order, 'order.cancelled', 'system', null, ['phone' => '0500000000']), \InvalidArgumentException::class);
            $this->assertThrows(fn () => $recorder->append($order, 'order.cancelled', 'system', null, ['reason' => str_repeat('x', 65)]), \InvalidArgumentException::class);
        });

        // سياق مستأجر مختلف ⇒ رفض (لا كتابة عبر المستأجرين).
        ['tenant' => $other] = $this->makeStore('events-ctx.test', 'events-ctx');
        app(TenantContext::class)->set($other->id);
        DB::transaction(fn () => $this->assertThrows(fn () => $recorder->append($order, 'order.cancelled', 'system'), \LogicException::class));
        app(TenantContext::class)->forget();
        $this->assertSame(['order.placed'], array_column($this->events($orderId), 'type'));
    }

    #[Test]
    public function a_rolled_back_transition_leaves_no_event_and_no_sequence_gap(): void
    {
        $orderId = $this->pickupOrder('idem-ev-rb');
        app(TenantContext::class)->set($this->tenant->id);
        $order = CommerceOrder::query()->findOrFail($orderId);

        try {
            DB::transaction(function () use ($order): void {
                app(CommerceOrderEventRecorder::class)->append($order, 'payment.collected', 'system');
                throw new \RuntimeException('فشل لاحق في الانتقال');
            });
        } catch (\RuntimeException) {
        }
        $this->assertSame(1, $this->feedHead());

        DB::transaction(fn () => app(CommerceOrderEventRecorder::class)->append($order, 'payment.collected', 'system'));
        app(TenantContext::class)->forget();
        $this->assertSame([1, 2], array_column($this->events($orderId), 'seq'));
    }

    // ───────────────────────── حراس القاعدة ─────────────────────────

    #[Test]
    public function the_database_keeps_events_append_only_and_the_head_gap_free(): void
    {
        $orderId = $this->pickupOrder('idem-ev-guard');
        $event = DB::table('commerce_order_events')->where('commerce_order_id', $orderId)->first();
        $tenant = $this->tenant->id;
        $insert = fn (array $overrides) => DB::table('commerce_order_events')->insert([
            'id' => (string) Str::uuid(), 'tenant_id' => $tenant, 'commerce_order_id' => $orderId, 'feed_seq' => 2,
            'type' => 'payment.collected', 'actor_type' => 'system', 'actor_id' => null, 'data' => null,
            'occurred_at' => now('UTC'), 'created_at' => now('UTC'), ...$overrides,
        ]);

        $this->assertDbRejects(fn () => DB::table('commerce_order_events')->where('id', $event->id)->update(['type' => 'order.cancelled']), 'update event');
        $this->assertDbRejects(fn () => DB::table('commerce_order_events')->where('id', $event->id)->delete(), 'delete event');
        $this->assertDbRejects(fn () => DB::table('commerce_order_feed_heads')->where('tenant_id', $tenant)->update(['created_at' => now('UTC')]), 'update head lock row');
        $this->assertDbRejects(fn () => DB::table('commerce_order_feed_heads')->where('tenant_id', $tenant)->delete(), 'delete head');
        $this->assertDbRejects(fn () => $insert(['feed_seq' => 3]), 'sequence gap');
        $this->assertDbRejects(fn () => $insert(['feed_seq' => 1]), 'duplicate sequence');
        $this->assertDbRejects(fn () => $insert(['type' => 'order.shipped']), 'unknown type');
        $this->assertDbRejects(fn () => $insert(['actor_type' => 'user', 'actor_id' => null]), 'user without id');
        $this->assertDbRejects(fn () => $insert(['actor_type' => 'guest', 'actor_id' => (string) Str::uuid()]), 'guest with id');
        if (DB::connection()->getDriverName() === 'pgsql') {
            // E6 في القاعدة على PostgreSQL (SQLite في الكاتب — انظر الهجرة).
            ['tenant' => $foreign, 'channel' => $foreignChannel] = $this->makeStore('events-foreign.test', 'events-foreign');
            $foreignOrder = CommerceOrder::query()->withoutGlobalScopes()->create(['tenant_id' => $foreign->id, 'sales_channel_id' => $foreignChannel->id, 'number' => 'CORD-F1', 'total' => 1]);
            $this->assertDbRejects(fn () => $insert(['commerce_order_id' => $foreignOrder->id]), 'order of another tenant');
            $this->assertDbRejects(fn () => DB::statement('TRUNCATE commerce_order_events'), 'truncate');
        }

        // الإدراج المتصل (max+1) مقبول.
        $insert([]);
        $this->assertSame(2, $this->feedHead());

        // النموذج يرفض التعديل/الحذف أيضاً.
        app(TenantContext::class)->set($tenant);
        $model = CommerceOrderEvent::query()->firstOrFail();
        $this->assertThrows(fn () => $model->update(['type' => 'order.cancelled']), \LogicException::class);
        $this->assertThrows(fn () => $model->delete(), \LogicException::class);
        app(TenantContext::class)->forget();
    }

    #[Test]
    public function every_tenant_gets_a_feed_head_at_birth_and_tenant_deletion_cascades_its_heads_and_events(): void
    {
        $fresh = Tenant::create(['name' => 'جديد', 'slug' => 'events-new-'.Str::random(5), 'vat_number' => '300000000000003', 'currency' => 'SAR']);
        $this->assertTrue(DB::table('commerce_order_feed_heads')->where('tenant_id', $fresh->id)->exists(), 'صف القفل يولد مع المستأجر');

        app(TenantContext::class)->set($fresh->id);
        $channel = \App\Models\SalesChannel::create(['slug' => 'web', 'name' => 'Web', 'type' => \App\Models\SalesChannel::TYPE_WEB, 'is_active' => true]);
        $order = CommerceOrder::create(['sales_channel_id' => $channel->id, 'number' => 'CORD-DEL-1', 'total' => 100]);
        DB::transaction(fn () => app(CommerceOrderEventRecorder::class)->append($order, 'payment.collected', 'system'));
        app(TenantContext::class)->forget();
        $this->assertSame(1, DB::table('commerce_order_events')->where('tenant_id', $fresh->id)->count());

        // الحذف النهائي للمستأجر (cascade) يمرّ: الرأس ثم أحداثه بعد زوال صف المستأجر.
        DB::table('tenants')->where('id', $fresh->id)->delete();
        $this->assertSame(0, DB::table('commerce_order_events')->where('tenant_id', $fresh->id)->count());
        $this->assertFalse(DB::table('commerce_order_feed_heads')->where('tenant_id', $fresh->id)->exists());
    }

    // ───────────────────────── الخط الزمني للموظف ─────────────────────────

    #[Test]
    public function the_staff_detail_exposes_an_additive_timeline_with_whitelisted_data_and_staff_names_only(): void
    {
        $orderId = $this->pickupOrder('idem-ev-tl');
        $this->collect($orderId);

        $timeline = $this->withToken($this->ownerToken)->getJson("/api/commerce/orders/{$orderId}")->assertOk()->json('data.timeline');
        $this->assertSame(['order.placed', 'payment.collected'], array_column($timeline, 'type'));
        $this->assertSame([1, 2], array_column($timeline, 'seq'));
        $this->assertSame(['type' => 'guest', 'name' => null], $timeline[0]['actor']);
        $this->assertSame(['type' => 'user', 'name' => 'مستخدم owner'], $timeline[1]['actor']);
        $this->assertSame(['delivery_method' => 'pickup', 'payment_method' => 'pay_on_pickup'], $timeline[0]['data']);
        $this->assertSame([], $timeline[1]['data']);
        $this->assertNotNull($timeline[0]['at']);

        // القائمة لا تحمل الخط الزمني (التفاصيل وحدها).
        $this->assertArrayNotHasKey('timeline', $this->withToken($this->ownerToken)->getJson('/api/commerce/orders')->assertOk()->json('data.0'));
    }

    #[Test]
    public function the_timeline_respects_rbac_and_tenant_isolation(): void
    {
        $orderId = $this->pickupOrder('idem-ev-iso');
        foreach (['accountant', 'staff'] as $role) {
            $this->withToken($this->tokenFor($this->tenant, $role))->getJson("/api/commerce/orders/{$orderId}")->assertForbidden();
        }

        ['tenant' => $other] = $this->makeStore('events-iso.test', 'events-iso');
        $this->enableApplications($other);
        $this->withToken($this->tokenFor($other, 'owner'))->getJson("/api/commerce/orders/{$orderId}")->assertNotFound();
    }

    #[Test]
    public function the_timeline_costs_a_constant_number_of_queries_however_many_events_exist(): void
    {
        $few = $this->pickupOrder('idem-ev-q1');
        $many = $this->pickupOrder('idem-ev-q2');
        $this->collect($many);
        app(TenantContext::class)->set($this->tenant->id);
        $order = CommerceOrder::query()->findOrFail($many);
        foreach (range(1, 6) as $i) {
            DB::transaction(fn () => app(CommerceOrderEventRecorder::class)->append($order, 'payment.collected', 'system'));
        }
        app(TenantContext::class)->forget();

        $count = function (string $id): int {
            $this->withToken($this->ownerToken)->getJson("/api/commerce/orders/{$id}")->assertOk(); // تسخين
            DB::flushQueryLog();
            DB::enableQueryLog();
            $this->withToken($this->ownerToken)->getJson("/api/commerce/orders/{$id}")->assertOk();
            $n = count(array_filter(DB::getQueryLog(), fn (array $q) => ! str_contains($q['query'], 'personal_access_tokens')));
            DB::disableQueryLog();

            return $n;
        };
        $this->assertSame($count($few) + 1, $count($many), 'حدث موظف واحد يضيف استعلام الأسماء الثابت فقط؛ عدد الأحداث لا يغيّر العدّ');
    }

    #[Test]
    public function recording_events_creates_no_journal_entry_invoice_payment_or_stock_movement(): void
    {
        $before = $this->counts();
        $orderId = $this->pickupOrder('idem-ev-acc');
        $this->collect($orderId);
        $other = $this->pickupOrder('idem-ev-acc2');
        $this->withToken($this->ownerToken)->postJson("/api/commerce/orders/{$other}/cancel", ['reason' => 'customer_request'])->assertOk();

        $after = $this->counts();
        foreach (['journal_entries', 'payments', 'invoices', 'stock_movements'] as $table) {
            $this->assertSame($before[$table], $after[$table], "{$table} لا يتغيّر بالأحداث");
        }
        $this->assertSame(4, DB::table('commerce_order_events')->where('tenant_id', $this->tenant->id)->count());
    }

    private function assertDbRejects(callable $action, string $label): void
    {
        $level = DB::transactionLevel();
        DB::beginTransaction();
        try {
            $action();
            $this->fail("القاعدة قبلت: {$label}");
        } catch (\Illuminate\Database\QueryException) {
            // متوقع
        } finally {
            while (DB::transactionLevel() > $level) {
                DB::rollBack();
            }
        }
    }
}
