<?php

namespace Tests\Feature;

use App\Models\CommerceListing;
use App\Models\CommerceOrder;
use App\Models\CommerceOrderLine;
use App\Models\CommercePaymentIntent;
use App\Models\InventoryReservation;
use App\Models\PaymentAttempt;
use App\Models\Product;
use App\Models\ProductWarehouseStock;
use App\Models\Role;
use App\Models\SalesChannel;
use App\Models\Tenant;
use App\Models\User;
use App\Models\Warehouse;
use App\Services\Accounting\ChartOfAccountsSeeder;
use App\Services\Commerce\CommerceOnlinePaymentService;
use App\Services\Commerce\CommerceOrderLifecycleService;
use App\Services\Commerce\FulfillmentPolicyService;
use App\Services\Commerce\OrderCancellationCleanup;
use App\Services\PaymentAttemptPostingService;
use App\Services\PaymentOrchestrator;
use App\Services\TenantApplicationService;
use App\Support\ApplicationCatalog;
use App\Support\Settings;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Str;
use PHPUnit\Framework\Attributes\Test;
use RuntimeException;
use Tests\TestCase;

/**
 * ═══════════════════════════════════════════════════════════════
 *  COMMERCE-ORDERS-O3a-2b (ADR-28 §3–§5) — إلغاء طلب المتجر بواسطة موظف مخوّل
 * ═══════════════════════════════════════════════════════════════
 *  مصفوفة الحالات §3 · RBAC/IDOR/عزل المستأجر · البوابة المغلقة افتراضياً · idempotency · تراجع كامل · تنظيف بعد الالتزام فقط ·
 *  عدم وجود أثر محاسبي/مخزني · تفويض مسار إلغاء النية القديم بصلاحيتين. التزامن على PostgreSQL الحقيقي في
 *  `CommerceOrderCancellationPostgresTest`.
 */
class CommerceOrderCancellationTest extends TestCase
{
    use InteractsWithApi;
    use OnlineStorefrontHarness;
    use RefreshDatabase;

    private Warehouse $warehouse;

    private string $ownerToken;

    protected function setUp(): void
    {
        parent::setUp();
        $this->travelTo(now('UTC')->setDate(2026, 10, 23)->setTime(9, 0));
        $this->bootOnlineStore();
        app(TenantContext::class)->set($this->tenant->id);
        app(ChartOfAccountsSeeder::class)->seed($this->tenant->id);
        $this->warehouse = Warehouse::create(['name' => 'مخزن المتجر', 'code' => 'CAN-W1', 'is_default' => true]);
        app(FulfillmentPolicyService::class)->setFixedWarehouse($this->channel->id, $this->warehouse->id);
        $this->enableApplications($this->tenant);
        app(TenantContext::class)->forget();

        $this->ownerToken = $this->tokenFor($this->tenant, 'owner');
        config(['commerce.order_cancellation_enabled' => true]);
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
            'tenant_id' => $tenant->id, 'name' => $role, 'email' => $email ?? $role.'-'.Str::random(6).'@cancel.test',
            'password' => 'password123', 'role' => $role,
        ]);
        $token = $user->createToken('api')->plainTextToken;
        app(TenantContext::class)->forget();

        return $token;
    }

    private function tracked(int $onHand = 10, int $taxRate = 15): Product
    {
        app(TenantContext::class)->set($this->tenant->id);
        $product = Product::create(['name' => 'منتج مخزني', 'sku' => 'CN-'.Str::random(8), 'unit' => 'piece', 'sale_price' => 5000, 'purchase_price' => 2000, 'avg_cost' => 2000, 'tax_rate' => $taxRate, 'is_active' => true, 'track_inventory' => true]);
        CommerceListing::create(['product_id' => $product->id, 'sales_channel_id' => $this->channel->id, 'is_published' => true]);
        ProductWarehouseStock::create(['product_id' => $product->id, 'warehouse_id' => $this->warehouse->id, 'quantity' => $onHand]);
        DB::table('products')->where('id', $product->id)->update(['quantity_on_hand' => $onHand]);
        app(TenantContext::class)->forget();

        return $product;
    }

    /** طلب إلكتروني بحجز فعّال، بلا محاولة دفع بعد. */
    private function onlinePending(string $key = 'idem-can-1'): array
    {
        return $this->onlineOrder(product: $this->tracked(), key: $key);
    }

    /** طلب إلكتروني بمحاولة بصفحة حيّة (`pending_customer`). */
    private function onlineLive(string $key = 'idem-can-live'): array
    {
        $order = $this->onlinePending($key);
        $this->startPayment($order)->assertSuccessful();

        return $order;
    }

    /** طلب COD مؤكَّد بنية بحالة معطاة (بلا حجز، كما اليوم). */
    private function cod(string $status = CommercePaymentIntent::STATUS_AWAITING_COLLECTION, ?string $number = null): CommerceOrder
    {
        $number ??= 'CORD-C'.Str::upper(Str::random(6));
        app(TenantContext::class)->set($this->tenant->id);
        $order = CommerceOrder::create(['sales_channel_id' => $this->channel->id, 'storefront_id' => $this->storefront->id, 'number' => $number, 'delivery_method' => 'standard', 'total' => 11500]);
        CommerceOrderLine::create(['commerce_order_id' => $order->id, 'product_name_snapshot' => 'وردة', 'quantity' => 2, 'unit_price' => 5000, 'line_total' => 10000]);
        $order->snapshot()->create(['customer_name' => 'سارة', 'phone' => '0500000001', 'email' => 'b@example.test', 'shipping_city' => 'الدمام']);
        $order->update(['status' => CommerceOrder::STATUS_CONFIRMED, 'confirmed_at' => now()]);
        CommercePaymentIntent::create(['commerce_order_id' => $order->id, 'method' => CommercePaymentIntent::METHOD_COD, 'status' => $status, 'amount_minor' => 11500, 'currency' => 'SAR']);
        app(TenantContext::class)->forget();

        return $order->fresh();
    }

    private function cancel(string $orderId, array $body = ['reason' => 'customer_request'], ?string $token = null)
    {
        return $this->withToken($token ?? $this->ownerToken)->postJson("/api/commerce/orders/{$orderId}/cancel", $body);
    }

    private function order(string $orderId): CommerceOrder
    {
        return CommerceOrder::query()->withoutGlobalScopes()->findOrFail($orderId);
    }

    /** @return list<string> */
    private function holds(string $orderId): array
    {
        return InventoryReservation::query()->withoutGlobalScopes()->where('source_id', $orderId)->pluck('status')->all();
    }

    private function attemptStatus(string $orderId): string
    {
        return (string) $this->attempts($orderId)->first()->capture_status;
    }

    /** لقطة كل ما يجب ألا يتغيّر عند الرفض. */
    private function world(string $orderId): array
    {
        return [
            'order' => DB::table('commerce_orders')->where('id', $orderId)->first(),
            'intent' => DB::table('commerce_payment_intents')->where('commerce_order_id', $orderId)->first(),
            'holds' => DB::table('inventory_reservations')->where('source_id', $orderId)->orderBy('id')->get()->toArray(),
            'attempts' => DB::table('payment_attempts')->orderBy('id')->get()->toArray(),
            'counts' => $this->counts(),
        ];
    }

    private function assertRefused($response, string $reason, int $status = 409): void
    {
        $response->assertStatus($status)->assertJsonPath('reason', $reason);
    }

    // ───────────────────────── البوابة ─────────────────────────

    #[Test]
    public function the_deployment_gate_is_closed_by_default_and_a_closed_gate_is_a_uniform_404(): void
    {
        $this->assertFalse((bool) (require base_path('config/commerce.php'))['order_cancellation_enabled'], 'closed unless explicitly enabled');
        config(['commerce.order_cancellation_enabled' => false]);
        $order = $this->cod();
        $before = $this->world($order->id);

        $this->cancel($order->id)->assertNotFound();
        $this->cancel($order->id, ['reason' => 'hacked'])->assertNotFound(); // لا تحقق قبل البوابة

        $this->assertEquals($before, $this->world($order->id));
    }

    // ───────────────────────── مصفوفة الحالات §3 ─────────────────────────

    #[Test]
    public function row_1_cod_awaiting_collection_is_cancelled_with_the_facts_and_the_staff_detail(): void
    {
        $order = $this->cod(number: 'CORD-ROW1');
        $counts = $this->counts();

        $res = $this->cancel($order->id, ['reason' => 'out_of_stock', 'note' => 'نفد من المخزن'])->assertOk();

        $res->assertJsonPath('data.lifecycle_status', 'cancelled')
            ->assertJsonPath('data.status', 'confirmed')
            ->assertJsonPath('data.cancellation.cancelled', true)
            ->assertJsonPath('data.cancellation.reason', 'out_of_stock')
            ->assertJsonPath('data.cancellation.note', 'نفد من المخزن')
            ->assertJsonPath('data.cancellation.by.name', 'owner')
            ->assertJsonPath('data.payment.status', 'cancelled');
        $fresh = $this->order($order->id);
        $this->assertNotNull($fresh->cancelled_at);
        $this->assertNotNull($fresh->cancelled_by_user_id);
        $this->assertSame('cancelled', DB::table('commerce_payment_intents')->where('commerce_order_id', $order->id)->value('status'));
        $this->assertEquals($counts, $this->counts(), 'no accounting/stock/reservation side effects');
    }

    #[Test]
    public function row_2_a_collected_cod_order_cannot_be_cancelled(): void
    {
        $order = $this->cod(CommercePaymentIntent::STATUS_COLLECTED);
        $before = $this->world($order->id);

        $this->assertRefused($this->cancel($order->id), 'payment_collected');

        $this->assertEquals($before, $this->world($order->id));
    }

    #[Test]
    public function row_3_an_online_order_with_no_attempt_is_cancelled_and_its_hold_is_released_atomically(): void
    {
        $order = $this->onlinePending();
        $this->assertSame([InventoryReservation::STATUS_ACTIVE], $this->holds($order['order_id']));
        $counts = $this->counts();

        $this->cancel($order['order_id'])->assertOk()->assertJsonPath('data.lifecycle_status', 'cancelled');

        $this->assertSame([InventoryReservation::STATUS_RELEASED], $this->holds($order['order_id']));
        $this->assertSame('cancelled', $this->intent($order['order_id'])->fresh()->status);
        $expected = $counts;
        $this->assertEquals($expected, $this->counts(), 'a hold is a promise: no StockMovement, no entry');
        $this->assertSame(0, DB::table('stock_movements')->count());
    }

    #[Test]
    public function row_4_a_live_attempt_is_closed_after_the_commit_and_the_order_stays_cancelled(): void
    {
        $order = $this->onlineLive();
        $this->assertSame('pending_customer', $this->attemptStatus($order['order_id']));

        $this->cancel($order['order_id'])->assertOk();

        $this->assertSame('cancelled', $this->attemptStatus($order['order_id']), 'cleanup ran after the commit');
        $this->assertSame([InventoryReservation::STATUS_RELEASED], $this->holds($order['order_id']));
        $this->assertNotNull($this->order($order['order_id'])->cancelled_at);
    }

    #[Test]
    public function row_5_an_authorized_attempt_blocks_the_cancellation(): void
    {
        $order = $this->onlineLive();
        DB::table('payment_attempts')->where('payable_key', $this->intent($order['order_id'])->payableKey())->update(['capture_status' => PaymentAttempt::STATUS_AUTHORIZED]);
        $before = $this->world($order['order_id']);

        $this->assertRefused($this->cancel($order['order_id']), 'payment_authorized');

        $this->assertEquals($before, $this->world($order['order_id']));
        $this->assertSame([InventoryReservation::STATUS_ACTIVE], $this->holds($order['order_id']));
    }

    #[Test]
    public function row_6_a_captured_attempt_blocks_the_cancellation_even_before_the_intent_is_settled(): void
    {
        $order = $this->onlineLive();
        $attempt = $this->attempts($order['order_id'])->first();
        $this->capture($attempt);
        app(PaymentOrchestrator::class)->sync($attempt);
        // الحالة المقصودة: التُقطت المحاولة ولم تُثبَّت النية بعد.
        DB::table('commerce_payment_intents')->where('commerce_order_id', $order['order_id'])->update(['status' => 'pending', 'paid_at' => null]);
        $before = $this->world($order['order_id']);

        $this->assertRefused($this->cancel($order['order_id']), 'payment_captured');

        $this->assertEquals($before, $this->world($order['order_id']));
    }

    #[Test]
    public function row_7_a_paid_online_order_cannot_be_cancelled_and_never_becomes_cancelled_and_paid(): void
    {
        $order = $this->onlineLive();
        $this->capture($this->attempts($order['order_id'])->first());
        $this->paymentStatus($order)->assertOk();
        $this->assertSame('paid', $this->intent($order['order_id'])->fresh()->status);
        $before = $this->world($order['order_id']);

        $this->assertRefused($this->cancel($order['order_id']), 'payment_paid');

        $this->assertEquals($before, $this->world($order['order_id']));
        $this->assertNull($this->order($order['order_id'])->cancelled_at);
    }

    #[Test]
    public function row_8_a_posted_order_cannot_be_cancelled_and_no_entry_is_created_or_reversed(): void
    {
        config(['payments.commerce_invoice_on_payment.enabled' => true, 'payments.commerce_invoice_on_payment.tax_opinion_ref' => 'EXT-05/TEST']);
        app(TenantContext::class)->set($this->tenant->id);
        Settings::put('sales', ['commerce_invoice_trigger' => 'on_payment_confirmed', 'commerce_price_tax_mode' => 'inclusive']);
        app(TenantContext::class)->forget();
        $order = $this->onlineLive();
        $this->capture($this->attempts($order['order_id'])->first());
        $this->paymentStatus($order)->assertOk();
        app(PaymentAttemptPostingService::class)->runPending();
        $this->assertSame(1, DB::table('commerce_order_postings')->where('commerce_order_id', $order['order_id'])->count());
        $before = $this->world($order['order_id']);

        $this->assertRefused($this->cancel($order['order_id']), 'already_posted');

        $this->assertEquals($before, $this->world($order['order_id']));
        $this->assertGreaterThan(0, DB::table('journal_entries')->count(), 'the posted entries are untouched');
    }

    #[Test]
    public function row_9_an_order_whose_intent_was_already_cancelled_is_closed_administratively(): void
    {
        $order = $this->onlinePending();
        // إلغاء النية بالمسار الداخلي القديم (كالمكنسة): الطلب يبقى مؤكَّداً بنية ملغاة.
        app(TenantContext::class)->set($this->tenant->id);
        app(\App\Services\Commerce\CommercePaymentIntentService::class)->cancel($this->intent($order['order_id']));
        app(TenantContext::class)->forget();
        $this->assertNull($this->order($order['order_id'])->cancelled_at);
        $this->assertSame([InventoryReservation::STATUS_RELEASED], $this->holds($order['order_id']));

        $this->cancel($order['order_id'], ['reason' => 'payment_issue'])->assertOk()->assertJsonPath('data.lifecycle_status', 'cancelled');

        $this->assertSame([InventoryReservation::STATUS_RELEASED], $this->holds($order['order_id']), 'releasing is idempotent: no second release');
    }

    #[Test]
    public function row_10_cancelling_twice_is_idempotent_and_keeps_the_original_facts(): void
    {
        $order = $this->onlineLive();
        $first = $this->cancel($order['order_id'], ['reason' => 'customer_request'])->assertOk();
        $at = $this->order($order['order_id'])->cancelled_at;
        $by = $this->order($order['order_id'])->cancelled_by_user_id;
        $other = $this->tokenFor($this->tenant, 'admin');
        $calls = count($this->fake->checkoutCalls);
        $world = $this->world($order['order_id']);
        $this->travel(5)->minutes();

        $second = $this->cancel($order['order_id'], ['reason' => 'fraud_suspected'], $other)->assertOk();

        $this->assertSame($first->json('data.cancellation'), $second->json('data.cancellation'), 'reason/actor/time are those of the first cancellation');
        $fresh = $this->order($order['order_id']);
        $this->assertEquals($at, $fresh->cancelled_at);
        $this->assertSame($by, $fresh->cancelled_by_user_id);
        $this->assertSame('customer_request', $fresh->cancellation_reason);
        $this->assertSame($calls, count($this->fake->checkoutCalls), 'no new provider contact');
        $this->assertEquals($world, $this->world($order['order_id']), 'no new effect at all');
    }

    #[Test]
    public function row_11_a_draft_order_is_rejected(): void
    {
        app(TenantContext::class)->set($this->tenant->id);
        $draft = CommerceOrder::create(['sales_channel_id' => $this->channel->id, 'number' => 'CORD-DRAFT-1', 'total' => 100]);
        app(TenantContext::class)->forget();

        $this->assertRefused($this->cancel($draft->id), 'not_confirmed', 422);

        $this->assertNull($this->order($draft->id)->cancelled_at);
    }

    #[Test]
    public function a_confirmed_order_without_any_payment_intent_can_be_cancelled(): void
    {
        $order = $this->cod();
        DB::table('commerce_payment_intents')->where('commerce_order_id', $order->id)->delete();

        $this->cancel($order->id)->assertOk()->assertJsonPath('data.lifecycle_status', 'cancelled');
    }

    // ───────────────────────── المدخلات ─────────────────────────

    #[Test]
    public function the_reason_is_required_from_the_approved_list_and_other_requires_a_note(): void
    {
        $order = $this->cod();
        foreach ([[], ['reason' => ''], ['reason' => 'because'], ['reason' => 'other'], ['reason' => 'other', 'note' => '   '],
            ['reason' => 'customer_request', 'note' => str_repeat('x', 501)]] as $bad) {
            $this->cancel($order->id, $bad)->assertStatus(422);
        }
        $this->assertNull($this->order($order->id)->cancelled_at);

        $this->cancel($order->id, ['reason' => 'other', 'note' => 'سبب خاص'])->assertOk()
            ->assertJsonPath('data.cancellation.reason', 'other')->assertJsonPath('data.cancellation.note', 'سبب خاص');
    }

    #[Test]
    public function every_approved_reason_is_accepted_and_the_adr_reason_code_name_is_an_alias(): void
    {
        foreach (['customer_request', 'out_of_stock', 'payment_issue', 'duplicate_order', 'fraud_suspected'] as $reason) {
            $order = $this->cod();
            $this->cancel($order->id, ['reason' => $reason])->assertOk()->assertJsonPath('data.cancellation.reason', $reason);
        }
        $aliased = $this->cod();
        $this->cancel($aliased->id, ['reason_code' => 'duplicate_order'])->assertOk()->assertJsonPath('data.cancellation.reason', 'duplicate_order');
    }

    // ───────────────────────── RBAC / IDOR / العزل ─────────────────────────

    #[Test]
    public function only_an_explicitly_authorized_staff_member_can_cancel(): void
    {
        $order = $this->cod();
        app(TenantContext::class)->set($this->tenant->id);
        Role::create(['slug' => 'canceller', 'name' => 'يلغي', 'permissions' => ['commerce.orders.cancel'], 'is_system' => false]);
        Role::create(['slug' => 'viewer_pm', 'name' => 'عرض ودفع', 'permissions' => ['commerce.orders.view', 'payments.manage', 'commerce.manage'], 'is_system' => false]);
        app(TenantContext::class)->forget();

        foreach (['accountant', 'staff', 'self_service', 'viewer_pm'] as $role) {
            $this->cancel($order->id, ['reason' => 'customer_request'], $this->tokenFor($this->tenant, $role))->assertForbidden();
        }
        $this->assertNull($this->order($order->id)->cancelled_at);

        $this->cancel($order->id, ['reason' => 'customer_request'], $this->tokenFor($this->tenant, 'canceller'))->assertOk();
        $second = $this->cod();
        $this->cancel($second->id, ['reason' => 'customer_request'], $this->tokenFor($this->tenant, 'admin'))->assertOk();
        $this->flushHeaders()->postJson("/api/commerce/orders/{$second->id}/cancel", ['reason' => 'customer_request'])->assertUnauthorized();
    }

    #[Test]
    public function the_permission_is_not_granted_implicitly_to_any_builtin_role_except_owner_and_admin(): void
    {
        $this->assertContains('commerce.orders.cancel', \App\Support\Rbac::PERMISSIONS);
        foreach (['accountant', 'staff', 'self_service'] as $role) {
            $this->assertNotContains('commerce.orders.cancel', \App\Support\Rbac::MATRIX[$role] ?? []);
        }
    }

    #[Test]
    public function another_tenants_user_cannot_cancel_and_the_id_cannot_be_guessed(): void
    {
        $order = $this->cod();
        ['tenant' => $other] = $this->makeStore('other-cancel.test', 'other-cancel');
        $this->enableApplications($other);
        $foreign = $this->tokenFor($other, 'owner');
        $before = $this->world($order->id);

        $foreignAttempt = $this->cancel($order->id, ['reason' => 'customer_request'], $foreign);
        $missing = $this->cancel((string) Str::uuid(), ['reason' => 'customer_request'], $foreign);

        $foreignAttempt->assertNotFound();
        $missing->assertNotFound();
        $this->assertSame($missing->json('message'), $foreignAttempt->json('message'), 'a foreign id is indistinguishable from a missing one');
        $this->assertEquals($before, $this->world($order->id));
    }

    #[Test]
    public function a_warehouse_restricted_user_is_rejected_even_when_owner_or_admin(): void
    {
        $order = $this->cod();
        $token = $this->tokenFor($this->tenant, 'admin', 'restricted-cancel@cancel.test');
        app(TenantContext::class)->set($this->tenant->id);
        User::where('email', 'restricted-cancel@cancel.test')->firstOrFail()->warehouses()->attach($this->warehouse->id);
        app(TenantContext::class)->forget();

        $this->cancel($order->id, ['reason' => 'customer_request'], $token)->assertForbidden();

        $this->assertNull($this->order($order->id)->cancelled_at);
    }

    #[Test]
    public function a_disabled_commerce_capability_blocks_the_cancellation(): void
    {
        $order = $this->cod();
        app(TenantContext::class)->set($this->tenant->id);
        app(TenantApplicationService::class)->disable('commerce.storefront', User::query()->first());
        app(TenantContext::class)->forget();

        $this->cancel($order->id)->assertForbidden();
        $this->assertNull($this->order($order->id)->cancelled_at);
    }

    // ───────────────────────── المعاملة: ذرّية وتراجع وتنظيف بعد الالتزام ─────────────────────────

    #[Test]
    public function a_failure_after_the_intent_transition_rolls_everything_back_and_never_contacts_the_provider(): void
    {
        $order = $this->onlineLive();
        $before = $this->world($order['order_id']);
        $calls = count($this->fake->checkoutCalls);
        // يفشل عند كتابة حقائق الإلغاء — بعد انتقال النية وتحرير الحجز داخل المعاملة نفسها.
        Event::listen('eloquent.updating: '.CommerceOrder::class, function (CommerceOrder $order): void {
            if ($order->isDirty('cancelled_at')) {
                throw new RuntimeException('injected failure after the intent transition');
            }
        });

        $thrown = null;
        try {
            $this->withoutExceptionHandling();
            $this->cancel($order['order_id']);
        } catch (RuntimeException $e) {
            $thrown = $e;
        }

        $this->assertNotNull($thrown, 'the injected failure surfaced');
        $this->assertEquals($before, $this->world($order['order_id']), 'intent, hold and order are exactly as before');
        $this->assertSame('pending_customer', $this->attemptStatus($order['order_id']), 'the live attempt was not touched');
        $this->assertSame($calls, count($this->fake->checkoutCalls), 'the provider was never contacted');
    }

    #[Test]
    public function the_provider_is_not_contacted_while_an_outer_transaction_is_open_and_not_at_all_when_it_rolls_back(): void
    {
        $order = $this->onlineLive();
        $this->actingAsTenant();
        $actor = User::query()->first();
        $model = CommerceOrder::query()->findOrFail($order['order_id']);

        // 1) تعشيش ناجح: لا تنظيف قبل الالتزام النهائي، وبعده يجري.
        $inside = null;
        DB::transaction(function () use ($model, $actor, $order, &$inside): void {
            app(CommerceOrderLifecycleService::class)->cancel($model, $actor, 'customer_request', null);
            $inside = $this->attemptStatus($order['order_id']);
        });
        $this->assertSame('pending_customer', $inside, 'no cleanup while the outer transaction is open');
        $this->assertSame('cancelled', $this->attemptStatus($order['order_id']), 'cleanup ran after the final commit');

        // 2) تعشيش يتراجع: لا تنظيف إطلاقاً ولا تغيير.
        $second = $this->onlineLive('idem-can-rb');
        $this->actingAsTenant();
        $model2 = CommerceOrder::query()->findOrFail($second['order_id']);
        $before = $this->world($second['order_id']);
        try {
            DB::transaction(function () use ($model2, $actor): void {
                app(CommerceOrderLifecycleService::class)->cancel($model2, $actor, 'customer_request', null);
                throw new RuntimeException('outer rollback');
            });
        } catch (RuntimeException) {
        }
        $this->assertEquals($before, $this->world($second['order_id']));
        $this->assertSame('pending_customer', $this->attemptStatus($second['order_id']));
    }

    #[Test]
    public function a_provider_failure_after_the_commit_leaves_a_consistent_cancelled_order_and_the_reconciler_finishes_it(): void
    {
        $order = $this->onlinePending('idem-can-prov');
        $this->fake->failNextCheckouts();
        $this->startPayment($order)->assertStatus(503);
        $this->assertSame('created', $this->attemptStatus($order['order_id']));
        $this->fake->failNextCheckouts(); // المزوّد ما زال معطلاً عند التنظيف

        $this->cancel($order['order_id'])->assertOk()->assertJsonPath('data.lifecycle_status', 'cancelled');

        $this->assertSame('created', $this->attemptStatus($order['order_id']), 'cleanup failed — the attempt stays active');
        $this->assertSame([InventoryReservation::STATUS_RELEASED], $this->holds($order['order_id']));
        $this->assertSame('cancelled', $this->intent($order['order_id'])->fresh()->status);

        DB::table('commerce_payment_intents')->where('commerce_order_id', $order['order_id'])->update(['cancelled_at' => now('UTC')->subMinutes(10)]);
        $summary = app(OrderCancellationCleanup::class)->runPending();
        $this->assertSame(1, $summary['cleaned']);
        $this->assertSame('cancelled', $this->attemptStatus($order['order_id']));
        $this->assertSame(0, app(OrderCancellationCleanup::class)->runPending()['processed'], 'idempotent');
    }

    #[Test]
    public function a_capture_arriving_after_the_cancellation_is_a_late_capture_and_never_makes_the_order_paid(): void
    {
        $order = $this->onlineLive();
        $this->cancel($order['order_id'])->assertOk();
        // الفجوة: صفحة المزوّد بقيت حيّة (لم يُغلق التنظيف المحاولة) ثم وصل التقاط.
        $attempt = $this->attempts($order['order_id'])->first();
        DB::table('payment_attempts')->where('id', $attempt->id)->update(['capture_status' => PaymentAttempt::STATUS_PENDING_CUSTOMER]);
        $this->capture($attempt->fresh());
        app(PaymentOrchestrator::class)->sync($attempt->fresh());
        app(TenantContext::class)->set($this->tenant->id);

        app(CommerceOnlinePaymentService::class)->completeCaptured(PaymentAttempt::query()->findOrFail($attempt->id));

        $reasons = json_decode((string) DB::table('payment_attempts')->where('id', $attempt->id)->value('review_reasons'), true) ?: [];
        $this->assertContains(PaymentAttempt::REVIEW_LATE_CAPTURE, $reasons);
        $this->assertSame('cancelled', $this->intent($order['order_id'])->fresh()->status, 'the intent is not revived');
        $this->assertNotNull($this->order($order['order_id'])->cancelled_at);
        $this->assertSame([InventoryReservation::STATUS_RELEASED], $this->holds($order['order_id']), 'the hold is not revived');
    }

    // ───────────────────────── لا أثر محاسبي أو مخزني ─────────────────────────

    #[Test]
    public function cancellation_creates_no_entry_invoice_payment_credit_note_or_stock_movement(): void
    {
        $order = $this->onlinePending('idem-can-acc');
        $snapshot = fn () => [
            $this->counts(),
            DB::table('credit_notes')->count(),
            DB::table('invoices')->get()->toJson(),
            DB::table('payments')->get()->toJson(),
            DB::table('journal_lines')->count(),
        ];
        $before = $snapshot();

        $this->cancel($order['order_id'])->assertOk();

        $this->assertEquals($before, $snapshot());
    }

    #[Test]
    public function the_cancelled_order_record_and_its_lines_are_preserved_and_cannot_be_deleted(): void
    {
        $order = $this->cod();
        $this->cancel($order->id)->assertOk();

        $this->assertSame(1, DB::table('commerce_order_lines')->where('commerce_order_id', $order->id)->count());
        $this->assertSame(1, DB::table('commerce_order_snapshots')->where('commerce_order_id', $order->id)->count());
        $this->expectException(\LogicException::class);
        app(TenantContext::class)->set($this->tenant->id);
        CommerceOrder::query()->findOrFail($order->id)->delete();
    }

    // ───────────────────────── مسار إلغاء النية القديم ─────────────────────────

    #[Test]
    public function with_the_gate_closed_the_legacy_intent_cancel_route_is_unchanged(): void
    {
        config(['commerce.order_cancellation_enabled' => false]);
        $order = $this->cod();
        $intent = $this->intent($order->id);

        $this->withToken($this->ownerToken)->postJson("/api/commerce/payment-intents/{$intent->id}/cancel")
            ->assertOk()->assertJsonPath('data.status', 'cancelled');

        $this->assertNull($this->order($order->id)->cancelled_at, 'the legacy behavior is preserved verbatim while the gate is closed');
    }

    #[Test]
    public function with_the_gate_open_the_legacy_route_delegates_and_needs_both_permissions(): void
    {
        $order = $this->onlineLive('idem-can-del');
        $intent = $this->intent($order['order_id']);
        app(TenantContext::class)->set($this->tenant->id);
        Role::create(['slug' => 'payer', 'name' => 'مدفوعات', 'permissions' => ['payments.manage'], 'is_system' => false]);
        Role::create(['slug' => 'payer_canceller', 'name' => 'مدفوعات وإلغاء', 'permissions' => ['payments.manage', 'commerce.orders.cancel'], 'is_system' => false]);
        app(TenantContext::class)->forget();
        $url = "/api/commerce/payment-intents/{$intent->id}/cancel";
        $before = $this->world($order['order_id']);

        // payments.manage وحدها لا تكفي؛ ولا يتغيّر شيء.
        $this->withToken($this->tokenFor($this->tenant, 'payer'))->postJson($url, ['reason' => 'customer_request'])->assertForbidden();
        $this->assertEquals($before, $this->world($order['order_id']));
        // جسم بلا سبب ⇒ 422.
        $this->withToken($this->tokenFor($this->tenant, 'payer_canceller'))->postJson($url, [])->assertStatus(422);
        $this->assertEquals($before, $this->world($order['order_id']));

        // الصلاحيتان + سبب ⇒ تفويض إلى خدمة الإلغاء: الطلب نفسه يُلغى (لا «طلب مؤكَّد بنية ملغاة»).
        $this->withToken($this->tokenFor($this->tenant, 'payer_canceller'))->postJson($url, ['reason' => 'customer_request'])
            ->assertOk()->assertJsonPath('data.status', 'cancelled');
        $this->assertNotNull($this->order($order['order_id'])->cancelled_at);
        $this->assertSame([InventoryReservation::STATUS_RELEASED], $this->holds($order['order_id']));
        $this->assertSame('cancelled', $this->attemptStatus($order['order_id']));
    }

    #[Test]
    public function the_delegated_legacy_route_enforces_the_same_capability_guard_as_the_dedicated_route(): void
    {
        $order = $this->cod();
        $intent = $this->intent($order->id);
        app(TenantContext::class)->set($this->tenant->id);
        app(TenantApplicationService::class)->disable('commerce.storefront', User::query()->first());
        app(TenantContext::class)->forget();
        $before = $this->world($order->id);
        $url = "/api/commerce/payment-intents/{$intent->id}/cancel";

        // البوابة مفتوحة: كلا المدخلين يرفضان 403 والقدرة معطّلة، بلا أي تغيير (Codex P2).
        $this->cancel($order->id)->assertForbidden();
        $this->withToken($this->ownerToken)->postJson($url, ['reason' => 'customer_request'])->assertForbidden();
        $this->assertEquals($before, $this->world($order->id));

        // البوابة مغلقة: السلوك القديم لا يتغيّر (لا حارس قدرة جديداً على المسار القديم).
        config(['commerce.order_cancellation_enabled' => false]);
        $this->withToken($this->ownerToken)->postJson($url)->assertOk()->assertJsonPath('data.status', 'cancelled');
        $this->assertNull($this->order($order->id)->cancelled_at);
    }

    #[Test]
    public function the_delegated_legacy_route_keeps_the_matrix_refusals(): void
    {
        $order = $this->cod(CommercePaymentIntent::STATUS_COLLECTED);
        $intent = $this->intent($order->id);

        $this->withToken($this->ownerToken)->postJson("/api/commerce/payment-intents/{$intent->id}/cancel", ['reason' => 'customer_request'])
            ->assertStatus(409)->assertJsonPath('reason', 'payment_collected');
    }

    #[Test]
    public function the_legacy_routes_for_collection_and_listing_are_untouched(): void
    {
        $order = $this->cod();
        $intent = $this->intent($order->id);

        $this->withToken($this->ownerToken)->getJson('/api/commerce/payment-intents')->assertOk();
        $this->withToken($this->ownerToken)->postJson("/api/commerce/payment-intents/{$intent->id}/collect", [])->assertOk()->assertJsonPath('data.status', 'collected');
    }

    // ───────────────────────── حراسة ساكنة (P-6 وعقد Commerce #6) ─────────────────────────

    #[Test]
    public function the_lifecycle_service_never_uses_the_public_cancel_provider_calls_or_accounting_services(): void
    {
        $src = file_get_contents(app_path('Services/Commerce/CommerceOrderLifecycleService.php'));
        $code = preg_replace('#/\*.*?\*/#s', '', $src); // التعليقات التوثيقية خارج الحكم
        foreach (['LedgerService', 'InvoiceService', 'InventoryService', 'InventoryReservationService', 'PaymentOrchestrator', 'closeActiveAttempts',
            '->cancel(', 'markCollected', 'DB::table', 'lockForUpdate()->find'] as $forbidden) {
            $this->assertStringNotContainsString($forbidden, $code, "the lifecycle service must not use {$forbidden}");
        }
        $this->assertDoesNotMatchRegularExpression('/(?<![A-Za-z])PaymentService/', $code, 'no cash-payment posting');
        $this->assertStringContainsString('cancelWithinTransaction', $code);
        $this->assertStringContainsString('afterCommit', $code);
        // لا يُستدعى `cancel()` العام للنية إلا من المتحكّم القديم/المكنسة.
        $callers = [];
        foreach (new \RecursiveIteratorIterator(new \RecursiveDirectoryIterator(app_path())) as $file) {
            if ($file->getExtension() === 'php' && str_contains((string) file_get_contents($file->getPathname()), 'CommercePaymentIntentService') && str_contains((string) file_get_contents($file->getPathname()), '->cancel(')) {
                $callers[] = str_replace(app_path().'/', '', $file->getPathname());
            }
        }
        sort($callers);
        $this->assertNotContains('Services/Commerce/CommerceOrderLifecycleService.php', $callers);
    }

    private function actingAsTenant(): void
    {
        app(TenantContext::class)->set($this->tenant->id);
    }
}
