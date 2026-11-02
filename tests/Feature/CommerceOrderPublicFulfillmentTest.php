<?php

namespace Tests\Feature;

use App\Support\CommerceOrderPublicFulfillment;
use App\Support\CommerceOrderSerializer;
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
 *  COPS-H2-4 (D-H2-13/14) — كتلة التنفيذ العامة في قراءة الطلب للمشتري
 * ═══════════════════════════════════════════════════════════════
 *  قائمة بيضاء حرفية · غياب المفتاح لطلب بلا صف أو ملغى (الشكل القديم بايتاً) · `delivery_failed`/`returned_to_store` ⇒ `delivery_attempt_failed`
 *  بلا سبب/عدد · التتبع للناقل بعد الإرسال فقط · الاستلام `ready_at` · لا ساعي/موظف/مخزن/ملاحظة/نسخة · إغلاق البوابة لا يُخفي (AR-3) · لا قوائم.
 */
class CommerceOrderPublicFulfillmentTest extends TestCase
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


    private function patchDetails(string $orderId, array $body)
    {
        return $this->withToken($this->ownerToken)->patchJson("/api/commerce/orders/{$orderId}/fulfillment", $body);
    }

    private function publicBlock(string $orderId): array
    {
        app(TenantContext::class)->set($this->tenant->id);
        $order = CommerceOrder::query()->findOrFail($orderId);
        $payload = CommerceOrderSerializer::serialize($order);
        app(TenantContext::class)->forget();

        return $payload;
    }

    private function step(string $orderId, string $action, array $body = []): void
    {
        $version = (int) (CommerceOrderFulfillment::query()->withoutGlobalScopes()->where('commerce_order_id', $orderId)->value('version') ?? 0);
        $this->act($orderId, $action, ['expected_version' => $version] + $body)->assertOk();
    }

    #[Test]
    public function an_order_without_a_fulfillment_row_has_no_fulfillment_key(): void
    {
        $order = $this->order();
        $payload = $this->publicBlock($order->id);

        $this->assertArrayNotHasKey('fulfillment', $payload);
        $this->assertSame('confirmed', $payload['status']);
    }

    #[Test]
    public function the_block_is_exactly_the_approved_whitelist_for_a_local_delivery(): void
    {
        $order = $this->order();
        $this->step($order->id, 'start');
        $this->step($order->id, 'mark_ready');
        $this->patchDetails($order->id, ['expected_version' => 2, 'courier_name' => 'خالد', 'courier_phone' => '0500000009'])->assertOk();
        $this->step($order->id, 'dispatch');

        $block = $this->publicBlock($order->id)['fulfillment'];

        $this->assertSame(['pickup', 'stage', 'stages', 'tracking', 'type'], collect(array_keys($block))->sort()->values()->all());
        $this->assertSame('local_delivery', $block['type']);
        $this->assertSame('out_for_delivery', $block['stage']);
        $this->assertNull($block['tracking']);
        $this->assertNull($block['pickup']);
        $this->assertSame(['placed', 'preparing', 'ready', 'out_for_delivery'], array_column($block['stages'], 'key'));
        foreach ($block['stages'] as $stage) {
            $this->assertSame(['at', 'key'], collect(array_keys($stage))->sort()->values()->all());
        }
        $encoded = json_encode($block, JSON_UNESCAPED_UNICODE);
        foreach (['خالد', '0500000009', 'مخزن المتجر', 'FUL-W1', 'courier', 'warehouse', 'version', 'attempt', 'note', 'reason'] as $forbidden) {
            $this->assertStringNotContainsString($forbidden, (string) $encoded);
        }
    }

    #[Test]
    public function a_carrier_shipment_exposes_tracking_only_after_dispatch(): void
    {
        $order = $this->order();
        $this->step($order->id, 'start');
        $this->step($order->id, 'mark_ready');
        $this->patchDetails($order->id, ['expected_version' => 2, 'type' => 'carrier', 'carrier_name' => 'سمسا', 'tracking_number' => 'T-1', 'tracking_url' => 'https://track.example.test/T-1'])->assertOk();

        $this->assertNull($this->publicBlock($order->id)['fulfillment']['tracking']);

        $this->step($order->id, 'dispatch');
        $block = $this->publicBlock($order->id)['fulfillment'];
        $this->assertSame('carrier', $block['type']);
        $this->assertSame(['carrier' => 'سمسا', 'number' => 'T-1', 'url' => 'https://track.example.test/T-1'], $block['tracking']);
    }

    #[Test]
    public function a_pickup_order_exposes_ready_at_and_ends_as_picked_up(): void
    {
        $order = $this->order(delivery: 'pickup');
        $this->step($order->id, 'start');
        $this->assertNull($this->publicBlock($order->id)['fulfillment']['pickup']);

        $this->step($order->id, 'mark_ready');
        $block = $this->publicBlock($order->id)['fulfillment'];
        $this->assertSame('pickup', $block['type']);
        $this->assertSame('ready', $block['stage']);
        $this->assertNotNull($block['pickup']['ready_at']);
        $this->assertNull($block['tracking']);

        $this->step($order->id, 'pickup');
        $block = $this->publicBlock($order->id)['fulfillment'];
        $this->assertSame('picked_up', $block['stage']);
        $this->assertSame(['placed', 'preparing', 'ready', 'picked_up'], array_column($block['stages'], 'key'));
    }

    #[Test]
    public function a_failed_delivery_and_a_return_both_read_as_delivery_attempt_failed_without_reason_or_attempts(): void
    {
        $order = $this->order();
        foreach (['start', 'mark_ready', 'dispatch'] as $action) {
            $this->step($order->id, $action);
        }
        $this->step($order->id, 'fail', ['reason' => 'address_issue', 'note' => 'العنوان غير صحيح']);

        $failed = $this->publicBlock($order->id)['fulfillment'];
        $this->assertSame(CommerceOrderPublicFulfillment::STAGE_ATTEMPT_FAILED, $failed['stage']);
        $this->assertSame('delivery_attempt_failed', end($failed['stages'])['key']);

        $this->step($order->id, 'return');
        $returned = $this->publicBlock($order->id)['fulfillment'];
        $this->assertSame('delivery_attempt_failed', $returned['stage']);

        $encoded = (string) json_encode([$failed, $returned], JSON_UNESCAPED_UNICODE);
        foreach (['address_issue', 'العنوان غير صحيح', 'returned', 'delivery_attempts', 'attempt"'] as $forbidden) {
            $this->assertStringNotContainsString($forbidden, $encoded);
        }

        // إعادة المحاولة ⇒ تعود المرحلة العامة إلى «خرج للتوصيل» بلا أثر للفشل.
        $this->step($order->id, 'dispatch');
        $retry = $this->publicBlock($order->id)['fulfillment'];
        $this->assertSame('out_for_delivery', $retry['stage']);
        $this->assertNotContains('delivery_attempt_failed', array_column($retry['stages'], 'key'));
    }

    #[Test]
    public function a_delivered_order_ends_as_delivered(): void
    {
        $order = $this->order();
        foreach (['start', 'mark_ready', 'dispatch', 'deliver'] as $action) {
            $this->step($order->id, $action);
        }
        $block = $this->publicBlock($order->id)['fulfillment'];
        $this->assertSame('delivered', $block['stage']);
        $this->assertSame('delivered', end($block['stages'])['key']);
    }

    #[Test]
    public function the_accepted_stage_appears_only_for_manually_accepted_orders(): void
    {
        $auto = $this->order();
        $this->step($auto->id, 'start');
        $this->assertNotContains('accepted', array_column($this->publicBlock($auto->id)['fulfillment']['stages'], 'key'));

        $manual = $this->order(mode: CommerceOrder::ACCEPTANCE_MANUAL);
        $this->withToken($this->ownerToken)->postJson("/api/commerce/orders/{$manual->id}/accept")->assertOk();
        $this->step($manual->id, 'start');
        $keys = array_column($this->publicBlock($manual->id)['fulfillment']['stages'], 'key');
        $this->assertSame(['placed', 'accepted', 'preparing'], $keys);
    }

    #[Test]
    public function a_cancelled_order_has_no_block_even_with_a_preparing_row(): void
    {
        $order = $this->order();
        $this->step($order->id, 'start');
        $this->assertArrayHasKey('fulfillment', $this->publicBlock($order->id));

        $this->withToken($this->ownerToken)->postJson("/api/commerce/orders/{$order->id}/cancel", ['reason' => 'customer_request'])->assertOk();

        $payload = $this->publicBlock($order->id);
        $this->assertSame('cancelled', $payload['status']);
        $this->assertArrayNotHasKey('fulfillment', $payload);
        $this->assertArrayHasKey('cancellation', $payload);
    }

    #[Test]
    public function closing_the_gate_does_not_hide_stored_fulfillment_facts(): void
    {
        $order = $this->order();
        $this->step($order->id, 'start');
        config(['commerce.order_fulfillment_enabled' => false]);

        $this->assertSame('preparing', $this->publicBlock($order->id)['fulfillment']['stage']);
    }

    #[Test]
    public function the_order_payload_keeps_every_legacy_key_and_only_adds_fulfillment(): void
    {
        $order = $this->order();
        $legacy = array_keys($this->publicBlock($order->id));
        $this->step($order->id, 'start');
        $withBlock = array_keys($this->publicBlock($order->id));

        $this->assertSame(['fulfillment'], array_values(array_diff($withBlock, $legacy)));
        $this->assertSame($legacy, array_values(array_diff($withBlock, ['fulfillment'])));
    }

    #[Test]
    public function the_projector_is_read_only_and_never_references_internal_fields(): void
    {
        $source = (string) file_get_contents(app_path('Support/CommerceOrderPublicFulfillment.php'));
        foreach (['courier_name', 'courier_phone', 'warehouse', 'last_failure', 'delivery_attempts', 'created_by', 'updated_by', '->save(', '->update(', 'DB::', 'Event::', 'dispatch('] as $forbidden) {
            $this->assertStringNotContainsString($forbidden, $source, "الإسقاط العام يجب ألا يذكر {$forbidden}");
        }
    }

    #[Test]
    public function the_openapi_schema_matches_the_emitted_block_keys_and_stage_vocabulary(): void
    {
        $spec = \Symfony\Component\Yaml\Yaml::parseFile(base_path('docs/openapi/commerce-api-v1.yaml'));
        $schema = $spec['components']['schemas']['OrderFulfillment'];
        $order = $this->order();
        foreach (['start', 'mark_ready', 'dispatch', 'fail', 'return', 'dispatch', 'deliver'] as $action) {
            $this->step($order->id, $action, $action === 'fail' ? ['reason' => 'other'] : []);
            $block = $this->publicBlock($order->id)['fulfillment'] ?? null;
            $this->assertNotNull($block);
            $this->assertEqualsCanonicalizing(array_keys($schema['properties']), array_keys($block));
            $this->assertContains($block['stage'], $schema['properties']['stage']['enum']);
            foreach ($block['stages'] as $stage) {
                $this->assertContains($stage['key'], $schema['properties']['stages']['items']['properties']['key']['enum']);
            }
        }
        $this->assertSame($schema['required'], ['type', 'stage', 'stages', 'tracking', 'pickup']);
        $this->assertArrayHasKey('fulfillment', $spec['components']['schemas']['Order']['properties']);
        $this->assertNotContains('fulfillment', $spec['components']['schemas']['Order']['required']);
    }
}
