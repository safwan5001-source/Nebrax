<?php

namespace Tests\Feature;

use App\Models\CommerceOrder;
use App\Models\CommerceOrderLine;
use App\Models\CommercePaymentIntent;
use App\Models\FulfillmentPolicy;
use App\Models\InventoryReservation;
use App\Models\Product;
use App\Models\Tenant;
use App\Models\User;
use App\Models\Warehouse;
use App\Services\Accounting\ChartOfAccountsSeeder;
use App\Services\Commerce\CommerceOrderWarehouseScope;
use App\Services\Commerce\FulfillmentPolicyService;
use App\Services\TenantApplicationService;
use App\Support\ApplicationCatalog;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use PHPUnit\Framework\Attributes\Test;
use Tests\TestCase;

/**
 * ═══════════════════════════════════════════════════════════════
 *  COPS-H2-2 (D-H2-11) — رؤية المستخدم المقيَّد بمخازن لطلبات المتجر عبر المخزن الفعّال
 * ═══════════════════════════════════════════════════════════════
 *  المخزن الفعّال = تنفيذ ← حجز (الأقدم) ← سياسة القناة الحالية ← لا شيء (غير مرئي). تُفتح القائمة والتفاصيل والإجراءات (قبول/رفض/إلغاء/تنفيذ) والانتباه بتصفية SQL؛
 * طلب خارج النطاق ⇒ 404 موحَّد؛ **التغذية تبقى 403**؛ غير المقيَّد كما كان؛ عزل المستأجر؛ الصلاحيات تُفحص أولاً؛ لا استعلام لكل صف.
 */
class CommerceOrderWarehouseVisibilityTest extends TestCase
{
    use InteractsWithApi;
    use OnlineStorefrontHarness;
    use RefreshDatabase;

    private Warehouse $a;

    private Warehouse $b;

    private string $ownerToken;

    private string $restrictedA;

    protected function setUp(): void
    {
        parent::setUp();
        $this->travelTo(now('UTC')->setDate(2026, 11, 2)->setTime(9, 0));
        $this->bootOnlineStore();
        app(TenantContext::class)->set($this->tenant->id);
        app(ChartOfAccountsSeeder::class)->seed($this->tenant->id);
        $this->a = Warehouse::create(['name' => 'مخزن أ', 'code' => 'VIS-A', 'is_default' => true]);
        $this->b = Warehouse::create(['name' => 'مخزن ب', 'code' => 'VIS-B']);
        app(FulfillmentPolicyService::class)->setFixedWarehouse($this->channel->id, $this->a->id);
        $this->enableApplications($this->tenant);
        app(TenantContext::class)->forget();

        $this->ownerToken = $this->token($this->tenant, 'owner');
        $this->restrictedA = $this->restrictedTo([$this->a->id], 'restricted-a@vis.test');
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

    private function token(Tenant $tenant, string $role, ?string $email = null): string
    {
        app(TenantContext::class)->set($tenant->id);
        $user = User::create(['tenant_id' => $tenant->id, 'name' => $role, 'email' => $email ?? $role.'-'.Str::random(6).'@vis.test', 'password' => 'password123', 'role' => $role]);
        $token = $user->createToken('api')->plainTextToken;
        app(TenantContext::class)->forget();

        return $token;
    }

    /** @param list<string> $warehouseIds */
    private function restrictedTo(array $warehouseIds, string $email, string $role = 'admin'): string
    {
        $token = $this->token($this->tenant, $role, $email);
        app(TenantContext::class)->set($this->tenant->id);
        User::where('email', $email)->firstOrFail()->warehouses()->attach($warehouseIds);
        app(TenantContext::class)->forget();

        return $token;
    }

    /** طلب COD مؤكَّد جاهز (تلقائي القبول). */
    private function order(?string $mode = null): CommerceOrder
    {
        app(TenantContext::class)->set($this->tenant->id);
        $order = new CommerceOrder(['sales_channel_id' => $this->channel->id, 'storefront_id' => $this->storefront->id, 'number' => 'CORD-V'.Str::upper(Str::random(6)), 'delivery_method' => 'standard', 'total' => 11500]);
        if ($mode !== null) {
            $order->forceFill(['acceptance_mode' => $mode]);
        }
        $order->save();
        CommerceOrderLine::create(['commerce_order_id' => $order->id, 'product_name_snapshot' => 'وردة', 'quantity' => 1, 'unit_price' => 5000, 'line_total' => 5000]);
        $order->snapshot()->create(['customer_name' => 'سارة', 'phone' => '0500000001', 'email' => 'v@example.test', 'shipping_city' => 'الدمام']);
        $order->update(['status' => CommerceOrder::STATUS_CONFIRMED, 'confirmed_at' => now()]);
        CommercePaymentIntent::create(['commerce_order_id' => $order->id, 'method' => CommercePaymentIntent::METHOD_COD, 'status' => CommercePaymentIntent::STATUS_AWAITING_COLLECTION, 'amount_minor' => 11500, 'currency' => 'SAR']);
        app(TenantContext::class)->forget();

        return $order->fresh();
    }

    private function hold(string $orderId, string $warehouseId): void
    {
        app(TenantContext::class)->set($this->tenant->id);
        $product = Product::create(['name' => 'منتج', 'sku' => 'V-'.Str::random(6), 'unit' => 'piece', 'sale_price' => 5000, 'is_active' => true, 'track_inventory' => true]);
        InventoryReservation::create([
            'warehouse_id' => $warehouseId, 'product_id' => $product->id, 'base_quantity' => 1, 'status' => InventoryReservation::STATUS_ACTIVE,
            'source_type' => CommerceOrder::class, 'source_id' => $orderId, 'idempotency_key' => 'hold-'.Str::random(10), 'request_checksum' => Str::random(16),
            'expires_at' => now('UTC')->addHour(),
        ]);
        app(TenantContext::class)->forget();
    }

    private function policyFor(Warehouse $warehouse): void
    {
        app(TenantContext::class)->set($this->tenant->id);
        app(FulfillmentPolicyService::class)->setFixedWarehouse($this->channel->id, $warehouse->id);
        app(TenantContext::class)->forget();
    }

    /** @return list<string> */
    private function listIds(?string $token = null, string $query = ''): array
    {
        $res = $this->withToken($token ?? $this->ownerToken)->getJson('/api/commerce/orders?per_page=50'.$query)->assertOk();

        return array_column($res->json('data'), 'id');
    }

    private function attention(?string $token = null)
    {
        return $this->withToken($token ?? $this->ownerToken)->getJson('/api/commerce/orders/attention');
    }

    private function fulfil(string $orderId, string $action, array $body, ?string $token = null)
    {
        return $this->withToken($token ?? $this->ownerToken)->postJson("/api/commerce/orders/{$orderId}/fulfillment/{$action}", $body);
    }

    // ═════════════════════════ 1) المخزن الفعّال ═════════════════════════

    #[Test]
    public function the_effective_warehouse_is_the_fulfillment_then_the_reservation_then_the_current_policy_and_otherwise_none(): void
    {
        $viaPolicyA = $this->order();                       // لا حجز ولا تنفيذ، السياسة = أ ⇒ أ
        $viaReservationB = $this->order();                   // حجز في ب والسياسة أ ⇒ ب (الحجز يتقدّم)
        $this->hold($viaReservationB->id, $this->b->id);
        $viaFulfillmentB = $this->order();                   // حجز في أ لكن تنفيذ في ب ⇒ ب (التنفيذ يتقدّم)
        $this->hold($viaFulfillmentB->id, $this->b->id);
        $viaReservationA = $this->order();                   // حجز أ والسياسة ستصير ب ⇒ أ
        $this->hold($viaReservationA->id, $this->a->id);

        // تنفيذ ثابت لطلب ثالث في ب (مخزن الحجز).
        $this->fulfil($viaFulfillmentB->id, 'start', ['expected_version' => 0])->assertOk();
        $this->assertSame($this->b->id, DB::table('commerce_order_fulfillments')->where('commerce_order_id', $viaFulfillmentB->id)->value('warehouse_id'));

        $visibleToA = $this->listIds($this->restrictedA);
        $this->assertEqualsCanonicalizing([$viaPolicyA->id, $viaReservationA->id], $visibleToA, 'مقيَّد بـأ: السياسة أ + حجز أ فقط');

        $restrictedB = $this->restrictedTo([$this->b->id], 'restricted-b@vis.test');
        $this->assertEqualsCanonicalizing([$viaReservationB->id, $viaFulfillmentB->id], $this->listIds($restrictedB));

        // السياسة الحالية تتغيّر إلى ب: الطلب بلا حجز/تنفيذ يتبعها (معلن R-H2-03)؛ والمثبَّت بحجز/تنفيذ لا يتحرك.
        $this->policyFor($this->b);
        $this->assertEqualsCanonicalizing([$viaReservationA->id], $this->listIds($this->restrictedA));
        $this->assertContains($viaPolicyA->id, $this->listIds($restrictedB), 'طلب بلا حجز يتبع السياسة الحالية');

        // لا سياسة ولا حجز ولا تنفيذ ⇒ لا مخزن فعّال ⇒ غير مرئي لأي مقيَّد (فشل مغلق)، مرئي لغير المقيَّد.
        DB::table('fulfillment_policies')->where('sales_channel_id', $this->channel->id)->delete();
        $this->assertNotContains($viaPolicyA->id, $this->listIds($this->restrictedA));
        $this->assertNotContains($viaPolicyA->id, $this->listIds($restrictedB));
        $this->assertContains($viaPolicyA->id, $this->listIds($this->ownerToken), 'غير المقيَّد يرى كل شيء');
        $this->assertCount(4, array_unique($this->listIds($this->ownerToken)), 'الطلبات الأربعة كلها لغير المقيَّد');
    }

    #[Test]
    public function a_user_restricted_to_several_warehouses_sees_the_union_and_an_unrestricted_user_sees_all(): void
    {
        $inA = $this->order();
        $inB = $this->order();
        $this->hold($inB->id, $this->b->id);
        $both = $this->restrictedTo([$this->a->id, $this->b->id], 'restricted-ab@vis.test');

        $this->assertEqualsCanonicalizing([$inA->id, $inB->id], $this->listIds($both));
        $this->assertEqualsCanonicalizing([$inA->id, $inB->id], $this->listIds($this->ownerToken));
    }

    // ═════════════════════════ 2) الأسطح المفتوحة: التفاصيل والإجراءات والانتباه ═════════════════════════

    #[Test]
    public function details_of_an_out_of_scope_order_are_not_found_and_indistinguishable_from_a_missing_one(): void
    {
        $inA = $this->order();
        $inB = $this->order();
        $this->hold($inB->id, $this->b->id);

        $this->withToken($this->restrictedA)->getJson("/api/commerce/orders/{$inA->id}")->assertOk()->assertJsonPath('data.id', $inA->id);
        $out = $this->withToken($this->restrictedA)->getJson("/api/commerce/orders/{$inB->id}")->assertNotFound();
        $missing = $this->withToken($this->restrictedA)->getJson('/api/commerce/orders/'.Str::uuid())->assertNotFound();
        $this->assertSame($missing->json('message'), $out->json('message'));
    }

    #[Test]
    public function every_action_endpoint_is_scoped_in_scope_works_and_out_of_scope_is_not_found_with_no_change(): void
    {
        $inA = $this->order();
        $inB = $this->order();
        $this->hold($inB->id, $this->b->id);

        // تنفيذ
        $this->fulfil($inB->id, 'start', ['expected_version' => 0], $this->restrictedA)->assertNotFound();
        $this->withToken($this->restrictedA)->patchJson("/api/commerce/orders/{$inB->id}/fulfillment", ['expected_version' => 1, 'carrier_name' => 'x'])->assertNotFound();
        $this->assertNull(DB::table('commerce_order_fulfillments')->where('commerce_order_id', $inB->id)->first());
        $this->fulfil($inA->id, 'start', ['expected_version' => 0], $this->restrictedA)->assertOk()->assertJsonPath('data.fulfillment.status', 'preparing');
        $this->assertSame($this->a->id, DB::table('commerce_order_fulfillments')->where('commerce_order_id', $inA->id)->value('warehouse_id'));

        // إلغاء (الطلب ضمن النطاق: preparing ⇒ مسموح) وخارج النطاق 404.
        $this->withToken($this->restrictedA)->postJson("/api/commerce/orders/{$inB->id}/cancel", ['reason' => 'customer_request'])->assertNotFound();
        $this->assertNull(DB::table('commerce_orders')->where('id', $inB->id)->value('cancelled_at'));
        $this->withToken($this->restrictedA)->postJson("/api/commerce/orders/{$inA->id}/cancel", ['reason' => 'customer_request'])->assertOk();

        // قبول/رفض
        $manual = $this->order(CommerceOrder::ACCEPTANCE_MANUAL);
        $manualB = $this->order(CommerceOrder::ACCEPTANCE_MANUAL);
        $this->hold($manualB->id, $this->b->id);
        $this->withToken($this->restrictedA)->postJson("/api/commerce/orders/{$manualB->id}/accept")->assertNotFound();
        $this->withToken($this->restrictedA)->postJson("/api/commerce/orders/{$manualB->id}/reject", [])->assertNotFound();
        $this->assertNull(DB::table('commerce_orders')->where('id', $manualB->id)->value('accepted_at'));
        $this->withToken($this->restrictedA)->postJson("/api/commerce/orders/{$manual->id}/accept")->assertOk();
    }

    #[Test]
    public function attention_is_scoped_by_the_effective_warehouse_and_the_feed_stays_forbidden(): void
    {
        $inA = $this->order();
        $inB = $this->order();
        $this->hold($inB->id, $this->b->id);

        $ids = array_column(array_column($this->attention($this->restrictedA)->assertOk()->json('data'), 'order'), 'id');
        $this->assertSame([$inA->id], $ids);
        $this->assertEqualsCanonicalizing([$inA->id, $inB->id], array_column(array_column($this->attention()->assertOk()->json('data'), 'order'), 'id'));
        $this->withToken($this->restrictedA)->getJson('/api/commerce/orders/feed')->assertForbidden();
    }

    #[Test]
    public function the_list_filters_and_pagination_compose_with_the_scope(): void
    {
        $inA1 = $this->order();
        $inA2 = $this->order();
        $inB = $this->order();
        $this->hold($inB->id, $this->b->id);
        $this->fulfil($inA1->id, 'start', ['expected_version' => 0])->assertOk();

        $this->assertSame([$inA1->id], $this->listIds($this->restrictedA, '&fulfillment_status=preparing'));
        $this->assertSame([$inA2->id], $this->listIds($this->restrictedA, '&fulfillment_status=not_started'));
        $res = $this->withToken($this->restrictedA)->getJson('/api/commerce/orders?per_page=1&page=2')->assertOk();
        $this->assertSame(2, $res->json('meta.total'), 'الإجمالي ضمن النطاق فقط');
        $this->assertSame(2, $res->json('meta.last_page'));
    }

    // ═════════════════════════ 3) الصلاحيات والعزل ═════════════════════════

    #[Test]
    public function permissions_are_checked_first_and_tenants_never_see_each_others_orders(): void
    {
        $order = $this->order();
        // مقيَّد بلا صلاحية الطلبات (محاسب) ⇒ 403 بالصلاحية لا بالنطاق.
        $accountant = $this->restrictedTo([$this->a->id], 'restricted-acc@vis.test', 'accountant');
        $this->withToken($accountant)->getJson('/api/commerce/orders')->assertForbidden();
        $this->withToken($accountant)->getJson('/api/commerce/orders/attention')->assertForbidden();

        ['tenant' => $other] = $this->makeStore('other-vis.test', 'other-vis');
        $this->enableApplications($other);
        $foreign = $this->token($other, 'owner');
        $this->assertSame([], $this->listIds($foreign));
        $this->withToken($foreign)->getJson("/api/commerce/orders/{$order->id}")->assertNotFound();
        $this->fulfil($order->id, 'start', ['expected_version' => 0], $foreign)->assertNotFound();

        // مخزن من مستأجر آخر لا يمنح رؤية: نطاق بمعرّف مخزن مستأجر آخر ⇒ لا يطابق شيئاً.
        app(TenantContext::class)->set($other->id);
        $foreignWarehouse = Warehouse::create(['name' => 'مخزن غريب', 'code' => 'VIS-X']);
        app(TenantContext::class)->forget();
        app(TenantContext::class)->set($this->tenant->id);
        $this->assertSame(0, CommerceOrderWarehouseScope::apply(CommerceOrder::query(), [$foreignWarehouse->id])->count());
        app(TenantContext::class)->forget();
    }

    #[Test]
    public function the_scope_adds_no_query_per_order_and_never_writes(): void
    {
        foreach (range(1, 3) as $i) {
            $this->order();
        }
        $this->listIds($this->restrictedA); // إحماء: أي تخزين مؤقت أحادي (صلاحيات/مستأجر) لا يُحتسب
        DB::enableQueryLog();
        $this->listIds($this->restrictedA);
        $small = count(DB::getQueryLog());
        foreach (range(1, 8) as $i) {
            $this->order();
        }
        DB::flushQueryLog();
        $this->listIds($this->restrictedA);
        $this->assertSame($small, count(DB::getQueryLog()), 'عدد الاستعلامات ثابت مهما كثرت الطلبات');
        $writes = array_filter(DB::getQueryLog(), fn ($q) => preg_match('/^\s*(insert|update|delete)/i', $q['query']) === 1);
        $this->assertSame([], array_values($writes), 'قراءة فقط');
    }

    #[Test]
    public function the_legacy_payment_intent_cancel_route_stays_forbidden_for_restricted_users(): void
    {
        $order = $this->order();
        $intentId = DB::table('commerce_payment_intents')->where('commerce_order_id', $order->id)->value('id');
        // مسار المدفوعات القديم المفوَّض للإلغاء لم يُفتح (مقصود): يبقى 403 للمقيَّد بمخزن.
        $this->withToken($this->restrictedA)->postJson("/api/commerce/payment-intents/{$intentId}/cancel", ['reason' => 'customer_request'])->assertForbidden();
        $this->assertNull(DB::table('commerce_orders')->where('id', $order->id)->value('cancelled_at'));
    }

    #[Test]
    public function the_empty_scope_helper_matches_nothing_and_null_means_unrestricted(): void
    {
        $this->order();
        app(TenantContext::class)->set($this->tenant->id);
        $this->assertSame(1, CommerceOrderWarehouseScope::apply(CommerceOrder::query(), null)->count());
        $this->assertSame(0, CommerceOrderWarehouseScope::apply(CommerceOrder::query(), [])->count());
        $this->assertInstanceOf(FulfillmentPolicy::class, FulfillmentPolicy::query()->firstOrFail());
    }
}
