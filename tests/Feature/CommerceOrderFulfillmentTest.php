<?php

namespace Tests\Feature;

use App\Events\CommerceOrderFulfillmentDispatched;
use App\Models\CommerceOrder;
use App\Models\CommerceOrderFulfillment;
use App\Models\CommerceOrderLine;
use App\Models\CommercePaymentIntent;
use App\Models\InventoryReservation;
use App\Models\Product;
use App\Models\Role;
use App\Models\Tenant;
use App\Models\User;
use App\Models\Warehouse;
use App\Services\Accounting\ChartOfAccountsSeeder;
use App\Services\Commerce\CommerceOrderFulfillmentLockedException;
use App\Services\Commerce\CommerceOrderFulfillmentService;
use App\Services\Commerce\CommerceOrderLifecycleService;
use App\Services\Commerce\CommercePaymentIntentService;
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
 *  COPS-H2-1 (ADR-29 §2.3 · خطة H2-0 §4.1) — نواة تنفيذ طلب المتجر
 * ═══════════════════════════════════════════════════════════════
 *  البوابة (مغلقة افتراضياً) · آلة الحالة والأضلاع · الأهلية (دفع/قبول/نية) · idempotency والنسخة (428/409/200) · الإلغاء (الصف 14) وكل مسارات
 *  إلغاء النية القديمة (AR-2) · فشل التوصيل وتعذّر الرجوع بلا آلية جديدة (AR-1) · إغلاق البوابة لا يُخفي الحقائق (AR-3) · حراس القاعدة ·
 *  RBAC/العزل · لا أثر مالي/مخزني/حجز · أحداث بلا بيانات حساسة. التزامن على PostgreSQL الحقيقي في `CommerceOrderFulfillmentPostgresTest`.
 */
class CommerceOrderFulfillmentTest extends TestCase
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
        $this->warehouse = Warehouse::create(['name' => 'مخزن المتجر', 'code' => 'FUL-W1', 'is_default' => true]);
        app(FulfillmentPolicyService::class)->setFixedWarehouse($this->channel->id, $this->warehouse->id);
        $this->enableApplications($this->tenant);
        app(TenantContext::class)->forget();

        $this->ownerToken = $this->tokenFor($this->tenant, 'owner');
        config(['commerce.order_fulfillment_enabled' => true, 'commerce.order_acceptance_enabled' => true, 'commerce.order_cancellation_enabled' => true]);
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
            'tenant_id' => $tenant->id, 'name' => $role, 'email' => $email ?? $role.'-'.Str::random(6).'@fulfil.test',
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

    /** طلب مؤكَّد بنية بحالة معطاة (COD/استلام افتراضياً)، لقطة قبول معطاة، بطريقة تسليم معطاة، مع حجز فعّال اختياري. */
    private function order(string $intentStatus = CommercePaymentIntent::STATUS_AWAITING_COLLECTION, ?string $mode = null, string $delivery = 'standard',
        string $method = CommercePaymentIntent::METHOD_COD, bool $hold = false): CommerceOrder
    {
        app(TenantContext::class)->set($this->tenant->id);
        $order = new CommerceOrder(['sales_channel_id' => $this->channel->id, 'storefront_id' => $this->storefront->id, 'number' => 'CORD-F'.Str::upper(Str::random(6)), 'delivery_method' => $delivery, 'total' => 11500]);
        if ($mode !== null) {
            $order->forceFill(['acceptance_mode' => $mode]);
        }
        $order->save();
        CommerceOrderLine::create(['commerce_order_id' => $order->id, 'product_name_snapshot' => 'وردة', 'quantity' => 2, 'unit_price' => 5000, 'line_total' => 10000]);
        $order->snapshot()->create(['customer_name' => 'سارة', 'phone' => '0500000001', 'email' => 'b@example.test', 'shipping_city' => 'الدمام']);
        $order->update(['status' => CommerceOrder::STATUS_CONFIRMED, 'confirmed_at' => now()]);
        CommercePaymentIntent::create(['commerce_order_id' => $order->id, 'method' => $method, 'status' => $intentStatus, 'amount_minor' => 11500, 'currency' => 'SAR']);
        if ($hold) {
            $product = Product::create(['name' => 'منتج', 'sku' => 'FU-'.Str::random(6), 'unit' => 'piece', 'sale_price' => 5000, 'is_active' => true, 'track_inventory' => true]);
            InventoryReservation::create([
                'warehouse_id' => $this->warehouse->id, 'product_id' => $product->id, 'base_quantity' => 1, 'status' => InventoryReservation::STATUS_ACTIVE,
                'source_type' => CommerceOrder::class, 'source_id' => $order->id, 'idempotency_key' => 'hold-'.Str::random(10), 'request_checksum' => Str::random(16),
                'expires_at' => now('UTC')->addHour(),
            ]);
        }
        app(TenantContext::class)->forget();

        return $order->fresh();
    }

    private function act(string $orderId, string $action, array $body = [], ?string $token = null)
    {
        return $this->withToken($token ?? $this->ownerToken)->postJson("/api/commerce/orders/{$orderId}/fulfillment/{$action}", $body);
    }

    private function patchDetails(string $orderId, array $body, ?string $token = null)
    {
        return $this->withToken($token ?? $this->ownerToken)->patchJson("/api/commerce/orders/{$orderId}/fulfillment", $body);
    }

    private function detail(string $orderId, ?string $token = null)
    {
        return $this->withToken($token ?? $this->ownerToken)->getJson("/api/commerce/orders/{$orderId}");
    }

    private function row(string $orderId): ?object
    {
        return DB::table('commerce_order_fulfillments')->where('commerce_order_id', $orderId)->first();
    }

    private function version(string $orderId): int
    {
        return (int) ($this->row($orderId)?->version ?? 0);
    }

    /** ينفّذ إجراءً بنسخته الحالية ويتوقع نجاحه. */
    private function go(string $orderId, string $action, array $body = [])
    {
        return $this->act($orderId, $action, $body + ['expected_version' => $this->version($orderId)])->assertOk();
    }

    /** يدفع الطلب إلى حالة هدف بمسار قانوني. */
    private function drive(string $orderId, string $to): void
    {
        $paths = [
            'preparing' => ['start'],
            'ready' => ['start', 'mark_ready'],
            'out_for_delivery' => ['start', 'mark_ready', ['dispatch', ['carrier_name' => 'ناقل']]],
            'delivery_failed' => ['start', 'mark_ready', ['dispatch', ['carrier_name' => 'ناقل']], ['fail', ['reason' => 'address_issue']]],
            'returned_to_store' => ['start', 'mark_ready', ['dispatch', ['carrier_name' => 'ناقل']], ['fail', ['reason' => 'address_issue']], 'return'],
            'delivered' => ['start', 'mark_ready', ['dispatch', ['carrier_name' => 'ناقل']], 'deliver'],
            'picked_up' => ['start', 'mark_ready', 'pickup'],
        ];
        foreach ($paths[$to] as $step) {
            [$action, $body] = is_array($step) ? $step : [$step, []];
            $this->go($orderId, $action, $body);
        }
    }

    /** @return list<string> */
    private function eventTypes(string $orderId): array
    {
        return DB::table('commerce_order_events')->where('commerce_order_id', $orderId)->orderBy('feed_seq')->pluck('type')->all();
    }

    /** @return array<string, int> */
    private function counts(): array
    {
        $out = [];
        foreach (['journal_entries', 'journal_lines', 'stock_movements', 'invoices', 'payments', 'inventory_reservations', 'commerce_order_postings'] as $table) {
            $out[$table] = DB::table($table)->count();
        }

        return $out;
    }

    private function assertRefused($response, string $reason, int $status = 409): void
    {
        $response->assertStatus($status)->assertJsonPath('reason', $reason);
    }

    private function assertGuard(callable $operation, string $why): void
    {
        $e = $this->thrown(fn () => DB::transaction($operation), $why, QueryException::class);
        $this->assertStringContainsString('commerce_order', $e->getMessage(), $why);
    }

    private function userId(): string
    {
        app(TenantContext::class)->set($this->tenant->id);

        return User::create(['tenant_id' => $this->tenant->id, 'name' => 'فاعل', 'email' => 'actor-'.Str::random(6).'@fulfil.test', 'password' => 'password123', 'role' => 'admin'])->id;
    }

    // ═════════════════════════ 1) البوابة (AR-3) والتوافق ═════════════════════════

    #[Test]
    public function the_fulfillment_gate_is_closed_by_default_and_nothing_references_an_env_value(): void
    {
        $config = require base_path('config/commerce.php');
        $this->assertFalse($config['order_fulfillment_enabled'], 'الافتراضي مغلق دون أي env');
        foreach (['.env.example', '.github/workflows/ci.yml'] as $file) {
            $path = base_path($file);
            if (is_file($path)) {
                $this->assertStringNotContainsString('COMMERCE_ORDER_FULFILLMENT_ENABLED=true', (string) file_get_contents($path), "$file لا يفتح البوابة");
            }
        }
    }

    #[Test]
    public function with_the_gate_closed_writes_are_not_found_and_responses_have_no_fulfillment_keys(): void
    {
        $order = $this->order();
        config(['commerce.order_fulfillment_enabled' => false]);
        $before = [$this->counts(), DB::table('commerce_order_events')->count(), DB::table('commerce_order_fulfillments')->count()];

        $this->act($order->id, 'start', ['expected_version' => 0])->assertNotFound();
        $this->patchDetails($order->id, ['expected_version' => 1, 'carrier_name' => 'x'])->assertNotFound();

        $detail = $this->detail($order->id)->assertOk()->json('data');
        $this->assertArrayNotHasKey('fulfillment', $detail, 'لا صف ⇒ لا مفتاح (التوافق الحرفي)');
        $this->assertArrayNotHasKey('fulfillment_actions', $detail);
        $list = $this->withToken($this->ownerToken)->getJson('/api/commerce/orders')->assertOk()->json('data.0');
        $this->assertArrayNotHasKey('fulfillment', $list);
        $this->assertSame('accepted', $list['operational_status']);
        $this->assertSame($before, [$this->counts(), DB::table('commerce_order_events')->count(), DB::table('commerce_order_fulfillments')->count()]);
    }

    #[Test]
    public function closing_the_gate_after_activity_never_hides_stored_facts_and_keeps_the_cancellation_interlock(): void
    {
        $order = $this->order();
        $this->drive($order->id, 'out_for_delivery');
        $this->assertContains('fulfillment_actions', array_keys($this->detail($order->id)->json('data')), 'البوابة مفتوحة ⇒ العقد حاضر');

        config(['commerce.order_fulfillment_enabled' => false]);

        $detail = $this->detail($order->id)->assertOk()->json('data');
        $this->assertSame('out_for_delivery', $detail['fulfillment']['status'], 'الحقيقة المخزَّنة تُقرأ دائماً');
        $this->assertSame('out_for_delivery', $detail['operational_status']);
        $this->assertArrayNotHasKey('fulfillment_actions', $detail, 'الإجراءات تتبع البوابة');
        $list = $this->withToken($this->ownerToken)->getJson('/api/commerce/orders?fulfillment_status=out_for_delivery')->assertOk();
        $this->assertSame([$order->id], array_column($list->json('data'), 'id'));
        $this->assertSame('out_for_delivery', $list->json('data.0.fulfillment.status'));
        $this->assertSame('fulfillment.dispatched', collect($detail['timeline'])->pluck('type')->last());

        $this->act($order->id, 'deliver', ['expected_version' => $this->version($order->id)])->assertNotFound();
        $this->assertSame('out_for_delivery', $this->row($order->id)->status);

        // قيد الإلغاء لا يتبع البوابة: (البوابتان القديمتان مفتوحتان هنا) ⇒ مرفوض من كل المسارات.
        $this->withToken($this->ownerToken)->postJson("/api/commerce/orders/{$order->id}/cancel", ['reason' => 'customer_request'])
            ->assertStatus(409)->assertJsonPath('reason', 'fulfillment_in_transit');
        config(['commerce.order_cancellation_enabled' => false]);
        $this->withToken($this->ownerToken)->postJson('/api/commerce/payment-intents/'.$order->paymentIntent()->value('id').'/cancel')
            ->assertStatus(422)->assertJsonPath('reason', 'fulfillment_in_transit');
        $this->assertSame('awaiting_collection', DB::table('commerce_payment_intents')->where('commerce_order_id', $order->id)->value('status'));
        $this->assertNull(DB::table('commerce_orders')->where('id', $order->id)->value('cancelled_at'));
    }

    // ═════════════════════════ 2) آلة الحالة والأضلاع ═════════════════════════

    #[Test]
    public function a_local_delivery_runs_the_whole_lifecycle_with_versions_stamps_and_events(): void
    {
        $order = $this->order();
        $this->assertSame(0, $this->version($order->id));

        $d = $this->go($order->id, 'start')->json('data');
        $this->assertSame(['preparing', 'local_delivery', 1], [$d['fulfillment']['status'], $d['fulfillment']['type'], $d['fulfillment']['version']]);
        $this->assertSame($this->warehouse->id, $d['fulfillment']['warehouse']['id']);
        $this->go($order->id, 'mark_ready');
        $d = $this->go($order->id, 'dispatch', ['carrier_name' => 'ساعٍ محلي'])->json('data');
        $this->assertSame('out_for_delivery', $d['operational_status']);
        $this->assertNotNull($d['fulfillment']['timestamps']['first_dispatched_at']);
        $d = $this->go($order->id, 'deliver')->json('data');

        $this->assertSame(['delivered', 4], [$d['fulfillment']['status'], $d['fulfillment']['version']]);
        $this->assertSame([], $d['fulfillment_actions'], 'مكتمل ⇒ لا إجراءات');
        $this->assertSame(
            ['fulfillment.started', 'fulfillment.ready', 'fulfillment.dispatched', 'fulfillment.delivered'],
            $this->eventTypes($order->id),
        );
        $this->assertSame(['fulfillment.started', 'fulfillment.ready', 'fulfillment.dispatched', 'fulfillment.delivered'], collect($d['timeline'])->pluck('type')->all());
    }

    #[Test]
    public function a_pickup_order_goes_ready_to_picked_up_and_cannot_be_dispatched(): void
    {
        $order = $this->order(delivery: 'pickup', method: CommercePaymentIntent::METHOD_PAY_ON_PICKUP);
        $this->go($order->id, 'mark_ready', []);
        $this->assertSame(['ready', 'pickup'], [$this->row($order->id)->status, $this->row($order->id)->type]);
        $this->assertRefused($this->act($order->id, 'dispatch', ['expected_version' => 1, 'carrier_name' => 'x']), 'invalid_transition');
        $this->go($order->id, 'pickup');
        $this->assertSame('picked_up', $this->row($order->id)->status);
        $this->assertSame(['fulfillment.ready', 'fulfillment.picked_up'], $this->eventTypes($order->id));

        $delivery = $this->order();
        $this->drive($delivery->id, 'ready');
        $this->assertRefused($this->act($delivery->id, 'pickup', ['expected_version' => 2]), 'invalid_transition');
    }

    #[Test]
    public function every_edge_is_either_allowed_or_refused_with_a_stable_reason(): void
    {
        $actions = array_keys(CommerceOrderFulfillmentService::TARGETS);
        $allowed = [
            'none' => ['start', 'mark_ready'], 'preparing' => ['mark_ready'], 'ready' => ['dispatch', 'pickup'],
            'out_for_delivery' => ['deliver', 'fail'], 'delivery_failed' => ['dispatch', 'return'], 'returned_to_store' => ['dispatch'],
            'delivered' => [], 'picked_up' => [],
        ];
        foreach ($allowed as $state => $ok) {
            foreach ($actions as $action) {
                $order = $this->order(delivery: $state === 'picked_up' || ($state === 'ready' && $action === 'pickup') ? 'pickup' : 'standard',
                    method: $state === 'picked_up' || ($state === 'ready' && $action === 'pickup') ? CommercePaymentIntent::METHOD_PAY_ON_PICKUP : CommercePaymentIntent::METHOD_COD);
                if ($state !== 'none') {
                    $this->drive($order->id, $state);
                }
                $body = ['expected_version' => $this->version($order->id)] + match ($action) {
                    'fail' => ['reason' => 'address_issue'],
                    'dispatch' => ['carrier_name' => 'ناقل'],
                    default => [],
                };
                $response = $this->act($order->id, $action, $body);
                // الهدف المتحقق أصلاً ⇒ 200 idempotent (مثلاً mark_ready على ready، fail على delivery_failed).
                $idempotent = (CommerceOrderFulfillmentService::TARGETS[$action] ?? null) === $state;
                if (in_array($action, $ok, true) || $idempotent) {
                    $response->assertOk();
                } else {
                    $this->assertContains($response->status(), [409], "$state × $action");
                    $this->assertContains($response->json('reason'), ['invalid_transition', 'fulfillment_completed'], "$state × $action");
                }
            }
        }
    }

    // ═════════════════════════ 3) الأهلية (R-5، القبول، النية) ═════════════════════════

    #[Test]
    public function starting_requires_a_ready_payment_an_existing_uncancelled_intent_and_effective_acceptance(): void
    {
        $pending = $this->order(CommercePaymentIntent::STATUS_PENDING, null, 'standard', CommercePaymentIntent::METHOD_ONLINE);
        $this->assertRefused($this->act($pending->id, 'start', ['expected_version' => 0]), 'payment_pending');

        $paid = $this->order(CommercePaymentIntent::STATUS_PAID, null, 'standard', CommercePaymentIntent::METHOD_ONLINE);
        $this->act($paid->id, 'start', ['expected_version' => 0])->assertOk();

        $cancelledIntent = $this->order(CommercePaymentIntent::STATUS_CANCELLED);
        $this->assertRefused($this->act($cancelledIntent->id, 'start', ['expected_version' => 0]), 'payment_cancelled');

        app(TenantContext::class)->set($this->tenant->id);
        $noIntent = $this->order();
        DB::table('commerce_payment_intents')->where('commerce_order_id', $noIntent->id)->delete();
        $this->assertRefused($this->act($noIntent->id, 'start', ['expected_version' => 0]), 'payment_not_ready');

        $manual = $this->order(mode: CommerceOrder::ACCEPTANCE_MANUAL);
        $this->assertRefused($this->act($manual->id, 'start', ['expected_version' => 0]), 'awaiting_acceptance');
        $this->withToken($this->ownerToken)->postJson("/api/commerce/orders/{$manual->id}/accept")->assertOk();
        $this->act($manual->id, 'start', ['expected_version' => 0])->assertOk();

        // البوابة مغلقة ⇒ الوضع الفعّال تلقائي: لا انتظار قبول (التوافق).
        config(['commerce.order_acceptance_enabled' => false]);
        $this->act($this->order(mode: CommerceOrder::ACCEPTANCE_MANUAL)->id, 'start', ['expected_version' => 0])->assertOk();

        foreach ([$pending, $cancelledIntent, $noIntent] as $o) {
            $this->assertNull($this->row($o->id), 'لا صف عند الرفض');
        }
    }

    #[Test]
    public function a_cancelled_order_cannot_start_or_continue_and_a_draft_is_unprocessable(): void
    {
        $order = $this->order();
        $this->withToken($this->ownerToken)->postJson("/api/commerce/orders/{$order->id}/cancel", ['reason' => 'customer_request'])->assertOk();
        $this->assertRefused($this->act($order->id, 'start', ['expected_version' => 0]), 'already_cancelled');

        $continuing = $this->order();
        $this->drive($continuing->id, 'ready');
        $this->withToken($this->ownerToken)->postJson("/api/commerce/orders/{$continuing->id}/cancel", ['reason' => 'customer_request'])->assertOk();
        $this->assertRefused($this->act($continuing->id, 'dispatch', ['expected_version' => 2, 'carrier_name' => 'x']), 'already_cancelled');
        $this->assertRefused($this->patchDetails($continuing->id, ['expected_version' => 2, 'carrier_name' => 'x']), 'already_cancelled');
        $this->assertSame([], $this->detail($continuing->id)->json('data.fulfillment_actions'), 'ملغى ⇒ لا إجراءات');
    }

    #[Test]
    public function the_warehouse_is_the_reservation_warehouse_first_then_the_policy_and_never_a_fallback(): void
    {
        app(TenantContext::class)->set($this->tenant->id);
        $other = Warehouse::create(['name' => 'مخزن الحجز', 'code' => 'FUL-W2']);
        $held = $this->order(hold: true);
        DB::table('inventory_reservations')->where('source_id', $held->id)->update(['warehouse_id' => $other->id]);
        $plain = $this->order();
        app(TenantContext::class)->forget();

        $this->go($held->id, 'start');
        $this->go($plain->id, 'start');
        $this->assertSame($other->id, $this->row($held->id)->warehouse_id, 'مخزن الحجز يتقدّم على السياسة');
        $this->assertSame($this->warehouse->id, $this->row($plain->id)->warehouse_id);

        DB::table('fulfillment_policies')->where('sales_channel_id', $this->channel->id)->delete();
        $noPolicy = $this->order();
        $this->assertRefused($this->act($noPolicy->id, 'start', ['expected_version' => 0]), 'fulfillment_policy_missing');
        $this->assertNull($this->row($noPolicy->id));
    }

    // ═════════════════════════ 4) idempotency والنسخة (D-H2-22) ═════════════════════════

    #[Test]
    public function the_expected_version_is_mandatory_stale_versions_conflict_and_a_met_target_is_a_no_op(): void
    {
        $order = $this->order();
        $this->act($order->id, 'start')->assertStatus(428)->assertJsonPath('reason', 'expected_version_required');
        $this->act($order->id, 'start', ['expected_version' => 'abc'])->assertStatus(422);
        $this->act($order->id, 'start', ['expected_version' => 3])->assertStatus(409)->assertJsonPath('reason', 'fulfillment_version_conflict')
            ->assertJsonPath('current_version', 0)->assertJsonPath('current_status', null);

        $this->go($order->id, 'start');
        $events = DB::table('commerce_order_events')->count();
        $again = $this->act($order->id, 'start', ['expected_version' => 0])->assertOk();
        $this->assertSame(1, $again->json('data.fulfillment.version'), 'الهدف متحقق ⇒ لا أثر ولا زيادة نسخة');
        $this->assertSame($events, DB::table('commerce_order_events')->count());

        $this->go($order->id, 'mark_ready');
        $this->act($order->id, 'mark_ready', ['expected_version' => 1])->assertOk()->assertJsonPath('data.fulfillment.version', 2);

        // نسخة قديمة لانتقال غير مُحقَّق ⇒ 409 + الحالة الحالية.
        $this->act($order->id, 'dispatch', ['expected_version' => 1, 'carrier_name' => 'x'])
            ->assertStatus(409)->assertJsonPath('reason', 'fulfillment_version_conflict')->assertJsonPath('current_version', 2)->assertJsonPath('current_status', 'ready');
        $this->assertSame(2, $this->version($order->id));
    }

    #[Test]
    public function unknown_keys_tenant_id_and_malformed_input_are_rejected_without_writing(): void
    {
        $order = $this->order();
        $this->act($order->id, 'start', ['expected_version' => 0, 'status' => 'delivered'])->assertStatus(422);
        $this->act($order->id, 'start', ['expected_version' => 0, 'tenant_id' => (string) Str::uuid()])->assertStatus(422);
        $this->drive($order->id, 'out_for_delivery');
        $v = $this->version($order->id);
        $this->act($order->id, 'fail', ['expected_version' => $v])->assertStatus(422)->assertJsonPath('reason', 'invalid_input');
        $this->act($order->id, 'fail', ['expected_version' => $v, 'reason' => 'because'])->assertStatus(422);
        $this->act($order->id, 'start', ['expected_version' => $v, 'type' => 'carrier'])->assertStatus(422);
        $this->assertSame('out_for_delivery', $this->row($order->id)->status);
    }

    // ═════════════════════════ 5) تفاصيل الناقل والساعي ═════════════════════════

    #[Test]
    public function details_are_validated_normalized_and_the_type_switches_only_before_dispatch(): void
    {
        $order = $this->order();
        $this->assertRefused($this->patchDetails($order->id, ['expected_version' => 0, 'carrier_name' => 'x']), 'fulfillment_not_started');
        $this->go($order->id, 'start');

        $this->patchDetails($order->id, ['expected_version' => 1, 'tracking_url' => 'http://insecure.test/t'])->assertStatus(422);
        $this->patchDetails($order->id, ['expected_version' => 1, 'tracking_url' => "https://x.test/a b"])->assertStatus(422);
        $this->patchDetails($order->id, ['expected_version' => 1, 'courier_phone' => '12ab'])->assertStatus(422);
        $this->patchDetails($order->id, ['expected_version' => 1, 'type' => 'pickup'])->assertStatus(422);
        $this->patchDetails($order->id, ['expected_version' => 1, 'note' => 'سابق لأوانه'])->assertStatus(422);

        $d = $this->patchDetails($order->id, [
            'expected_version' => 1, 'type' => 'carrier', 'carrier_name' => ' سمسا ', 'tracking_number' => 'T-1',
            'tracking_url' => 'https://track.example.test/T-1', 'courier_name' => 'خالد', 'courier_phone' => '٠٥٠٠٠٠٠٠٠٠',
        ])->assertOk()->json('data.fulfillment');
        $this->assertSame(['carrier', 'سمسا', 'T-1', 'خالد', '0500000000', 2], [$d['type'], $d['carrier']['name'], $d['carrier']['tracking_number'], $d['courier']['name'], $d['courier']['phone'], $d['version']]);

        $events = DB::table('commerce_order_events')->count();
        $this->patchDetails($order->id, ['expected_version' => 2, 'carrier_name' => 'سمسا'])->assertOk()->assertJsonPath('data.fulfillment.version', 2);
        $this->assertSame($events, DB::table('commerce_order_events')->count(), 'بلا تغيير فعلي ⇒ لا نسخة ولا حدث');

        $this->go($order->id, 'mark_ready');
        $carrierless = $this->order();
        $this->patchDetails($carrierless->id, ['expected_version' => 0, 'carrier_name' => 'x'])->assertStatus(409);
        $this->go($carrierless->id, 'mark_ready');
        $this->patchDetails($carrierless->id, ['expected_version' => 1, 'type' => 'carrier'])->assertOk();
        $this->act($carrierless->id, 'dispatch', ['expected_version' => 2])->assertStatus(422)->assertJsonPath('reason', 'invalid_input');
        $this->act($carrierless->id, 'dispatch', ['expected_version' => 2, 'carrier_name' => 'ناقل'])->assertOk();
        $this->patchDetails($carrierless->id, ['expected_version' => 3, 'type' => 'local_delivery'])->assertStatus(409)->assertJsonPath('reason', 'invalid_transition');
    }

    #[Test]
    public function events_carry_only_the_whitelisted_codes_never_carrier_tracking_courier_or_notes(): void
    {
        $order = $this->order();
        $this->go($order->id, 'start');
        $this->patchDetails($order->id, ['expected_version' => 1, 'type' => 'carrier', 'carrier_name' => 'سري-ناقل', 'tracking_number' => 'SECRET-TRK', 'courier_phone' => '0555555555', 'courier_name' => 'سري-ساعٍ'])->assertOk();
        $this->go($order->id, 'mark_ready');
        $this->go($order->id, 'dispatch');
        $this->go($order->id, 'fail', ['reason' => 'recipient_absent', 'note' => 'ملاحظة داخلية حساسة']);

        $rows = DB::table('commerce_order_events')->where('commerce_order_id', $order->id)->orderBy('feed_seq')->get();
        $blob = json_encode($rows->all(), JSON_UNESCAPED_UNICODE);
        foreach (['سري', 'SECRET', '0555555555', 'ملاحظة داخلية'] as $secret) {
            $this->assertStringNotContainsString($secret, $blob, "الحدث لا يحمل $secret");
        }
        $byType = $rows->keyBy('type');
        $this->assertSame(['fields' => 'type,carrier,number,courier,phone'], json_decode($byType['fulfillment.details_updated']->data, true));
        $this->assertSame(['type' => 'carrier', 'attempt' => '1'], json_decode($byType['fulfillment.dispatched']->data, true));
        $this->assertSame(['reason' => 'recipient_absent', 'attempt' => '1'], json_decode($byType['fulfillment.delivery_failed']->data, true));
    }

    // ═════════════════════════ 6) الإلغاء (الصف 14) وكل مساراته (AR-2) ═════════════════════════

    #[Test]
    public function cancellation_is_allowed_before_dispatch_and_after_return_but_not_in_transit_or_after_completion(): void
    {
        foreach (['preparing', 'ready', 'returned_to_store'] as $state) {
            $order = $this->order();
            $this->drive($order->id, $state);
            $this->withToken($this->ownerToken)->postJson("/api/commerce/orders/{$order->id}/cancel", ['reason' => 'customer_request'])->assertOk();
            $this->assertNotNull(DB::table('commerce_orders')->where('id', $order->id)->value('cancelled_at'), "إلغاء مسموح في $state");
            $this->assertSame($state, $this->row($order->id)->status, 'الإلغاء لا يكتب صف التنفيذ (مشتق)');
            $this->assertSame('cancelled', $this->detail($order->id)->json('data.operational_status'));
        }
        $none = $this->order();
        $this->withToken($this->ownerToken)->postJson("/api/commerce/orders/{$none->id}/cancel", ['reason' => 'customer_request'])->assertOk();

        foreach (['out_for_delivery' => 'fulfillment_in_transit', 'delivery_failed' => 'fulfillment_in_transit', 'delivered' => 'fulfillment_completed', 'picked_up' => 'fulfillment_completed'] as $state => $reason) {
            $pickup = $state === 'picked_up';
            $order = $this->order(delivery: $pickup ? 'pickup' : 'standard', method: $pickup ? CommercePaymentIntent::METHOD_PAY_ON_PICKUP : CommercePaymentIntent::METHOD_COD);
            $this->drive($order->id, $state);
            $this->withToken($this->ownerToken)->postJson("/api/commerce/orders/{$order->id}/cancel", ['reason' => 'customer_request'])
                ->assertStatus(409)->assertJsonPath('reason', $reason);
            $this->assertNull(DB::table('commerce_orders')->where('id', $order->id)->value('cancelled_at'), $state);
            $this->assertSame('cancel', 'cancel');
        }
    }

    #[Test]
    public function every_legacy_intent_cancellation_path_respects_the_fulfillment_restriction(): void
    {
        foreach (['out_for_delivery' => 'fulfillment_in_transit', 'delivery_failed' => 'fulfillment_in_transit', 'delivered' => 'fulfillment_completed'] as $state => $reason) {
            $order = $this->order(mode: CommerceOrder::ACCEPTANCE_MANUAL);
            $this->withToken($this->ownerToken)->postJson("/api/commerce/orders/{$order->id}/accept")->assertOk();
            $this->drive($order->id, $state);
            $intentId = DB::table('commerce_payment_intents')->where('commerce_order_id', $order->id)->value('id');

            // 1) المسار القديم، بوابة الإلغاء مغلقة ⇒ 422 برمز ثابت.
            config(['commerce.order_cancellation_enabled' => false]);
            $this->withToken($this->ownerToken)->postJson("/api/commerce/payment-intents/{$intentId}/cancel")->assertStatus(422)->assertJsonPath('reason', $reason);
            // 2) المسار نفسه، البوابة مفتوحة ⇒ يُفوَّض لخدمة الإلغاء ⇒ 409 برمز المصفوفة (لا payment_captured).
            config(['commerce.order_cancellation_enabled' => true]);
            $this->withToken($this->ownerToken)->postJson("/api/commerce/payment-intents/{$intentId}/cancel", ['reason' => 'customer_request'])
                ->assertStatus(409)->assertJsonPath('reason', $reason);
            // 3) خدمة الإلغاء مباشرةً (مسارا الإلغاء والرفض).
            app(TenantContext::class)->set($this->tenant->id);
            $actor = User::query()->firstOrFail();
            $e = $this->thrown(fn () => app(CommerceOrderLifecycleService::class)->cancel(CommerceOrder::query()->findOrFail($order->id), $actor, 'customer_request', null), 'cancel()', \App\Services\Commerce\CommerceOrderCancellationException::class);
            $this->assertSame($reason, $e->reason);
            // 4) cancel() المباشر على النية (المكنسة تستدعي الدالة نفسها وتتخطّى عند RuntimeException).
            $e = $this->thrown(fn () => app(CommercePaymentIntentService::class)->cancel(CommercePaymentIntent::query()->findOrFail($intentId)), 'intent->cancel()', CommerceOrderFulfillmentLockedException::class);
            $this->assertSame($reason, $e->reason);
            $this->assertInstanceOf(\RuntimeException::class, $e, 'يبقى RuntimeException لسلوك المستدعين القدماء');
            app(TenantContext::class)->forget();

            $this->assertSame('awaiting_collection', DB::table('commerce_payment_intents')->where('id', $intentId)->value('status'), "$state: النية لم تُلغَ");
            $this->assertNull(DB::table('commerce_orders')->where('id', $order->id)->value('cancelled_at'));
        }
    }

    #[Test]
    public function cancelling_the_intent_first_blocks_every_later_transition_and_the_way_out_is_cancelling_the_order(): void
    {
        foreach (['dispatch', 'mark_ready'] as $action) {
            $order = $this->order();
            $this->drive($order->id, $action === 'dispatch' ? 'ready' : 'preparing');
            $intentId = DB::table('commerce_payment_intents')->where('commerce_order_id', $order->id)->value('id');
            config(['commerce.order_cancellation_enabled' => false]);
            $this->withToken($this->ownerToken)->postJson("/api/commerce/payment-intents/{$intentId}/cancel")->assertOk();
            config(['commerce.order_cancellation_enabled' => true]);

            $this->assertRefused($this->act($order->id, $action, ['expected_version' => $this->version($order->id), 'carrier_name' => 'x']), 'payment_cancelled');
            $actions = $this->detail($order->id)->json('data.fulfillment_actions');
            $this->assertNotEmpty($actions);
            $this->assertSame([false], array_values(array_unique(array_column($actions, 'available'))));
            $this->assertSame('payment_cancelled', $actions[0]['blocked_reason']);
            $this->patchDetails($order->id, ['expected_version' => $this->version($order->id), 'tracking_number' => 'T-9'])->assertOk(); // التوثيق ممكن
            // المخرج: إلغاء الطلب بالمسار القائم (إقفال إداري لنية ملغاة).
            $this->withToken($this->ownerToken)->postJson("/api/commerce/orders/{$order->id}/cancel", ['reason' => 'payment_issue'])->assertOk();
        }

        $pickup = $this->order(delivery: 'pickup', method: CommercePaymentIntent::METHOD_PAY_ON_PICKUP);
        $this->drive($pickup->id, 'ready');
        config(['commerce.order_cancellation_enabled' => false]);
        $this->withToken($this->ownerToken)->postJson('/api/commerce/payment-intents/'.DB::table('commerce_payment_intents')->where('commerce_order_id', $pickup->id)->value('id').'/cancel')->assertOk();
        $this->assertRefused($this->act($pickup->id, 'pickup', ['expected_version' => 2]), 'payment_cancelled');
    }

    // ═════════════════════════ 7) فشل التوصيل وتعذّر الرجوع (AR-1) ═════════════════════════

    #[Test]
    public function a_failed_delivery_can_be_retried_returned_then_cancelled_and_an_unreturnable_one_stays_failed(): void
    {
        $order = $this->order();
        $this->drive($order->id, 'delivery_failed');
        $d = $this->detail($order->id)->json('data');
        $this->assertSame(1, $d['fulfillment']['delivery_attempts']);
        $this->assertSame('address_issue', $d['fulfillment']['last_failure']['reason']);
        $this->assertEqualsCanonicalizing(['dispatch', 'return'], array_column($d['fulfillment_actions'], 'action'));

        // إعادة محاولة ثم فشل ثانٍ: المحاولات 2.
        $this->go($order->id, 'dispatch');
        $d = $this->go($order->id, 'fail', ['reason' => 'customer_refused', 'note' => 'رفض الاستلام'])->json('data.fulfillment');
        $this->assertSame([2, 'customer_refused', 'رفض الاستلام'], [$d['delivery_attempts'], $d['last_failure']['reason'], $d['last_failure']['note']]);

        // تعذّر الرجوع: يبقى delivery_failed، الإلغاء 409، والتوثيق ممكن بالملاحظة الداخلية، ولا إجراء إغلاق/إلغاء/استرداد/شطب.
        $this->withToken($this->ownerToken)->postJson("/api/commerce/orders/{$order->id}/cancel", ['reason' => 'customer_request'])
            ->assertStatus(409)->assertJsonPath('reason', 'fulfillment_in_transit');
        $this->patchDetails($order->id, ['expected_version' => $this->version($order->id), 'note' => 'البضاعة تلفت — لا رجوع'])->assertOk();
        $this->assertSame('delivery_failed', $this->row($order->id)->status);
        $this->assertContains($this->detail($order->id)->json('data.operational_status'), ['delivery_failed']);
        $offered = array_column($this->detail($order->id)->json('data.fulfillment_actions'), 'action');
        foreach (['abandon', 'write_off', 'cancel', 'refund', 'close'] as $forbidden) {
            $this->assertNotContains($forbidden, $offered);
            $this->act($order->id, $forbidden, ['expected_version' => $this->version($order->id)])->assertNotFound();
        }
        $this->assertSame([], array_values(array_intersect(array_keys(CommerceOrderFulfillmentService::TARGETS), ['abandon', 'write_off', 'cancel_failed', 'refund', 'close'])));

        // العودة الفعلية تفتح الإلغاء بمساره القائم.
        $this->go($order->id, 'return');
        $this->withToken($this->ownerToken)->postJson("/api/commerce/orders/{$order->id}/cancel", ['reason' => 'customer_request'])->assertOk();
    }

    // ═════════════════════════ 8) RBAC والعزل ═════════════════════════

    #[Test]
    public function permissions_isolation_and_restricted_warehouse_users_are_enforced(): void
    {
        $order = $this->order();
        $this->role('viewer_only', ['commerce.orders.view']);
        $this->role('manager_only', ['commerce.orders.view', 'commerce.orders.manage']);
        $viewer = $this->tokenFor($this->tenant, 'viewer_only');
        $manager = $this->tokenFor($this->tenant, 'manager_only');

        $this->act($order->id, 'start', ['expected_version' => 0], $viewer)->assertForbidden();
        $this->patchDetails($order->id, ['expected_version' => 1, 'carrier_name' => 'x'], $viewer)->assertForbidden();
        $this->assertNotContains('fulfillment_actions', array_keys($this->detail($order->id, $viewer)->assertOk()->json('data')), 'بلا manage ⇒ لا عقد إجراءات');
        $this->act($order->id, 'start', ['expected_version' => 0], $this->tokenFor($this->tenant, 'accountant'))->assertForbidden();
        $this->withoutToken()->postJson("/api/commerce/orders/{$order->id}/fulfillment/start", ['expected_version' => 0])->assertUnauthorized();
        $this->assertNull($this->row($order->id));

        $this->act($order->id, 'start', ['expected_version' => 0], $manager)->assertOk();
        $this->assertContains('fulfillment_actions', array_keys($this->detail($order->id, $manager)->json('data')));

        $restricted = $this->tokenFor($this->tenant, 'admin', 'restricted-fulfil@fulfil.test');
        app(TenantContext::class)->set($this->tenant->id);
        User::where('email', 'restricted-fulfil@fulfil.test')->firstOrFail()->warehouses()->attach($this->warehouse->id);
        app(TenantContext::class)->forget();
        $this->act($order->id, 'mark_ready', ['expected_version' => 1], $restricted)->assertForbidden();
        $this->patchDetails($order->id, ['expected_version' => 1, 'carrier_name' => 'x'], $restricted)->assertForbidden();
        $this->assertSame('preparing', $this->row($order->id)->status);

        // مستأجر آخر: 404 موحَّد قبل أي 428/422، ولا أثر.
        ['tenant' => $other] = $this->makeStore('other-fulfil.test', 'other-fulfil');
        $this->enableApplications($other);
        $foreign = $this->tokenFor($other, 'owner');
        $missing = $this->act((string) Str::uuid(), 'start', [], $foreign);
        $cross = $this->act($order->id, 'start', [], $foreign);
        $crossPatch = $this->patchDetails($order->id, ['carrier_name' => 'x'], $foreign);
        $missing->assertNotFound();
        $cross->assertNotFound();
        $crossPatch->assertNotFound();
        $this->assertSame($missing->json('message'), $cross->json('message'));
        $this->assertSame(1, $this->version($order->id));
        $this->detail($order->id, $foreign)->assertNotFound();
    }

    // ═════════════════════════ 9) لا أثر مالي أو مخزني أو حجز ═════════════════════════

    #[Test]
    public function the_whole_lifecycle_creates_no_entries_invoices_movements_payments_or_reservations(): void
    {
        $order = $this->order(hold: true);
        $before = $this->counts();
        $holds = DB::table('inventory_reservations')->where('source_id', $order->id)->get()->toArray();
        $intent = DB::table('commerce_payment_intents')->where('commerce_order_id', $order->id)->first();

        $this->drive($order->id, 'delivered');

        $this->assertSame($before, $this->counts());
        $this->assertEquals($holds, DB::table('inventory_reservations')->where('source_id', $order->id)->get()->toArray(), 'الحجز كما هو');
        $this->assertEquals($intent, DB::table('commerce_payment_intents')->where('commerce_order_id', $order->id)->first(), 'نية الدفع لا تُلمس (التسليم ≠ تحصيل)');
    }

    #[Test]
    public function the_service_references_no_accounting_inventory_payment_or_reservation_service_and_is_the_sole_writer(): void
    {
        $service = (string) file_get_contents(app_path('Services/Commerce/CommerceOrderFulfillmentService.php'));
        $code = preg_replace('~/\*.*?\*/|//[^\n]*~s', '', $service);
        foreach (['LedgerService', 'InventoryService', 'InvoiceService', 'PaymentService', 'StockMovement', 'InventoryReservationService', 'CommerceOrderReservationService', 'PaymentOrchestrator', 'DB::table('] as $forbidden) {
            $this->assertStringNotContainsString($forbidden, $code, "الخدمة لا تذكر $forbidden");
        }

        // الكاتب الوحيد للجدول: لا إنشاء/تحديث/حذف خارج الخدمة في app/.
        foreach ($this->phpFiles(app_path()) as $file) {
            if (str_ends_with($file, 'CommerceOrderFulfillmentService.php')) {
                continue;
            }
            $src = (string) file_get_contents($file);
            $this->assertDoesNotMatchRegularExpression('/CommerceOrderFulfillment::(create|insert|query\(\)[^;]*->(update|delete|insert)|updateOrCreate|firstOrCreate)/s', $src, basename($file));
            $this->assertStringNotContainsString("DB::table('commerce_order_fulfillments')->insert", $src, basename($file));
            $this->assertStringNotContainsString("DB::table('commerce_order_fulfillments')->update", $src, basename($file));
        }

        // الكاتب الوحيد لحالة النية `cancelled`.
        foreach ($this->phpFiles(app_path('Services')) as $file) {
            $src = (string) file_get_contents($file);
            if (str_ends_with($file, 'CommercePaymentIntentService.php')) {
                $this->assertSame(1, substr_count($src, "'status' => CommercePaymentIntent::STATUS_CANCELLED"), 'مكتوبة مرة واحدة في cancelWithinTransaction');
            } else {
                $this->assertStringNotContainsString("'status' => CommercePaymentIntent::STATUS_CANCELLED", $src, basename($file));
            }
        }
    }

    #[Test]
    public function every_transition_locks_intent_then_order_then_fulfillment_and_appends_its_event_last(): void
    {
        $src = (string) file_get_contents(app_path('Services/Commerce/CommerceOrderFulfillmentService.php'));
        foreach (['public function act(', 'public function updateDetails('] as $method) {
            $body = substr($src, (int) strpos($src, $method));
            $body = substr($body, 0, (int) strpos($body, 'private function', 10) ?: null);
            $intent = strpos($body, 'CommercePaymentIntent::query()');
            $orderLock = strpos($body, 'CommerceOrder::query()->whereKey');
            $row = strpos($body, 'CommerceOrderFulfillment::query()');
            $this->assertTrue($intent !== false && $intent < $orderLock && $orderLock < $row, "$method: النية ← الطلب ← التنفيذ");
        }
        $act = substr($src, (int) strpos($src, 'public function act('));
        $this->assertGreaterThan((int) strpos($act, '->save();'), (int) strpos($act, '$this->events->append('), 'الحدث بعد الكتابة وفي آخر المعاملة');
        // قراءة مخزن الحجز نموذجاً مسموحة؛ استدعاء خدمات الحجز (حجز/تحرير/استهلاك) ممنوع.
        foreach (['ReservationService', '->releaseActive', '->makePermanent', '->consume(', '->reserve(', '->acquire('] as $reservationCall) {
            $this->assertStringNotContainsString($reservationCall, $src, $reservationCall);
        }

        // الإلغاء: النية ← الطلب ← التنفيذ ← الحجز.
        $life = (string) file_get_contents(app_path('Services/Commerce/CommerceOrderLifecycleService.php'));
        $cancel = substr($life, (int) strpos($life, 'private function performCancellation'));
        $this->assertTrue(
            strpos($cancel, 'CommercePaymentIntent::query()') < strpos($cancel, 'CommerceOrder::query()->whereKey')
            && strpos($cancel, 'CommerceOrder::query()->whereKey') < strpos($cancel, 'CommerceOrderFulfillment::query()')
            && strpos($cancel, 'CommerceOrderFulfillment::query()') < strpos($cancel, 'releaseActive'),
        );
    }

    /** @return list<string> */
    private function phpFiles(string $dir): array
    {
        $out = [];
        foreach (new \RecursiveIteratorIterator(new \RecursiveDirectoryIterator($dir, \FilesystemIterator::SKIP_DOTS)) as $f) {
            if ($f->isFile() && $f->getExtension() === 'php') {
                $out[] = $f->getPathname();
            }
        }

        return $out;
    }

    // ═════════════════════════ 10) القائمة والمُسقِط والأحداث ═════════════════════════

    #[Test]
    public function the_list_filters_by_fulfillment_status_and_projects_the_operational_status_without_extra_queries_per_row(): void
    {
        $a = $this->order();
        $b = $this->order();
        $c = $this->order();
        $this->drive($a->id, 'preparing');
        $this->drive($b->id, 'delivery_failed');

        $res = fn (string $q) => $this->withToken($this->ownerToken)->getJson('/api/commerce/orders?'.$q)->assertOk();
        $this->assertSame([$a->id], array_column($res('fulfillment_status=preparing')->json('data'), 'id'));
        $this->assertSame([$b->id], array_column($res('fulfillment_status=delivery_failed')->json('data'), 'id'));
        $this->assertSame([$c->id], array_column($res('fulfillment_status=not_started')->json('data'), 'id'));
        $this->withToken($this->ownerToken)->getJson('/api/commerce/orders?fulfillment_status=bogus')->assertStatus(422);

        $statuses = collect($res('per_page=50')->json('data'))->pluck('operational_status', 'id');
        $this->assertSame(['preparing', 'delivery_failed', 'accepted'], [$statuses[$a->id], $statuses[$b->id], $statuses[$c->id]]);

        DB::enableQueryLog();
        $res('per_page=50');
        $small = count(DB::getQueryLog());
        foreach (range(1, 6) as $i) {
            $this->drive($this->order()->id, 'ready');
        }
        DB::flushQueryLog();
        $res('per_page=50');
        $this->assertSame($small, count(DB::getQueryLog()), 'عدد الاستعلامات لا يتغيّر بعدد الصفوف');
    }

    #[Test]
    public function a_domain_event_fires_after_commit_for_a_dispatch_with_ids_only(): void
    {
        Event::fake([CommerceOrderFulfillmentDispatched::class]);
        $order = $this->order();
        $this->drive($order->id, 'out_for_delivery');

        Event::assertDispatched(CommerceOrderFulfillmentDispatched::class, fn ($e) => $e->orderId === $order->id && $e->tenantId === $this->tenant->id);
    }

    // ═════════════════════════ 11) حراس القاعدة ═════════════════════════

    #[Test]
    public function the_database_refuses_invalid_fulfillment_rows_and_transitions(): void
    {
        $order = $this->order();
        $now = now('UTC')->toDateTimeString();
        $base = [
            'id' => (string) Str::uuid(), 'tenant_id' => $this->tenant->id, 'commerce_order_id' => $order->id, 'warehouse_id' => $this->warehouse->id,
            'type' => 'local_delivery', 'status' => 'preparing', 'version' => 1, 'delivery_attempts' => 0, 'preparing_at' => $now, 'created_at' => $now, 'updated_at' => $now,
        ];
        foreach ([
            ['status' => 'delivered'], ['status' => 'out_for_delivery'], ['version' => 2], ['type' => 'rocket'],
            ['status' => 'preparing', 'preparing_at' => null], ['delivery_attempts' => 1], ['last_failure_reason' => 'address_issue'], ['tracking_url' => 'http://x.test'],
            ['delivered_at' => $now],
            // الفحوص العابرة للجداول في القاعدة على PostgreSQL فقط (SQLite: في الكاتب — انظر الهجرة).
            ...(DB::connection()->getDriverName() === 'pgsql' ? [['type' => 'pickup'], ['tenant_id' => (string) Str::uuid()], ['warehouse_id' => (string) Str::uuid()]] : []),
        ] as $i => $bad) {
            $this->assertGuard(fn () => DB::table('commerce_order_fulfillments')->insert(array_merge($base, ['id' => (string) Str::uuid()], $bad)), 'insert '.json_encode(array_keys($bad)));
        }

        DB::table('commerce_order_fulfillments')->insert($base);
        $id = $base['id'];
        $upd = fn (array $set) => DB::table('commerce_order_fulfillments')->where('id', $id)->update($set);

        $this->assertGuard(fn () => $upd(['status' => 'delivered', 'version' => 2, 'delivered_at' => $now]), 'preparing→delivered');
        $this->assertGuard(fn () => $upd(['status' => 'ready', 'ready_at' => $now]), 'الإصدار لا يتقدّم');
        $this->assertGuard(fn () => $upd(['status' => 'ready', 'version' => 3, 'ready_at' => $now]), 'قفزة نسخة');
        $this->assertGuard(fn () => $upd(['status' => 'ready', 'version' => 2]), 'ready بلا ready_at');
        $this->assertGuard(fn () => $upd(['version' => 2, 'type' => 'pickup']), 'تبديل إلى pickup');
        $this->assertGuard(fn () => $upd(['version' => 2, 'tenant_id' => (string) Str::uuid()]), 'تغيير المستأجر');
        $this->assertGuard(fn () => $upd(['version' => 2, 'commerce_order_id' => (string) Str::uuid()]), 'تغيير الطلب');
        $this->assertGuard(fn () => $upd(['version' => 2, 'tracking_url' => 'ftp://x']), 'رابط غير https');
        $this->assertGuard(fn () => $upd(['version' => 2, 'delivery_attempts' => 5]), 'محاولات خارج الفشل');
        $this->assertGuard(fn () => $upd(['version' => 2, 'preparing_at' => null]), 'طابع أحادي');

        $upd(['status' => 'ready', 'version' => 2, 'ready_at' => $now]);
        $this->assertGuard(fn () => $upd(['status' => 'out_for_delivery', 'version' => 3, 'last_dispatched_at' => $now, 'first_dispatched_at' => $now, 'type' => 'carrier']), 'تبديل النوع مع الإرسال');
        $this->assertGuard(fn () => $upd(['status' => 'picked_up', 'version' => 3, 'picked_up_at' => $now]), 'picked_up لغير pickup');
        $this->assertGuard(fn () => $upd(['status' => 'delivery_failed', 'version' => 3, 'last_failed_at' => $now, 'last_failure_reason' => 'address_issue', 'delivery_attempts' => 1]), 'ready→delivery_failed');
        $upd(['type' => 'carrier', 'version' => 3, 'carrier_name' => 'ن']);
        $this->assertGuard(fn () => $upd(['status' => 'out_for_delivery', 'version' => 4, 'last_dispatched_at' => $now, 'first_dispatched_at' => $now, 'carrier_name' => ' ']), 'إرسال ناقل بلا اسم');
        $upd(['status' => 'out_for_delivery', 'version' => 4, 'last_dispatched_at' => $now, 'first_dispatched_at' => $now]);
        $this->assertGuard(fn () => $upd(['status' => 'delivery_failed', 'version' => 5, 'last_failed_at' => $now, 'last_failure_reason' => 'bogus', 'delivery_attempts' => 1]), 'سبب غير معتمد');
        $this->assertGuard(fn () => $upd(['status' => 'delivery_failed', 'version' => 5, 'last_failed_at' => $now, 'last_failure_reason' => 'other', 'delivery_attempts' => 0]), 'فشل بلا زيادة محاولات');
        $this->assertGuard(fn () => $upd(['status' => 'delivery_failed', 'version' => 5, 'last_failure_reason' => 'other', 'delivery_attempts' => 1]), 'فشل بلا وقت');
        $upd(['status' => 'delivered', 'version' => 5, 'delivered_at' => $now]);
        $this->assertGuard(fn () => $upd(['version' => 6, 'courier_name' => 'x']), 'المكتمل مجمَّد');
        $this->assertGuard(fn () => DB::table('commerce_order_fulfillments')->where('id', $id)->delete(), 'لا حذف');
    }

    #[Test]
    public function the_database_blocks_cancelling_an_order_in_transit_or_completed_and_freezes_a_cancelled_orders_fulfillment(): void
    {
        $transit = $this->order();
        $this->drive($transit->id, 'out_for_delivery');
        $this->assertGuard(fn () => DB::table('commerce_orders')->where('id', $transit->id)->update([
            'cancelled_at' => now('UTC'), 'cancelled_by_user_id' => $this->userId(), 'cancellation_reason' => 'customer_request',
        ]), 'كتابة مباشرة لـcancelled_at في النقل');
        $this->assertNull(DB::table('commerce_orders')->where('id', $transit->id)->value('cancelled_at'));

        $ready = $this->order();
        $this->drive($ready->id, 'ready');
        $this->withToken($this->ownerToken)->postJson("/api/commerce/orders/{$ready->id}/cancel", ['reason' => 'customer_request'])->assertOk();
        if (DB::connection()->getDriverName() === 'pgsql') {
            $this->assertGuard(fn () => DB::table('commerce_order_fulfillments')->where('commerce_order_id', $ready->id)->update(['status' => 'out_for_delivery', 'version' => 3, 'last_dispatched_at' => now('UTC'), 'first_dispatched_at' => now('UTC')]), 'تنفيذ طلب ملغى مجمَّد');
        }
        // الخدمة ترفض على المحرّكين (الحارس في الكاتب لـSQLite).
        $this->assertRefused($this->act($ready->id, 'dispatch', ['expected_version' => 2, 'carrier_name' => 'x']), 'already_cancelled');
    }

    #[Test]
    public function the_migration_down_refuses_while_fulfillment_facts_exist(): void
    {
        $order = $this->order();
        $this->go($order->id, 'start');
        $migration = require base_path('database/migrations/2026_12_31_010000_create_commerce_order_fulfillments_table.php');
        $e = $this->thrown(fn () => $migration->down(), 'down()', \RuntimeException::class);
        $this->assertStringContainsString('Rollback refused', $e->getMessage());
        $this->assertNotNull($this->row($order->id));
    }

    #[Test]
    public function the_model_is_company_wide_has_no_mass_assignment_and_unknown_actions_are_not_routable(): void
    {
        $this->assertInstanceOf(\App\Tenancy\CompanyWide::class, new CommerceOrderFulfillment());
        $this->assertSame([], (new CommerceOrderFulfillment())->getFillable());
        $order = $this->order();
        $this->act($order->id, 'teleport', ['expected_version' => 0])->assertNotFound();
        $this->assertNull($this->row($order->id));
    }
}
