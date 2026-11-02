<?php

namespace Tests\Feature;

use App\Events\CommerceOrderAccepted;
use App\Events\CommerceOrderCancelled;
use App\Models\CommerceChannelOperationSetting;
use App\Models\CommerceOrder;
use App\Models\CommerceOrderEvent;
use App\Models\CommerceOrderLine;
use App\Models\CommercePaymentIntent;
use App\Models\InventoryReservation;
use App\Models\Product;
use App\Models\Role;
use App\Models\Tenant;
use App\Models\User;
use App\Models\Warehouse;
use App\Services\Accounting\ChartOfAccountsSeeder;
use App\Services\Commerce\CommerceChannelOperationsSettingsService;
use App\Services\Commerce\CommerceOrderAttentionQuery;
use App\Services\Commerce\CommerceOrderStatusProjector;
use App\Services\Commerce\FulfillmentPolicyService;
use App\Services\TenantApplicationService;
use App\Support\ApplicationCatalog;
use App\Tenancy\TenantContext;
use Illuminate\Database\QueryException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Str;
use PHPUnit\Framework\Attributes\Test;
use Tests\TestCase;

/**
 * ═══════════════════════════════════════════════════════════════
 *  COPS-H1-4 (ADR-29 §2.2) — قبول التاجر اليدوي ورفضه
 * ═══════════════════════════════════════════════════════════════
 *  البوابات (القبول؛ الرفض = البوابتان) · لقطة الوضع عند الإنشاء · الأهلية (R-5) · idempotency · الرفض = الإلغاء بسبب `merchant_rejected`
 *  (المصفوفة كاملة، قبل القبول فقط) · RBAC (`commerce.orders.manage` + `commerce.orders.cancel` للرفض) · العزل · حراس القاعدة · أحداث بعد
 *  الالتزام · المُسقِط والمصالحة · لا أثر مالي أو مخزني. التزامن على PostgreSQL الحقيقي في `CommerceOrderAcceptancePostgresTest`.
 */
class CommerceOrderAcceptanceTest extends TestCase
{
    use CapturesThrowable;
    use InteractsWithApi;
    use OnlineStorefrontHarness;
    use RefreshDatabase;

    private Warehouse $warehouse;

    private string $ownerToken;

    protected function setUp(): void
    {
        parent::setUp();
        $this->travelTo(now('UTC')->setDate(2026, 11, 2)->setTime(9, 0));
        $this->bootOnlineStore();
        app(TenantContext::class)->set($this->tenant->id);
        app(ChartOfAccountsSeeder::class)->seed($this->tenant->id);
        $this->warehouse = Warehouse::create(['name' => 'مخزن المتجر', 'code' => 'ACC-W1', 'is_default' => true]);
        app(FulfillmentPolicyService::class)->setFixedWarehouse($this->channel->id, $this->warehouse->id);
        $this->enableApplications($this->tenant);
        app(TenantContext::class)->forget();

        $this->ownerToken = $this->tokenFor($this->tenant, 'owner');
        config(['commerce.order_acceptance_enabled' => true, 'commerce.order_cancellation_enabled' => true]);
    }

    // ───────────────────────── أدوات ─────────────────────────

    private function enableApplications(Tenant $tenant): void
    {
        app(TenantContext::class)->set($tenant->id);
        $applications = app(TenantApplicationService::class);
        foreach (ApplicationCatalog::all() as $key => $application) {
            if ($application['mandatory'] || $application['maturity'] !== ApplicationCatalog::MATURITY_BUILT) {
                continue;
            }
            $applications->enable($key, null);
        }
        app(TenantContext::class)->forget();
    }

    private function tokenFor(Tenant $tenant, string $role, ?string $email = null): string
    {
        app(TenantContext::class)->set($tenant->id);
        $user = User::create([
            'tenant_id' => $tenant->id, 'name' => $role, 'email' => $email ?? $role.'-'.Str::random(6).'@accept.test',
            'password' => 'password123', 'role' => $role,
        ]);
        $token = $user->createToken('api')->plainTextToken;
        app(TenantContext::class)->forget();

        return $token;
    }

    private function role(string $slug, array $permissions): void
    {
        app(TenantContext::class)->set($this->tenant->id);
        Role::create(['slug' => $slug, 'name' => $slug, 'permissions' => $permissions, 'is_system' => false]);
        app(TenantContext::class)->forget();
    }

    /** طلب مؤكَّد بنية بحالة معطاة ولقطة وضع معطاة (`manual` افتراضياً)، مع حجز فعّال اختياري. */
    private function order(string $intentStatus = CommercePaymentIntent::STATUS_AWAITING_COLLECTION, ?string $mode = CommerceOrder::ACCEPTANCE_MANUAL,
        string $method = CommercePaymentIntent::METHOD_COD, bool $hold = false): CommerceOrder
    {
        app(TenantContext::class)->set($this->tenant->id);
        $order = new CommerceOrder(['sales_channel_id' => $this->channel->id, 'storefront_id' => $this->storefront->id, 'number' => 'CORD-A'.Str::upper(Str::random(6)), 'delivery_method' => 'standard', 'total' => 11500]);
        if ($mode !== null) {
            $order->forceFill(['acceptance_mode' => $mode]);
        }
        $order->save();
        CommerceOrderLine::create(['commerce_order_id' => $order->id, 'product_name_snapshot' => 'وردة', 'quantity' => 2, 'unit_price' => 5000, 'line_total' => 10000]);
        $order->snapshot()->create(['customer_name' => 'سارة', 'phone' => '0500000001', 'email' => 'b@example.test', 'shipping_city' => 'الدمام']);
        $order->update(['status' => CommerceOrder::STATUS_CONFIRMED, 'confirmed_at' => now()]);
        CommercePaymentIntent::create(['commerce_order_id' => $order->id, 'method' => $method, 'status' => $intentStatus, 'amount_minor' => 11500, 'currency' => 'SAR']);
        if ($hold) {
            $product = Product::create(['name' => 'منتج', 'sku' => 'AC-'.Str::random(6), 'unit' => 'piece', 'sale_price' => 5000, 'is_active' => true, 'track_inventory' => true]);
            InventoryReservation::create([
                'warehouse_id' => $this->warehouse->id, 'product_id' => $product->id, 'base_quantity' => 1, 'status' => InventoryReservation::STATUS_ACTIVE,
                'source_type' => CommerceOrder::class, 'source_id' => $order->id, 'idempotency_key' => 'hold-'.Str::random(10), 'request_checksum' => Str::random(16),
                'expires_at' => now('UTC')->addHour(),
            ]);
        }
        app(TenantContext::class)->forget();

        return $order->fresh();
    }

    private function accept(string $orderId, ?string $token = null)
    {
        return $this->withToken($token ?? $this->ownerToken)->postJson("/api/commerce/orders/{$orderId}/accept");
    }

    private function reject(string $orderId, array $body = [], ?string $token = null)
    {
        return $this->withToken($token ?? $this->ownerToken)->postJson("/api/commerce/orders/{$orderId}/reject", $body);
    }

    private function fresh(string $orderId): CommerceOrder
    {
        app(TenantContext::class)->set($this->tenant->id);

        return CommerceOrder::query()->with('paymentIntent')->findOrFail($orderId);
    }

    /** @return list<string> */
    private function eventTypes(string $orderId): array
    {
        return DB::table('commerce_order_events')->where('commerce_order_id', $orderId)->orderBy('feed_seq')->pluck('type')->all();
    }

    private function world(string $orderId): array
    {
        return [
            'order' => DB::table('commerce_orders')->where('id', $orderId)->first(),
            'intent' => DB::table('commerce_payment_intents')->where('commerce_order_id', $orderId)->first(),
            'holds' => DB::table('inventory_reservations')->where('source_id', $orderId)->orderBy('id')->get()->toArray(),
            'events' => DB::table('commerce_order_events')->orderBy('feed_seq')->get()->toArray(),
            'counts' => $this->counts(),
        ];
    }

    private function assertRefused($response, string $reason, int $status = 409): void
    {
        $response->assertStatus($status)->assertJsonPath('reason', $reason);
    }

    private function raw(string $id, array $set): int
    {
        return DB::table('commerce_orders')->where('id', $id)->update($set);
    }

    private function assertGuard(callable $operation, string $why): void
    {
        $e = $this->thrown(fn () => DB::transaction($operation), $why, QueryException::class);
        $this->assertStringContainsString('commerce_orders', $e->getMessage(), $why);
    }

    private function userId(string $role = 'admin'): string
    {
        app(TenantContext::class)->set($this->tenant->id);

        return User::create(['tenant_id' => $this->tenant->id, 'name' => 'فاعل', 'email' => 'actor-'.Str::random(6).'@accept.test', 'password' => 'password123', 'role' => $role])->id;
    }

    // ═════════════════════════ 1) البوابات والتوافق ═════════════════════════

    #[Test]
    public function with_the_acceptance_gate_closed_both_routes_are_not_found_and_change_nothing(): void
    {
        $order = $this->order();
        config(['commerce.order_acceptance_enabled' => false]);
        $before = $this->world($order->id);

        $this->accept($order->id)->assertNotFound();
        $this->reject($order->id)->assertNotFound();

        $this->assertEquals($before, $this->world($order->id));
    }

    #[Test]
    public function rejection_needs_the_cancellation_gate_open_as_well(): void
    {
        $order = $this->order();
        config(['commerce.order_cancellation_enabled' => false]);

        $this->reject($order->id)->assertNotFound();
        $this->accept($order->id)->assertOk(); // القبول لا يحتاج بوابة الإلغاء
        $this->assertNull($this->fresh($order->id)->cancelled_at);
    }

    #[Test]
    public function a_closed_gate_keeps_order_creation_literally_unchanged_and_never_reads_the_settings_table(): void
    {
        app(TenantContext::class)->set($this->tenant->id);
        $actor = User::query()->where('tenant_id', $this->tenant->id)->firstOrFail();
        app(CommerceChannelOperationsSettingsService::class)->update($this->channel->id, 0, ['acceptance_mode' => 'manual'], $actor);
        app(TenantContext::class)->forget();
        config(['commerce.order_acceptance_enabled' => false]);

        $reads = 0;
        DB::listen(function ($query) use (&$reads): void {
            $reads += str_contains($query->sql, 'commerce_channel_operation_settings') ? 1 : 0;
        });
        $order = $this->onlineOrder(key: 'idem-acc-closed');

        $this->assertSame(0, $reads, 'البوابة المغلقة: لا استعلام على إعدادات التشغيل في الإتمام');
        $row = DB::table('commerce_orders')->where('id', $order['order_id'])->first();
        $this->assertNull($row->acceptance_mode);
        $this->assertNull($row->accepted_at);
        $this->assertSame(['order.placed'], $this->eventTypes($order['order_id']));
    }

    #[Test]
    public function an_open_gate_snapshots_manual_only_for_a_manual_channel_and_the_snapshot_survives_a_later_change(): void
    {
        $auto = $this->onlineOrder(key: 'idem-acc-auto');
        $this->assertNull(DB::table('commerce_orders')->where('id', $auto['order_id'])->value('acceptance_mode'), 'لا صف ⇒ تلقائي');

        app(TenantContext::class)->set($this->tenant->id);
        $actor = User::query()->where('tenant_id', $this->tenant->id)->firstOrFail();
        app(CommerceChannelOperationsSettingsService::class)->update($this->channel->id, 0, ['acceptance_mode' => 'manual'], $actor);
        app(TenantContext::class)->forget();
        $manual = $this->onlineOrder(key: 'idem-acc-manual');
        $this->assertSame('manual', DB::table('commerce_orders')->where('id', $manual['order_id'])->value('acceptance_mode'));

        app(TenantContext::class)->set($this->tenant->id);
        app(CommerceChannelOperationsSettingsService::class)->update($this->channel->id, 1, ['acceptance_mode' => 'auto'], $actor);
        app(TenantContext::class)->forget();
        $this->assertSame('manual', DB::table('commerce_orders')->where('id', $manual['order_id'])->value('acceptance_mode'), 'اللقطة لا الإعداد الحي');
        $later = $this->onlineOrder(key: 'idem-acc-later');
        $this->assertNull(DB::table('commerce_orders')->where('id', $later['order_id'])->value('acceptance_mode'));
    }

    // ═════════════════════════ 2) القبول ═════════════════════════

    #[Test]
    public function a_manual_cod_order_is_accepted_once_with_its_actor_an_event_and_no_financial_or_inventory_effect(): void
    {
        $order = $this->order(hold: true);
        $before = $this->world($order->id);
        Event::fake([CommerceOrderAccepted::class]);

        $response = $this->accept($order->id)->assertOk();

        $response->assertJsonPath('data.operational_status', 'accepted')
            ->assertJsonPath('data.acceptance.mode', 'manual')
            ->assertJsonPath('data.acceptance.effective_mode', 'manual')
            ->assertJsonPath('data.acceptance.by.name', 'owner')
            ->assertJsonPath('data.lifecycle_status', 'confirmed');
        $fresh = $this->fresh($order->id);
        $this->assertNotNull($fresh->accepted_at);
        $this->assertNotNull($fresh->accepted_by_user_id);
        $this->assertSame(['order.accepted'], $this->eventTypes($order->id));
        $event = DB::table('commerce_order_events')->where('commerce_order_id', $order->id)->first();
        $this->assertSame('user', $event->actor_type);
        $this->assertSame($fresh->accepted_by_user_id, $event->actor_id);
        $this->assertNull($event->data, 'بلا بيانات (لا PII)');
        Event::assertDispatched(CommerceOrderAccepted::class, fn ($e) => $e->orderId === $order->id && $e->tenantId === $this->tenant->id);

        $after = $this->world($order->id);
        $this->assertEquals($before['intent'], $after['intent'], 'لا مساس بالدفع');
        $this->assertEquals($before['holds'], $after['holds'], 'لا مساس بالحجز');
        $this->assertEquals($before['counts'], $after['counts'], 'لا قيد ولا سند ولا فاتورة ولا حركة مخزون');
    }

    #[Test]
    public function accepting_again_is_idempotent_with_no_new_event_and_unchanged_facts(): void
    {
        $order = $this->order();
        $this->accept($order->id)->assertOk();
        $first = DB::table('commerce_orders')->where('id', $order->id)->first(['accepted_at', 'accepted_by_user_id']);

        $this->travel(5)->minutes();
        $this->accept($order->id, $this->tokenFor($this->tenant, 'admin'))->assertOk();

        $this->assertEquals($first, DB::table('commerce_orders')->where('id', $order->id)->first(['accepted_at', 'accepted_by_user_id']));
        $this->assertSame(['order.accepted'], $this->eventTypes($order->id));
    }

    #[Test]
    public function acceptance_refuses_auto_cancelled_unpaid_and_payment_cancelled_orders_without_any_write(): void
    {
        $cases = [
            'not_manual' => $this->order(mode: null),
            'payment_pending' => $this->order(CommercePaymentIntent::STATUS_PENDING, method: CommercePaymentIntent::METHOD_ONLINE),
            'payment_not_ready' => $this->order(CommercePaymentIntent::STATUS_CANCELLED, method: CommercePaymentIntent::METHOD_ONLINE),
        ];
        $cancelled = $this->order();
        $this->reject($cancelled->id)->assertOk();
        $cases['already_cancelled'] = $cancelled;

        foreach ($cases as $reason => $order) {
            $before = $this->world($order->id);
            $this->assertRefused($this->accept($order->id), $reason);
            $this->assertEquals($before, $this->world($order->id), $reason);
        }
    }

    #[Test]
    public function collected_cod_and_paid_online_orders_are_acceptable(): void
    {
        $collected = $this->order(CommercePaymentIntent::STATUS_COLLECTED);
        $paid = $this->order(CommercePaymentIntent::STATUS_PAID, method: CommercePaymentIntent::METHOD_ONLINE);

        $this->accept($collected->id)->assertOk();
        $this->accept($paid->id)->assertOk();
    }

    #[Test]
    public function an_unpaid_online_manual_order_becomes_acceptable_only_after_its_capture_is_confirmed(): void
    {
        app(TenantContext::class)->set($this->tenant->id);
        $actor = User::query()->where('tenant_id', $this->tenant->id)->firstOrFail();
        app(CommerceChannelOperationsSettingsService::class)->update($this->channel->id, 0, ['acceptance_mode' => 'manual'], $actor);
        app(TenantContext::class)->forget();
        $order = $this->onlineOrder(key: 'idem-acc-online');
        $this->startPayment($order)->assertSuccessful();

        $this->assertRefused($this->accept($order['order_id']), 'payment_pending');
        $this->assertSame([], app(CommerceOrderAttentionQuery::class)->run()['orders']->all(), 'R-5: خارج المصالحة قبل الدفع');

        $attempt = $this->attempts($order['order_id'])->first();
        $this->capture($attempt);
        $this->elapse($attempt);
        $this->paymentStatus($order)->assertOk();
        $this->assertSame('paid', $this->intent($order['order_id'])->status);

        $this->accept($order['order_id'])->assertOk();
        $this->assertSame(['order.placed', 'payment.paid', 'order.accepted'], $this->eventTypes($order['order_id']));
    }

    // ═════════════════════════ 3) الرفض = الإلغاء بسبب merchant_rejected ═════════════════════════

    #[Test]
    public function a_manual_order_is_rejected_through_the_cancellation_path(): void
    {
        $order = $this->order(hold: true);
        $before = $this->world($order->id);
        Event::fake([CommerceOrderCancelled::class]);

        $this->reject($order->id, ['note' => 'لا نوصل لهذه المنطقة'])->assertOk()
            ->assertJsonPath('data.operational_status', 'cancelled')
            ->assertJsonPath('data.cancellation.reason', 'merchant_rejected')
            ->assertJsonPath('data.cancellation.note', 'لا نوصل لهذه المنطقة');

        $fresh = $this->fresh($order->id);
        $this->assertNotNull($fresh->cancelled_at);
        $this->assertNull($fresh->accepted_at);
        $this->assertSame('cancelled', $fresh->paymentIntent->status);
        $this->assertSame(['released'], DB::table('inventory_reservations')->where('source_id', $order->id)->pluck('status')->all());
        $this->assertSame(['order.cancelled'], $this->eventTypes($order->id));
        $this->assertSame('{"reason":"merchant_rejected"}', (string) DB::table('commerce_order_events')->where('commerce_order_id', $order->id)->value('data'));
        Event::assertDispatched(CommerceOrderCancelled::class, fn ($e) => $e->orderId === $order->id);
        $this->assertEquals($before['counts']['journal_entries'], $this->counts()['journal_entries']);
        $this->assertEquals($before['counts']['stock_movements'], $this->counts()['stock_movements']);

        // idempotent: رفض مكرر ⇒ 200 بلا أثر.
        $this->reject($order->id)->assertOk();
        $this->assertSame(['order.cancelled'], $this->eventTypes($order->id));
    }

    #[Test]
    public function rejection_is_refused_after_acceptance_for_auto_orders_and_through_the_cancellation_matrix(): void
    {
        $accepted = $this->order();
        $this->accept($accepted->id)->assertOk();
        $auto = $this->order(mode: null);
        $collected = $this->order(CommercePaymentIntent::STATUS_COLLECTED);
        $paid = $this->order(CommercePaymentIntent::STATUS_PAID, method: CommercePaymentIntent::METHOD_ONLINE);
        $otherCancel = $this->order();
        $this->withToken($this->ownerToken)->postJson("/api/commerce/orders/{$otherCancel->id}/cancel", ['reason' => 'customer_request'])->assertOk();

        foreach ([
            'already_accepted' => $accepted, 'not_manual' => $auto, 'payment_collected' => $collected,
            'payment_paid' => $paid, 'already_cancelled' => $otherCancel,
        ] as $reason => $order) {
            $before = $this->world($order->id);
            $this->assertRefused($this->reject($order->id), $reason);
            $this->assertEquals($before, $this->world($order->id), $reason);
        }
    }

    #[Test]
    public function an_accepted_order_can_still_be_cancelled_normally_and_keeps_its_acceptance_facts(): void
    {
        $order = $this->order();
        $this->accept($order->id)->assertOk();
        $accepted = DB::table('commerce_orders')->where('id', $order->id)->value('accepted_at');

        $this->withToken($this->ownerToken)->postJson("/api/commerce/orders/{$order->id}/cancel", ['reason' => 'out_of_stock'])->assertOk()
            ->assertJsonPath('data.operational_status', 'cancelled');

        $this->assertSame($accepted, DB::table('commerce_orders')->where('id', $order->id)->value('accepted_at'));
        $this->assertSame(['order.accepted', 'order.cancelled'], $this->eventTypes($order->id));
    }

    #[Test]
    public function the_general_cancellation_route_cannot_use_the_rejection_reason(): void
    {
        $order = $this->order();

        $this->withToken($this->ownerToken)->postJson("/api/commerce/orders/{$order->id}/cancel", ['reason' => 'merchant_rejected'])->assertUnprocessable();

        $this->assertNull($this->fresh($order->id)->cancelled_at);
        $this->assertNotContains('merchant_rejected', CommerceOrder::CANCELLATION_REASONS);
    }

    #[Test]
    public function the_rejection_note_is_bounded_and_the_body_never_carries_a_tenant(): void
    {
        $order = $this->order();

        $this->reject($order->id, ['note' => str_repeat('x', 501)])->assertUnprocessable();
        $this->reject($order->id, ['tenant_id' => (string) Str::uuid()])->assertUnprocessable();
        $this->withToken($this->ownerToken)->postJson("/api/commerce/orders/{$order->id}/accept", ['tenant_id' => (string) Str::uuid()])->assertUnprocessable();

        $this->assertNull($this->fresh($order->id)->cancelled_at);
        $this->assertNull($this->fresh($order->id)->accepted_at);
    }

    // ═════════════════════════ 4) RBAC والعزل ═════════════════════════

    #[Test]
    public function acceptance_needs_the_manage_permission_and_rejection_needs_manage_and_cancel(): void
    {
        $this->role('manager_only', ['commerce.orders.view', 'commerce.orders.manage']);
        $this->role('canceller_only', ['commerce.orders.view', 'commerce.orders.cancel']);
        $this->role('manager_canceller', ['commerce.orders.manage', 'commerce.orders.cancel']);

        foreach (['accountant', 'staff', 'self_service', 'canceller_only'] as $role) {
            $order = $this->order();
            $token = $this->tokenFor($this->tenant, $role);
            $this->accept($order->id, $token)->assertForbidden();
            $this->reject($order->id, [], $token)->assertForbidden();
            $this->assertNull($this->fresh($order->id)->accepted_at, $role);
            $this->assertNull($this->fresh($order->id)->cancelled_at, $role);
        }

        $manager = $this->tokenFor($this->tenant, 'manager_only');
        $forManager = $this->order();
        $this->reject($forManager->id, [], $manager)->assertForbidden();
        $this->accept($forManager->id, $manager)->assertOk();

        $both = $this->tokenFor($this->tenant, 'manager_canceller');
        $this->reject($this->order()->id, [], $both)->assertOk();
        $this->reject($this->order()->id, [], $this->tokenFor($this->tenant, 'admin'))->assertOk();

        $anonymous = $this->order();
        $this->flushHeaders()->postJson("/api/commerce/orders/{$anonymous->id}/accept")->assertUnauthorized();
    }

    #[Test]
    public function the_manage_permission_is_never_granted_implicitly(): void
    {
        $this->assertContains('commerce.orders.manage', \App\Support\Rbac::PERMISSIONS);
        foreach (\App\Support\Rbac::MATRIX as $role => $permissions) {
            $this->assertNotContains('commerce.orders.manage', $permissions, $role);
        }
    }

    #[Test]
    public function a_warehouse_restricted_user_and_a_disabled_application_are_refused(): void
    {
        $order = $this->order();
        $token = $this->tokenFor($this->tenant, 'admin', 'restricted-accept@accept.test');
        app(TenantContext::class)->set($this->tenant->id);
        User::where('email', 'restricted-accept@accept.test')->firstOrFail()->warehouses()->attach($this->warehouse->id);
        app(TenantContext::class)->forget();

        $this->accept($order->id, $token)->assertForbidden();
        $this->reject($order->id, [], $token)->assertForbidden();

        app(TenantContext::class)->set($this->tenant->id);
        app(TenantApplicationService::class)->disable('commerce.storefront', null);
        app(TenantContext::class)->forget();
        $this->accept($order->id)->assertForbidden();
        $this->assertNull($this->fresh($order->id)->accepted_at);
    }

    #[Test]
    public function another_tenants_order_is_indistinguishable_from_a_missing_one(): void
    {
        $order = $this->order();
        ['tenant' => $other] = $this->makeStore('other-accept.test', 'other-accept');
        $this->enableApplications($other);
        $foreign = $this->tokenFor($other, 'owner');
        $before = $this->world($order->id);

        $accept = $this->accept($order->id, $foreign);
        $missing = $this->accept((string) Str::uuid(), $foreign);
        $reject = $this->reject($order->id, [], $foreign);

        $accept->assertNotFound();
        $missing->assertNotFound();
        $reject->assertNotFound();
        $this->assertSame($missing->json('message'), $accept->json('message'));
        $this->assertEquals($before, $this->world($order->id));
    }

    // ═════════════════════════ 5) حراس القاعدة ═════════════════════════

    #[Test]
    public function the_database_refuses_invalid_acceptance_facts_at_creation(): void
    {
        $order = $this->order();
        $row = (array) DB::table('commerce_orders')->where('id', $order->id)->first();
        foreach ([['acceptance_mode' => 'auto'], ['acceptance_mode' => 'other'], ['accepted_at' => now('UTC')], ['accepted_by_user_id' => $this->userId()]] as $i => $bad) {
            $copy = array_merge($row, ['id' => (string) Str::uuid(), 'number' => 'CORD-G'.$i.Str::random(4), 'commerce_checkout_id' => null], $bad);
            $this->assertGuard(fn () => DB::table('commerce_orders')->insert($copy), 'insert '.json_encode(array_keys($bad)));
        }
    }

    #[Test]
    public function the_mode_is_frozen_and_an_acceptance_needs_a_confirmed_uncancelled_manual_order_and_an_actor(): void
    {
        $manual = $this->order();
        $auto = $this->order(mode: null);
        $actor = $this->userId();

        $this->assertGuard(fn () => $this->raw($manual->id, ['acceptance_mode' => null]), 'mode cleared');
        $this->assertGuard(fn () => $this->raw($auto->id, ['acceptance_mode' => 'manual']), 'mode set later');
        $this->assertGuard(fn () => $this->raw($manual->id, ['accepted_by_user_id' => $actor]), 'actor without time');
        $this->assertGuard(fn () => $this->raw($manual->id, ['accepted_at' => now('UTC')]), 'no actor');
        $this->assertGuard(fn () => $this->raw($auto->id, ['accepted_at' => now('UTC'), 'accepted_by_user_id' => $actor]), 'auto accepted');

        $cancelled = $this->order();
        $this->reject($cancelled->id)->assertOk();
        $this->assertGuard(fn () => $this->raw($cancelled->id, ['accepted_at' => now('UTC'), 'accepted_by_user_id' => $actor]), 'cancelled accepted');

        $this->assertSame(1, $this->raw($manual->id, ['accepted_at' => now('UTC'), 'accepted_by_user_id' => $actor]), 'the sanctioned transition');
    }

    #[Test]
    public function acceptance_facts_are_immutable_but_the_actor_may_be_nulled_by_a_user_deletion(): void
    {
        $order = $this->order();
        $this->accept($order->id)->assertOk();
        $other = $this->userId();

        $this->assertGuard(fn () => $this->raw($order->id, ['accepted_at' => now('UTC')->addMinute()]), 'time changed');
        $this->assertGuard(fn () => $this->raw($order->id, ['accepted_at' => null]), 'time cleared');
        $this->assertGuard(fn () => $this->raw($order->id, ['accepted_by_user_id' => $other]), 'actor replaced');
        $this->assertGuard(fn () => DB::table('commerce_orders')->where('id', $order->id)->delete(), 'accepted order deleted');

        $this->assertSame(1, $this->raw($order->id, ['accepted_by_user_id' => null]), 'nullOnDelete path stays possible');
    }

    #[Test]
    public function the_database_allows_a_merchant_rejection_only_before_acceptance_on_a_manual_order(): void
    {
        $auto = $this->order(mode: null);
        $accepted = $this->order();
        $this->accept($accepted->id)->assertOk();
        $actor = $this->userId();
        $reject = fn (string $id) => $this->raw($id, ['cancelled_at' => now('UTC'), 'cancelled_by_user_id' => $actor, 'cancellation_reason' => 'merchant_rejected']);

        $this->assertGuard(fn () => $reject($auto->id), 'auto order rejected');
        $this->assertGuard(fn () => $reject($accepted->id), 'accepted order rejected');
        $this->assertSame(1, $reject($this->order()->id), 'a manual unaccepted order may be rejected');
        $this->assertGuard(fn () => $this->raw($this->order()->id, ['cancelled_at' => now('UTC'), 'cancelled_by_user_id' => $actor, 'cancellation_reason' => 'not_a_reason']), 'unknown reason');
    }

    #[Test]
    public function the_event_log_accepts_the_new_type_and_still_refuses_unknown_ones(): void
    {
        $order = $this->order();
        $row = [
            'tenant_id' => $this->tenant->id, 'commerce_order_id' => $order->id, 'actor_type' => 'system', 'actor_id' => null,
            'data' => null, 'occurred_at' => now('UTC'), 'created_at' => now('UTC'),
        ];
        $this->thrown(fn () => DB::transaction(fn () => DB::table('commerce_order_events')->insert($row + ['id' => (string) Str::uuid(), 'feed_seq' => 1, 'type' => 'order.rejected'])), 'unknown type', QueryException::class);
        DB::table('commerce_order_events')->insert($row + ['id' => (string) Str::uuid(), 'feed_seq' => 1, 'type' => 'order.accepted']);
        $this->assertSame(1, DB::table('commerce_order_events')->where('type', 'order.accepted')->count());
    }

    #[Test]
    public function rolling_back_is_refused_once_acceptance_facts_or_rejections_exist(): void
    {
        $this->accept($this->order()->id)->assertOk();
        $this->reject($this->order()->id)->assertOk();

        foreach (['2026_12_30_020000_extend_commerce_order_guards_for_merchant_acceptance', '2026_12_30_010000_add_acceptance_facts_to_commerce_orders'] as $name) {
            $migration = require database_path("migrations/{$name}.php");
            $this->thrown(fn () => $migration->down(), $name, \RuntimeException::class);
        }
        $this->assertTrue(\Illuminate\Support\Facades\Schema::hasColumn('commerce_orders', 'accepted_at'));
    }

    // ═════════════════════════ 6) المُسقِط والعقد والمصالحة ═════════════════════════

    #[Test]
    public function the_projected_operational_status_follows_the_facts_and_the_gate(): void
    {
        $pending = $this->order(CommercePaymentIntent::STATUS_PENDING, method: CommercePaymentIntent::METHOD_ONLINE);
        $paymentCancelled = $this->order(CommercePaymentIntent::STATUS_CANCELLED, method: CommercePaymentIntent::METHOD_ONLINE);
        $awaiting = $this->order();
        $accepted = $this->order();
        $this->accept($accepted->id)->assertOk();
        $auto = $this->order(mode: null);
        $rejected = $this->order();
        $this->reject($rejected->id)->assertOk();

        $expect = [
            $pending->id => 'awaiting_payment', $paymentCancelled->id => 'payment_cancelled', $awaiting->id => 'awaiting_acceptance',
            $accepted->id => 'accepted', $auto->id => 'accepted', $rejected->id => 'cancelled',
        ];
        foreach ($expect as $id => $status) {
            $this->assertSame($status, CommerceOrderStatusProjector::project($this->fresh($id)), $id);
        }

        config(['commerce.order_acceptance_enabled' => false]);
        $this->assertSame('accepted', CommerceOrderStatusProjector::project($this->fresh($awaiting->id)), 'البوابة المغلقة ⇒ تلقائي');
        $this->assertSame('auto', CommerceOrderStatusProjector::acceptanceBlock($this->fresh($awaiting->id))['effective_mode']);
        $this->assertSame('manual', CommerceOrderStatusProjector::acceptanceBlock($this->fresh($awaiting->id))['mode']);
    }

    #[Test]
    public function the_projector_is_pure_and_never_queries_or_writes(): void
    {
        $code = preg_replace('#/\*.*?\*/#s', '', (string) file_get_contents(app_path('Services/Commerce/CommerceOrderStatusProjector.php')));
        foreach (['DB::', '::query(', '->save(', '->update(', 'lockForUpdate', 'forceFill'] as $forbidden) {
            $this->assertStringNotContainsString($forbidden, $code, $forbidden);
        }
    }

    #[Test]
    public function the_list_exposes_the_projection_without_extra_queries_per_row(): void
    {
        $this->accept($this->order()->id)->assertOk();
        $this->withToken($this->ownerToken)->getJson('/api/commerce/orders')->assertOk(); // تسخين (ذاكرات الأدوار/الإعداد)
        DB::enableQueryLog();
        $this->withToken($this->ownerToken)->getJson('/api/commerce/orders')->assertOk();
        $few = count(DB::getQueryLog());
        DB::flushQueryLog();
        foreach (range(1, 4) as $i) {
            $this->order();
        }
        $this->accept($this->order()->id)->assertOk();
        $this->withToken($this->ownerToken)->getJson('/api/commerce/orders')->assertOk();
        DB::flushQueryLog();
        $rows = $this->withToken($this->ownerToken)->getJson('/api/commerce/orders')->assertOk()->json('data');
        $many = count(DB::getQueryLog());
        DB::disableQueryLog();

        $this->assertSame($few, $many);
        $this->assertEqualsCanonicalizing(['awaiting_acceptance', 'accepted'], array_values(array_unique(array_column($rows, 'operational_status'))));
        $this->assertArrayHasKey('effective_mode', $rows[0]['acceptance']);
    }

    #[Test]
    public function the_detail_offers_the_actions_only_when_their_gates_and_permissions_allow(): void
    {
        $order = $this->order();
        $this->role('manager_only', ['commerce.orders.view', 'commerce.orders.manage']);

        $owner = $this->withToken($this->ownerToken)->getJson("/api/commerce/orders/{$order->id}")->assertOk();
        $owner->assertJsonPath('data.accept_action', ['available' => true, 'blocked_reason' => null])
            ->assertJsonPath('data.reject_action', ['available' => true, 'blocked_reason' => null]);

        $manager = $this->withToken($this->tokenFor($this->tenant, 'manager_only'))->getJson("/api/commerce/orders/{$order->id}")->assertOk();
        $this->assertArrayHasKey('accept_action', $manager->json('data'));
        $this->assertArrayNotHasKey('reject_action', $manager->json('data'), 'الرفض يحتاج الصلاحيتين');

        config(['commerce.order_cancellation_enabled' => false]);
        $this->assertArrayNotHasKey('reject_action', $this->withToken($this->ownerToken)->getJson("/api/commerce/orders/{$order->id}")->json('data'));
        config(['commerce.order_acceptance_enabled' => false]);
        $closed = $this->withToken($this->ownerToken)->getJson("/api/commerce/orders/{$order->id}")->json('data');
        $this->assertArrayNotHasKey('accept_action', $closed);
        $this->assertArrayNotHasKey('reject_action', $closed);

        config(['commerce.order_acceptance_enabled' => true, 'commerce.order_cancellation_enabled' => true]);
        $this->accept($order->id)->assertOk();
        $this->withToken($this->ownerToken)->getJson("/api/commerce/orders/{$order->id}")
            ->assertJsonPath('data.accept_action', ['available' => false, 'blocked_reason' => 'already_accepted'])
            ->assertJsonPath('data.reject_action', ['available' => false, 'blocked_reason' => 'already_accepted']);
        $this->withToken($this->ownerToken)->getJson('/api/commerce/orders/'.$this->order(mode: null)->id)
            ->assertJsonPath('data.accept_action.blocked_reason', 'not_manual');
    }

    #[Test]
    public function attention_keeps_new_order_and_adds_awaiting_acceptance_from_state_regardless_of_age(): void
    {
        $old = $this->order();
        $this->raw($old->id, ['created_at' => now('UTC')->subDays(5)]);
        $recent = $this->order();
        $acceptedRecent = $this->order();
        $this->accept($acceptedRecent->id)->assertOk();
        $acceptedOld = $this->order();
        $this->accept($acceptedOld->id)->assertOk();
        $this->raw($acceptedOld->id, ['created_at' => now('UTC')->subDays(5)]);
        $unpaidManual = $this->order(CommercePaymentIntent::STATUS_PENDING, method: CommercePaymentIntent::METHOD_ONLINE);

        $rows = collect($this->withToken($this->ownerToken)->getJson('/api/commerce/orders/attention')->assertOk()->json('data'))->keyBy('order.id');

        $this->assertSame(['awaiting_acceptance'], $rows[$old->id]['reasons']);
        $this->assertSame(['new_order', 'awaiting_acceptance'], $rows[$recent->id]['reasons']);
        $this->assertSame(['new_order'], $rows[$acceptedRecent->id]['reasons']);
        $this->assertFalse($rows->has($acceptedOld->id));
        $this->assertFalse($rows->has($unpaidManual->id), 'R-5');
        $this->assertSame($old->id, $rows->keys()->first(), 'الأقدم أولاً');

        config(['commerce.order_acceptance_enabled' => false]);
        $closed = collect($this->withToken($this->ownerToken)->getJson('/api/commerce/orders/attention')->assertOk()->json('data'))->keyBy('order.id');
        $this->assertFalse($closed->has($old->id), 'البوابة المغلقة ⇒ سلوك H1-2 حرفياً');
        $this->assertSame(['new_order'], $closed[$recent->id]['reasons']);
    }

    #[Test]
    public function the_feed_carries_the_acceptance_event_in_commit_order(): void
    {
        $order = $this->order();
        $this->accept($order->id)->assertOk();

        $events = $this->withToken($this->ownerToken)->getJson('/api/commerce/orders/feed?after_seq=0')->assertOk()->json('data');

        $this->assertSame('order.accepted', end($events)['type']);
    }
}
