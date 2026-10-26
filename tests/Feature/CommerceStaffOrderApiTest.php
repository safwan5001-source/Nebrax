<?php

namespace Tests\Feature;

use App\Models\CommerceOrder;
use App\Models\CommerceOrderLine;
use App\Models\CommercePaymentIntent;
use App\Models\InventoryReservation;
use App\Models\JournalEntry;
use App\Models\Role;
use App\Models\SalesChannel;
use App\Models\StockMovement;
use App\Models\Storefront;
use App\Models\User;
use App\Models\Warehouse;
use App\Support\Rbac;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * COMMERCE-ORDERS-O1a — قراءة طلبات المتجر للموظف: `GET commerce/orders[/{id}]`.
 * تشغيل: php artisan test --filter=CommerceStaffOrderApiTest
 */
class CommerceStaffOrderApiTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    private function seedOrder(string $tenantId, array $o = []): CommerceOrder
    {
        $ctx = app(TenantContext::class);
        $prev = $ctx->id();
        $ctx->set($tenantId);

        $channel = $o['channel'] ?? SalesChannel::query()->first()
            ?? SalesChannel::create(['slug' => 'web', 'name' => 'متجر الويب', 'type' => SalesChannel::TYPE_WEB, 'is_active' => true]);
        $storefront = $o['storefront'] ?? Storefront::query()->first()
            ?? Storefront::create(['slug' => 'main-'.Str::random(5), 'name' => 'المتجر', 'sales_channel_id' => $channel->id, 'is_active' => true]);

        $order = CommerceOrder::create([
            'sales_channel_id' => $channel->id,
            'storefront_id' => $storefront->id,
            'number' => $o['number'] ?? 'CORD-'.Str::upper(Str::random(6)),
            'delivery_method' => $o['delivery_method'] ?? 'standard',
            'total' => $o['total'] ?? 11500,
        ]);
        CommerceOrderLine::create([
            'commerce_order_id' => $order->id, 'product_name_snapshot' => 'وردة', 'quantity' => 2,
            'unit_price' => 5000, 'line_total' => 10000,
        ]);
        $order->snapshot()->create([
            'customer_name' => $o['customer'] ?? 'سارة', 'phone' => $o['phone'] ?? '0500000001',
            'email' => 'buyer@example.test', 'shipping_city' => 'الدمام',
        ]);
        $order->update(['status' => CommerceOrder::STATUS_CONFIRMED, 'confirmed_at' => now()]);
        CommercePaymentIntent::create([
            'commerce_order_id' => $order->id, 'method' => $o['method'] ?? CommercePaymentIntent::METHOD_COD,
            'status' => $o['payment_status'] ?? CommercePaymentIntent::STATUS_AWAITING_COLLECTION,
            'amount_minor' => $order->total, 'currency' => 'SAR',
        ]);

        $prev === null ? $ctx->forget() : $ctx->set($prev);

        return $order->fresh();
    }

    private function owner(string $slug = 'acme', string $email = 'owner@acme.test'): array
    {
        $auth = $this->registerTenant($slug, $email);

        return [$auth['tenant_id'], $auth['token'] ?? $this->tokenForRole($auth['tenant_id'], 'owner', 'o2-'.$email)];
    }

    // ── RBAC ─────────────────────────────────────────────────────────────

    /** @test */
    public function owner_and_admin_can_read_but_accountant_staff_and_self_service_cannot(): void
    {
        [$tenantId, $ownerToken] = $this->owner();
        $order = $this->seedOrder($tenantId);

        $this->withToken($ownerToken)->getJson('/api/commerce/orders')->assertOk()->assertJsonPath('meta.total', 1);
        $admin = $this->tokenForRole($tenantId, 'admin', 'admin@acme.test');
        $this->withToken($admin)->getJson("/api/commerce/orders/{$order->id}")->assertOk();

        foreach (['accountant', 'staff', 'self_service'] as $role) {
            $token = $this->tokenForRole($tenantId, $role, "$role@acme.test");
            $this->withToken($token)->getJson('/api/commerce/orders')->assertForbidden();
            $this->withToken($token)->getJson("/api/commerce/orders/{$order->id}")->assertForbidden();
        }
        $this->flushHeaders()->getJson('/api/commerce/orders')->assertUnauthorized();
    }

    /** @test */
    public function the_permission_is_registered_but_never_implicitly_granted(): void
    {
        $this->assertContains('commerce.orders.view', Rbac::PERMISSIONS);
        foreach (['accountant', 'staff', 'self_service'] as $role) {
            $this->assertNotContains('commerce.orders.view', Rbac::MATRIX[$role]);
            $this->assertFalse(Rbac::allows($role, 'commerce.orders.view'));
        }
        $this->assertTrue(Rbac::allows('owner', 'commerce.orders.view'));
        $this->assertTrue(Rbac::allows('admin', 'commerce.orders.view'));
    }

    /** @test */
    public function a_custom_role_gets_access_only_when_explicitly_granted(): void
    {
        [$tenantId] = $this->owner();
        app(TenantContext::class)->set($tenantId);
        Role::create(['slug' => 'orders_clerk', 'name' => 'موظف طلبات', 'permissions' => ['commerce.orders.view'], 'is_system' => false]);
        Role::create(['slug' => 'other_clerk', 'name' => 'آخر', 'permissions' => ['payments.manage', 'commerce.manage'], 'is_system' => false]);
        app(TenantContext::class)->forget();

        $ok = $this->tokenForRole($tenantId, 'orders_clerk', 'clerk@acme.test');
        $no = $this->tokenForRole($tenantId, 'other_clerk', 'other@acme.test');

        $this->withToken($ok)->getJson('/api/commerce/orders')->assertOk();
        $this->withToken($no)->getJson('/api/commerce/orders')->assertForbidden();
    }

    /** @test */
    public function a_disabled_commerce_capability_blocks_the_routes(): void
    {
        [$tenantId, $token] = $this->owner();
        $order = $this->seedOrder($tenantId);
        app(TenantContext::class)->set($tenantId);
        app(\App\Services\TenantApplicationService::class)->disable('commerce.storefront', User::query()->first());
        app(TenantContext::class)->forget();

        $this->withToken($token)->getJson('/api/commerce/orders')->assertForbidden();
        $this->withToken($token)->getJson("/api/commerce/orders/{$order->id}")->assertForbidden();
    }

    // ── العزل / IDOR ─────────────────────────────────────────────────────

    /** @test */
    public function another_tenants_orders_are_invisible_and_idor_returns_404(): void
    {
        [$tenantA, $tokenA] = $this->owner('tenant-a', 'a@a.test');
        [$tenantB, $tokenB] = $this->owner('tenant-b', 'b@b.test');
        $orderA = $this->seedOrder($tenantA, ['number' => 'CORD-A']);
        $orderB = $this->seedOrder($tenantB, ['number' => 'CORD-B']);

        $list = $this->withToken($tokenA)->getJson('/api/commerce/orders')->assertOk();
        $this->assertSame(['CORD-A'], collect($list->json('data'))->pluck('number')->all());

        $this->withToken($tokenA)->getJson("/api/commerce/orders/{$orderB->id}")->assertNotFound();
        $this->withToken($tokenA)->getJson('/api/commerce/orders/'.Str::uuid())->assertNotFound();
        $this->withToken($tokenA)->getJson('/api/commerce/orders/not-a-uuid')->assertNotFound();
        $this->withToken($tokenB)->getJson("/api/commerce/orders/{$orderA->id}")->assertNotFound();
        // معرّف مستأجر مُرسَل من العميل لا يُقرأ.
        $this->withToken($tokenA)->getJson("/api/commerce/orders?tenant_id={$tenantB}")->assertOk()
            ->assertJsonPath('meta.total', 1);
    }

    // ── المقيَّد بمخازن ──────────────────────────────────────────────────

    /** @test */
    public function a_warehouse_restricted_user_is_rejected_even_with_the_permission(): void
    {
        [$tenantId] = $this->owner();
        $order = $this->seedOrder($tenantId);
        $token = $this->tokenForRole($tenantId, 'admin', 'restricted@acme.test');
        app(TenantContext::class)->set($tenantId);
        $warehouse = Warehouse::create(['name' => 'مخزن', 'code' => 'WH-R', 'is_default' => false]);
        User::where('email', 'restricted@acme.test')->firstOrFail()->warehouses()->attach($warehouse->id);
        app(TenantContext::class)->forget();

        $this->withToken($token)->getJson('/api/commerce/orders')->assertForbidden();
        $this->withToken($token)->getJson("/api/commerce/orders/{$order->id}")->assertForbidden();
    }

    // ── البحث والفلاتر والفرز والترقيم ───────────────────────────────────

    /** @test */
    public function search_filters_sorting_and_pagination_work_and_are_bounded(): void
    {
        [$tenantId, $token] = $this->owner();
        $a = $this->seedOrder($tenantId, ['number' => 'CORD-100', 'customer' => 'سارة', 'phone' => '0501111111', 'total' => 3000]);
        $b = $this->seedOrder($tenantId, ['number' => 'CORD-200', 'customer' => 'خالد', 'phone' => '0502222222', 'total' => 9000,
            'method' => CommercePaymentIntent::METHOD_ONLINE, 'payment_status' => CommercePaymentIntent::STATUS_PAID, 'delivery_method' => 'pickup']);
        $c = $this->seedOrder($tenantId, ['number' => 'CORD-300', 'customer' => 'منى', 'total' => 6000]);

        $numbers = fn ($r) => collect($r->json('data'))->pluck('number')->all();
        $get = fn (string $qs) => $this->withToken($token)->getJson('/api/commerce/orders?'.$qs);

        $this->assertSame(['CORD-200'], $numbers($get('q=خالد')->assertOk()));
        $this->assertSame(['CORD-100'], $numbers($get('q=0501111')->assertOk()));
        $this->assertSame(['CORD-300'], $numbers($get('q=CORD-300')->assertOk()));
        $this->assertSame([], $numbers($get('q=%25%25')->assertOk()), 'wildcards are escaped');
        $this->assertSame(['CORD-200'], $numbers($get('payment_status=paid')->assertOk()));
        $this->assertSame(['CORD-200'], $numbers($get('payment_method=online')->assertOk()));
        $this->assertSame(['CORD-200'], $numbers($get('delivery_method=pickup')->assertOk()));
        $this->assertSame(['CORD-300', 'CORD-100'], $numbers($get('payment_status=awaiting_collection&sort=total&direction=desc')->assertOk()));
        $this->assertSame(['CORD-100', 'CORD-200', 'CORD-300'], $numbers($get('sort=number&direction=asc')->assertOk()));
        $this->assertCount(3, $get('from='.now()->toDateString().'&to='.now()->toDateString())->json('data'));
        $this->assertSame([], $numbers($get('to='.now()->subDays(2)->toDateString())->assertOk()));

        $page = $get('sort=number&direction=asc&per_page=2&page=2')->assertOk();
        $this->assertSame(['CORD-300'], $numbers($page));
        $page->assertJsonPath('meta.total', 3)->assertJsonPath('meta.last_page', 2)->assertJsonPath('meta.per_page', 2);

        // قائمة بيضاء: أعمدة/قيم غير مصرح بها ⇒ 422 لا تنفيذ.
        foreach (['sort=tenant_id', 'sort=customer_identity_id', 'sort=id;drop', 'status=hacked', 'payment_status=x',
            'per_page=1000', 'per_page=0', 'q=a', 'storefront_id=nope', 'direction=sideways'] as $bad) {
            $get($bad)->assertStatus(422);
        }
    }

    /** @test */
    public function the_list_does_not_n_plus_one(): void
    {
        [$tenantId, $token] = $this->owner();
        $this->seedOrder($tenantId);
        $count = function () use ($token): int {
            DB::flushQueryLog();
            DB::enableQueryLog();
            $this->withToken($token)->getJson('/api/commerce/orders?per_page=50')->assertOk();
            $n = count(DB::getQueryLog());
            DB::disableQueryLog();

            return $n;
        };
        $count(); // warm-up: per-process caches (settings/capabilities) must not skew the comparison
        $one = $count();
        for ($i = 0; $i < 6; $i++) {
            $this->seedOrder($tenantId);
        }
        $this->assertSame($one, $count(), 'query count must not grow with the number of orders');
    }

    // ── الشكل ومنع التسريب ───────────────────────────────────────────────

    /** @test */
    public function detail_exposes_staff_data_but_no_internal_fields(): void
    {
        [$tenantId, $token] = $this->owner();
        $order = $this->seedOrder($tenantId);

        $res = $this->withToken($token)->getJson("/api/commerce/orders/{$order->id}")->assertOk();
        $res->assertJsonPath('data.number', $order->number)
            ->assertJsonPath('data.status', 'confirmed')
            ->assertJsonPath('data.total.amount_minor', 11500)
            ->assertJsonPath('data.total.currency', 'SAR')
            ->assertJsonPath('data.contact.email', 'buyer@example.test')
            ->assertJsonPath('data.shipping_address.city', 'الدمام')
            ->assertJsonPath('data.items.0.product_name', 'وردة')
            ->assertJsonPath('data.items.0.quantity', 2)
            ->assertJsonPath('data.payment.status', 'awaiting_collection')
            ->assertJsonPath('data.channel.sales_channel_name', 'متجر الويب')
            ->assertJsonPath('data.accounting.posted', false);

        $json = json_encode($res->json());
        foreach (['tenant_id', 'customer_identity_id', 'commerce_checkout_id', 'idempotency', 'secret', 'password', 'token'] as $leak) {
            $this->assertStringNotContainsString($leak, $json, "response must not expose {$leak}");
        }
    }

    // ── لا آثار جانبية ───────────────────────────────────────────────────

    /** @test */
    public function reading_changes_nothing_and_creates_no_ledger_stock_or_reservation_effects(): void
    {
        [$tenantId, $token] = $this->owner();
        $order = $this->seedOrder($tenantId);

        $snapshot = fn () => [
            'orders' => DB::table('commerce_orders')->get()->toJson(),
            'intents' => DB::table('commerce_payment_intents')->get()->toJson(),
            'journal' => JournalEntry::withoutGlobalScopes()->count(),
            'stock' => StockMovement::withoutGlobalScopes()->count(),
            'reservations' => InventoryReservation::withoutGlobalScopes()->count(),
        ];
        $before = $snapshot();

        $this->withToken($token)->getJson('/api/commerce/orders')->assertOk();
        $this->withToken($token)->getJson("/api/commerce/orders/{$order->id}")->assertOk();

        $this->assertSame($before, $snapshot());
    }

    /** @test */
    public function no_write_routes_exist_and_the_code_calls_no_write_services(): void
    {
        [$tenantId, $token] = $this->owner();
        $order = $this->seedOrder($tenantId);
        foreach (['postJson', 'putJson', 'patchJson', 'deleteJson'] as $verb) {
            $this->withToken($token)->{$verb}("/api/commerce/orders/{$order->id}")->assertStatus(405);
        }

        $src = file_get_contents(app_path('Http/Controllers/Api/CommerceStaffOrderController.php'))
            .file_get_contents(app_path('Support/CommerceOrderStaffSerializer.php'));
        foreach (['LedgerService', 'InvoiceService', 'PaymentService', 'InventoryService', 'InventoryReservationService',
            'CommerceOrderReservationService', 'CommercePaymentIntentService', 'CommerceOrderService', '->update(', '->save(',
            '->delete(', '::create(', 'DB::table'] as $forbidden) {
            $this->assertStringNotContainsString($forbidden, $src, "read-only code must not use {$forbidden}");
        }
    }

    /** @test */
    public function an_online_order_detail_lists_its_payment_attempts_and_only_its_own(): void
    {
        [$tenantId, $token] = $this->owner();
        $order = $this->seedOrder($tenantId, ['method' => CommercePaymentIntent::METHOD_ONLINE, 'payment_status' => CommercePaymentIntent::STATUS_PENDING]);
        $other = $this->seedOrder($tenantId, ['method' => CommercePaymentIntent::METHOD_ONLINE, 'payment_status' => CommercePaymentIntent::STATUS_PENDING]);

        app(TenantContext::class)->set($tenantId);
        $gateway = \App\Models\PaymentGateway::query()->create(['provider' => 'fake', 'name' => 'Fake', 'environment' => 'sandbox']);
        foreach ([$order, $other] as $i => $o) {
            \App\Models\PaymentAttempt::create([
                'payment_gateway_id' => $gateway->id, 'provider' => 'fake', 'environment' => 'sandbox',
                'payable_key' => $o->paymentIntent->payableKey(), 'idempotency_key' => "k-$i",
                'amount_minor' => 11500, 'currency' => 'SAR',
            ]);
        }
        app(TenantContext::class)->forget();

        $res = $this->withToken($token)->getJson("/api/commerce/orders/{$order->id}")->assertOk();
        $this->assertCount(1, $res->json('data.payment.attempts'));
        $res->assertJsonPath('data.payment.attempts.0.capture_status', 'created')
            ->assertJsonPath('data.payment.attempts.0.amount.amount_minor', 11500);
        $this->assertStringNotContainsString('idempotency', json_encode($res->json()));
    }

    /** @test */
    public function the_public_buyer_serializer_is_unchanged(): void
    {
        $this->assertNotContains('commerce.orders', array_keys(\App\Services\AppBuilder\DataResourceRegistry::RESOURCES));
        $this->assertTrue(class_exists(\App\Support\CommerceOrderSerializer::class));
        $this->assertFalse(method_exists(\App\Support\CommerceOrderSerializer::class, 'summary'));
    }
}
