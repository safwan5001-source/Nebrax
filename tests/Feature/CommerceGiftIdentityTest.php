<?php

namespace Tests\Feature;

use App\Models\CommerceCheckoutGift;
use App\Models\CommerceGiftSetting;
use App\Models\CommerceListing;
use App\Models\CommerceOrder;
use App\Models\CommerceOrderGift;
use App\Models\Partner;
use App\Models\Product;
use App\Models\SalesChannel;
use App\Models\Storefront;
use App\Models\StorefrontDomain;
use App\Models\Tenant;
use App\Services\ApiClientKeyService;
use App\Services\Commerce\CommerceCartService;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Illuminate\Testing\TestResponse;
use LogicException;
use Tests\TestCase;

/**
 * FLOWERS-H3 / ADR-15 — هوية الإهداء ورسالته: فصل المشتري/المستلم/المُرسِل المعروض،
 * سياسة القناة، تنظيف الرسالة، إعادة التحقق عند الإتمام، لقطة ثابتة، العزل،
 * وعدم تغيّر سلوك المتاجر العامة.
 *
 * تشغيل: php artisan test --filter=CommerceGiftIdentityTest
 */
class CommerceGiftIdentityTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    private const TOKEN_HEADER = 'X-Cart-Token';

    private const SECRET = 'gift-gateway-secret';

    // ── scaffolding: mobile (commerce/v1) ───────────────────────────────

    /** @return array{tenant: Tenant, channel: SalesChannel, token: string} */
    private function mobileStore(string $slug): array
    {
        $tenant = Tenant::create([
            'name' => "متجر {$slug}", 'slug' => $slug.'-'.Str::random(6),
            'vat_number' => '300000000000003', 'currency' => 'SAR', 'is_active' => true,
        ]);
        app(TenantContext::class)->set($tenant->id);
        $channel = SalesChannel::create(['slug' => 'mobile', 'name' => 'جوال', 'type' => SalesChannel::TYPE_MOBILE, 'is_active' => true]);
        app(TenantContext::class)->forget();

        $service = app(ApiClientKeyService::class);
        $token = $service->issueKey($service->createClient($tenant, 'mobile-app', true), 'default', [])->plainTextToken;

        return ['tenant' => $tenant, 'channel' => $channel, 'token' => $token];
    }

    private function product(Tenant $tenant, SalesChannel $channel): Product
    {
        app(TenantContext::class)->set($tenant->id);
        $product = Product::create(['name' => 'باقة ورد', 'sku' => 'G-'.Str::random(6), 'unit' => 'piece', 'sale_price' => 15000, 'is_active' => true]);
        CommerceListing::create(['product_id' => $product->id, 'sales_channel_id' => $channel->id, 'is_published' => true]);
        app(TenantContext::class)->forget();

        return $product;
    }

    private function enableGifts(Tenant $tenant, SalesChannel $channel, array $over = []): void
    {
        app(TenantContext::class)->set($tenant->id);
        CommerceGiftSetting::create(array_merge(['sales_channel_id' => $channel->id, 'is_enabled' => true], $over));
        app(TenantContext::class)->forget();
    }

    /** @return array{store: array, cart: string} */
    private function readyMobileCheckout(string $slug, array $settings = ['enabled' => true]): array
    {
        $store = $this->mobileStore($slug);
        $product = $this->product($store['tenant'], $store['channel']);
        if ($settings['enabled'] ?? false) {
            $this->enableGifts($store['tenant'], $store['channel'], $settings['over'] ?? []);
        }
        $bearer = ['Authorization' => 'Bearer '.$store['token']];
        $cart = $this->withHeaders($bearer)->postJson('/commerce/v1/cart/items', ['product_id' => $product->id, 'quantity' => 1])
            ->assertCreated()->headers->get(self::TOKEN_HEADER);
        $h = fn () => $this->withHeaders($bearer + [self::TOKEN_HEADER => $cart]);
        $h()->postJson('/commerce/v1/checkout', [])->assertCreated();
        $h()->patchJson('/commerce/v1/checkout/contact', ['name' => 'سالم المشتري', 'phone' => '0501111111', 'email' => 'buyer@example.com'])->assertOk();
        $h()->patchJson('/commerce/v1/checkout/address', ['country' => 'SA', 'city' => 'الدمام', 'street' => 'شارع الملك فهد'])->assertOk();
        $h()->patchJson('/commerce/v1/checkout/delivery', ['method' => 'pickup'])->assertOk();

        return ['store' => $store, 'cart' => $cart];
    }

    private function mobile(array $ctx, string $method, string $path, array $body = []): TestResponse
    {
        $headers = ['Authorization' => 'Bearer '.$ctx['store']['token'], self::TOKEN_HEADER => $ctx['cart']];

        return $this->withHeaders($headers)->json($method, '/commerce/v1/'.$path, $body);
    }

    private function completeMobile(array $ctx, string $key = 'gift-key-0001'): TestResponse
    {
        $headers = ['Authorization' => 'Bearer '.$ctx['store']['token'], self::TOKEN_HEADER => $ctx['cart'], 'Idempotency-Key' => $key];

        return $this->withHeaders($headers)->postJson('/commerce/v1/checkout/complete', []);
    }

    private function orderRow(string $tenantId, string $orderId): CommerceOrder
    {
        app(TenantContext::class)->set($tenantId);
        $order = CommerceOrder::query()->with(['snapshot', 'gift'])->findOrFail($orderId);
        app(TenantContext::class)->forget();

        return $order;
    }

    // ── policy ──────────────────────────────────────────────────────────

    /** @test */
    public function gifts_are_disabled_by_default_and_a_gift_payload_is_refused(): void
    {
        $ctx = $this->readyMobileCheckout('gift-off', ['enabled' => false]);

        $res = $this->mobile($ctx, 'PATCH', 'checkout/gift', ['recipient_name' => 'نورة', 'recipient_phone' => '0502222222'])->assertStatus(422);
        $this->assertStringContainsString('الإهداء', json_encode($res->json(), JSON_UNESCAPED_UNICODE));
        $this->assertSame(0, CommerceCheckoutGift::withoutGlobalScopes()->count());

        $checkout = $this->mobile($ctx, 'GET', 'checkout')->assertOk();
        $this->assertFalse($checkout->json('data.gift_options.enabled'));
        $this->assertNull($checkout->json('data.gift'));
    }

    /** @test */
    public function clearing_a_gift_is_always_allowed_even_when_disabled(): void
    {
        $ctx = $this->readyMobileCheckout('gift-clear');
        $this->mobile($ctx, 'PATCH', 'checkout/gift', ['recipient_name' => 'نورة', 'recipient_phone' => '0502222222'])->assertOk();

        app(TenantContext::class)->set($ctx['store']['tenant']->id);
        CommerceGiftSetting::query()->update(['is_enabled' => false]);
        app(TenantContext::class)->forget();

        $res = $this->mobile($ctx, 'PATCH', 'checkout/gift', ['is_gift' => false])->assertOk();
        $this->assertNull($res->json('data.gift'));
        $this->assertSame(0, CommerceCheckoutGift::withoutGlobalScopes()->count());
    }

    // ── checkout gift context ───────────────────────────────────────────

    /** @test */
    public function the_gift_context_keeps_purchaser_recipient_and_sender_separate(): void
    {
        $ctx = $this->readyMobileCheckout('gift-ctx');

        $res = $this->mobile($ctx, 'PATCH', 'checkout/gift', [
            'recipient_name' => 'نورة العلي', 'recipient_phone' => '0502222222',
            'sender_name' => 'من صديقك المقرّب', 'hide_sender' => true, 'message' => "كل عام وأنتِ بخير 🌹\nمع حبي",
        ])->assertOk();

        $this->assertSame('سالم المشتري', $res->json('data.contact.name'));
        $this->assertSame('نورة العلي', $res->json('data.gift.recipient_name'));
        $this->assertSame('من صديقك المقرّب', $res->json('data.gift.sender_display_name'));
        $this->assertTrue($res->json('data.gift.hide_sender'));
        $this->assertSame("كل عام وأنتِ بخير 🌹\nمع حبي", $res->json('data.gift.message'));
        $this->assertSame(250, $res->json('data.gift_options.message_max_length'));
    }

    /** @test */
    public function partial_updates_keep_other_gift_fields_and_unknown_fields_are_rejected(): void
    {
        $ctx = $this->readyMobileCheckout('gift-partial');
        $this->mobile($ctx, 'PATCH', 'checkout/gift', ['recipient_name' => 'نورة', 'recipient_phone' => '0502222222', 'message' => 'أهلاً'])->assertOk();

        $res = $this->mobile($ctx, 'PATCH', 'checkout/gift', ['message' => 'رسالة جديدة'])->assertOk();
        $this->assertSame('نورة', $res->json('data.gift.recipient_name'));
        $this->assertSame('رسالة جديدة', $res->json('data.gift.message'));

        $this->mobile($ctx, 'PATCH', 'checkout/gift', ['bogus' => 'x'])->assertStatus(422);
        $this->mobile($ctx, 'PATCH', 'checkout/gift', ['total' => 1])->assertStatus(422);
        $this->mobile($ctx, 'PATCH', 'checkout/gift', ['recipient_phone' => 'abc'])->assertStatus(422);
    }

    /** @test */
    public function messages_are_sanitized_and_bounded_by_the_channel_policy(): void
    {
        $ctx = $this->readyMobileCheckout('gift-msg', ['enabled' => true, 'over' => ['message_max_length' => 20]]);

        // أحرف تحكم وعناصر عكس الاتجاه تُزال؛ HTML يبقى نصاً حرفياً (لا تفسير).
        $res = $this->mobile($ctx, 'PATCH', 'checkout/gift', [
            'recipient_name' => "ن\u{202E}ورة\x07", 'recipient_phone' => '0502222222', 'message' => "a<b>\r\nc\u{2066}d\x00",
        ])->assertOk();
        $this->assertSame('نورة', $res->json('data.gift.recipient_name'));
        $this->assertSame("a<b>\ncd", $res->json('data.gift.message'));

        // الطول بعدد المحارف لا البايتات: 20 حرفاً عربياً مقبولة، 21 مرفوضة.
        $this->mobile($ctx, 'PATCH', 'checkout/gift', ['message' => str_repeat('م', 20)])->assertOk();
        $this->mobile($ctx, 'PATCH', 'checkout/gift', ['message' => str_repeat('م', 21)])->assertStatus(422);
        // أسطر زائدة
        $this->mobile($ctx, 'PATCH', 'checkout/gift', ['message' => str_repeat("\nx", 8)])->assertStatus(422);
    }

    /** @test */
    public function hiding_the_sender_can_be_forbidden_by_policy(): void
    {
        $ctx = $this->readyMobileCheckout('gift-hide', ['enabled' => true, 'over' => ['allow_hide_sender' => false]]);

        $this->mobile($ctx, 'PATCH', 'checkout/gift', ['recipient_name' => 'نورة', 'recipient_phone' => '0502222222', 'hide_sender' => true])->assertStatus(422);
        $this->mobile($ctx, 'PATCH', 'checkout/gift', ['recipient_name' => 'نورة', 'recipient_phone' => '0502222222', 'hide_sender' => false])->assertOk();
    }

    // ── completion ──────────────────────────────────────────────────────

    /** @test */
    public function completion_snapshots_the_gift_and_routes_delivery_to_the_recipient_not_the_purchaser(): void
    {
        $ctx = $this->readyMobileCheckout('gift-complete');
        $this->mobile($ctx, 'PATCH', 'checkout/gift', [
            'recipient_name' => 'نورة العلي', 'recipient_phone' => '0502222222', 'sender_name' => 'سالم', 'message' => 'مبروك التخرج',
        ])->assertOk();

        $res = $this->completeMobile($ctx)->assertCreated();
        $order = $this->orderRow($ctx['store']['tenant']->id, $res->json('data.order.id'));

        // المشتري يبقى جهة الاتصال؛ المستلم هو شحن اللقطة الموجودة أصلاً.
        $this->assertSame('سالم المشتري', $order->snapshot->contact_name);
        $this->assertSame('0501111111', $order->snapshot->phone);
        $this->assertSame('نورة العلي', $order->snapshot->shipping_recipient_name);
        $this->assertSame('0502222222', $order->snapshot->shipping_phone);
        $this->assertSame('مبروك التخرج', $order->gift->message);
        $this->assertSame('سالم', $order->gift->sender_display_name);

        $this->assertSame('مبروك التخرج', $res->json('data.order.gift.message'));
        $this->assertSame('نورة العلي', $res->json('data.order.gift.recipient_name'));

        // لا مستلم ⇒ لا طرف ERP.
        $this->assertSame(0, Partner::withoutGlobalScopes()->count());
    }

    /** @test */
    public function a_non_gift_order_is_byte_identical_to_the_legacy_behaviour(): void
    {
        $ctx = $this->readyMobileCheckout('gift-none', ['enabled' => false]);

        $res = $this->completeMobile($ctx)->assertCreated();
        $order = $this->orderRow($ctx['store']['tenant']->id, $res->json('data.order.id'));

        $this->assertNull($order->gift);
        $this->assertNull($res->json('data.order.gift'));
        $this->assertSame('سالم المشتري', $order->snapshot->shipping_recipient_name);
        $this->assertSame('0501111111', $order->snapshot->shipping_phone);
    }

    /** @test */
    public function completion_refuses_an_incomplete_or_no_longer_allowed_gift_and_creates_no_order(): void
    {
        $ctx = $this->readyMobileCheckout('gift-review');
        $this->mobile($ctx, 'PATCH', 'checkout/gift', ['sender_name' => 'سالم', 'message' => 'x'])->assertOk(); // بلا مستلم

        $res = $this->completeMobile($ctx)->assertStatus(409);
        $this->assertSame('review_required', $res->json('error.code'));
        $this->assertSame('gift_incomplete', $res->json('error.details.items.0.reason'));
        $this->assertSame(0, CommerceOrder::withoutGlobalScopes()->count());

        // مكتمل ثم يعطّل التاجر الإهداء قبل الإتمام
        $this->mobile($ctx, 'PATCH', 'checkout/gift', ['recipient_name' => 'نورة', 'recipient_phone' => '0502222222'])->assertOk();
        app(TenantContext::class)->set($ctx['store']['tenant']->id);
        CommerceGiftSetting::query()->update(['is_enabled' => false]);
        app(TenantContext::class)->forget();

        $res = $this->completeMobile($ctx)->assertStatus(409);
        $this->assertSame('gift_unavailable', $res->json('error.details.items.0.reason'));
        $this->assertSame(0, CommerceOrder::withoutGlobalScopes()->count());
    }

    /** @test */
    public function the_recipient_phone_requirement_follows_the_policy(): void
    {
        $ctx = $this->readyMobileCheckout('gift-phone', ['enabled' => true, 'over' => ['recipient_phone_required' => false]]);
        $this->mobile($ctx, 'PATCH', 'checkout/gift', ['recipient_name' => 'نورة'])->assertOk();

        $res = $this->completeMobile($ctx)->assertCreated();
        $order = $this->orderRow($ctx['store']['tenant']->id, $res->json('data.order.id'));
        $this->assertNull($order->gift->recipient_phone);
        // بلا هاتف مستلم يرجع شحن اللقطة إلى هاتف المشتري (لا فراغ — يتصل المندوب بالمشتري).
        $this->assertSame('نورة', $order->snapshot->shipping_recipient_name);
        $this->assertSame('0501111111', $order->snapshot->shipping_phone);
    }

    /** @test */
    public function replaying_completion_returns_the_same_order_and_a_single_gift_row(): void
    {
        $ctx = $this->readyMobileCheckout('gift-replay');
        $this->mobile($ctx, 'PATCH', 'checkout/gift', ['recipient_name' => 'نورة', 'recipient_phone' => '0502222222', 'message' => 'م'])->assertOk();

        $first = $this->completeMobile($ctx, 'replay-key-001')->assertCreated();
        $second = $this->completeMobile($ctx, 'replay-key-001')->assertOk();

        $this->assertSame($first->json('data.order.id'), $second->json('data.order.id'));
        $this->assertSame(1, CommerceOrderGift::withoutGlobalScopes()->count());
        $this->assertSame('م', $second->json('data.order.gift.message'));
    }

    /** @test */
    public function the_order_gift_snapshot_is_frozen_once_the_order_is_confirmed(): void
    {
        $ctx = $this->readyMobileCheckout('gift-frozen');
        $this->mobile($ctx, 'PATCH', 'checkout/gift', ['recipient_name' => 'نورة', 'recipient_phone' => '0502222222', 'message' => 'ثابتة'])->assertOk();
        $res = $this->completeMobile($ctx)->assertCreated();

        app(TenantContext::class)->set($ctx['store']['tenant']->id);
        $gift = CommerceOrderGift::query()->where('commerce_order_id', $res->json('data.order.id'))->firstOrFail();
        foreach ([
            fn () => $gift->update(['message' => 'تعديل']),
            fn () => $gift->delete(),
            fn () => CommerceOrderGift::create(['commerce_order_id' => $res->json('data.order.id'), 'recipient_name' => 'x']),
        ] as $mutation) {
            try {
                $mutation();
                $this->fail('a confirmed order gift snapshot was mutated');
            } catch (LogicException) {
                $this->addToAssertionCount(1);
            }
        }
        $this->assertSame('ثابتة', $gift->fresh()->message);
    }

    // ── policy admin API & isolation ────────────────────────────────────

    /** @test */
    public function the_workspace_policy_api_is_manage_only_and_isolated_per_tenant(): void
    {
        $a = $this->registerTenant('gift-ws-a', 'owner@gift-ws-a.test');
        $b = $this->registerTenant('gift-ws-b', 'owner@gift-ws-b.test');
        $storefrontA = $this->seedWebStorefront($a['tenant_id']);
        $storefrontB = $this->seedWebStorefront($b['tenant_id']);
        $url = fn (Storefront $s) => "/api/commerce/workspace/storefronts/{$s->id}/gift-settings";

        $default = $this->withToken($a['token'])->getJson($url($storefrontA))->assertOk();
        $this->assertFalse($default->json('data.gift_settings.enabled'));

        $saved = $this->withToken($a['token'])->putJson($url($storefrontA), ['is_enabled' => true, 'message_max_length' => 120, 'allow_hide_sender' => false])->assertOk();
        $this->assertTrue($saved->json('data.gift_settings.enabled'));
        $this->assertSame(120, $saved->json('data.gift_settings.message_max_length'));
        $this->assertFalse($saved->json('data.gift_settings.allow_hide_sender'));

        foreach ([['message_max_length' => 0], ['message_max_length' => 501], ['is_enabled' => 'maybe']] as $bad) {
            $this->withToken($a['token'])->putJson($url($storefrontA), $bad)->assertStatus(422);
        }

        // مستأجر آخر: 404 غير كاشف، ولا تغيير
        $this->withToken($a['token'])->getJson($url($storefrontB))->assertNotFound();
        $this->withToken($a['token'])->putJson($url($storefrontB), ['is_enabled' => true])->assertNotFound();
        $this->assertFalse($this->withToken($b['token'])->getJson($url($storefrontB))->json('data.gift_settings.enabled'));

        $staff = $this->tokenForRole($a['tenant_id'], 'staff', 'staff@gift-ws-a.test');
        $this->withToken($staff)->putJson($url($storefrontA), ['is_enabled' => false])->assertForbidden();
        $this->withToken($staff)->getJson($url($storefrontA))->assertForbidden();
    }

    /** @test */
    public function a_settings_row_cannot_point_at_another_tenants_channel_or_exceed_limits(): void
    {
        $a = $this->mobileStore('gift-mod-a');
        $b = $this->mobileStore('gift-mod-b');

        app(TenantContext::class)->set($a['tenant']->id);
        foreach ([
            fn () => CommerceGiftSetting::create(['sales_channel_id' => $b['channel']->id]),
            fn () => CommerceGiftSetting::create(['sales_channel_id' => $a['channel']->id, 'message_max_length' => 0]),
            fn () => CommerceGiftSetting::create(['sales_channel_id' => $a['channel']->id, 'message_max_length' => 501]),
        ] as $create) {
            try {
                $create();
                $this->fail('an invalid gift setting was accepted');
            } catch (\RuntimeException) {
                $this->addToAssertionCount(1);
            }
        }
    }

    /** @test */
    public function tenant_b_gift_policy_never_applies_to_tenant_a_channel(): void
    {
        $a = $this->mobileStore('gift-iso-a');
        $b = $this->mobileStore('gift-iso-b');
        $this->enableGifts($b['tenant'], $b['channel']);

        $service = app(\App\Services\Commerce\CommerceGiftService::class);
        app(TenantContext::class)->set($a['tenant']->id);
        $this->assertFalse($service->optionsForChannel($a['channel']->id)['enabled']);
        $this->assertFalse($service->optionsForChannel($b['channel']->id)['enabled']); // قناة غريبة ⇒ افتراض معطَّل
    }

    // ── store/v1 parity ─────────────────────────────────────────────────

    /** @test */
    public function the_web_storefront_completes_a_gift_order_and_serializes_it(): void
    {
        $host = 'gift-web.example.com';
        config(['storefront.gateway_secret' => self::SECRET]);
        $tenant = Tenant::create(['name' => $host, 'slug' => 'gw-'.Str::random(8), 'vat_number' => '300000000000003', 'currency' => 'SAR', 'is_active' => true]);
        app(TenantContext::class)->set($tenant->id);
        $channel = SalesChannel::create(['slug' => 'web', 'name' => 'Web', 'type' => SalesChannel::TYPE_WEB, 'is_active' => true]);
        $storefront = Storefront::create(['slug' => 'main', 'name' => 'Main', 'sales_channel_id' => $channel->id, 'is_active' => true]);
        StorefrontDomain::create(['storefront_id' => $storefront->id, 'hostname' => $host, 'type' => StorefrontDomain::TYPE_CUSTOM, 'is_active' => true, 'verification_status' => StorefrontDomain::VERIFICATION_VERIFIED]);
        app(TenantContext::class)->forget();
        $product = $this->product($tenant, $channel);
        $this->enableGifts($tenant, $channel);

        $headers = ['X-Storefront-Forwarded-Host' => $host, 'X-Storefront-Gateway-Secret' => self::SECRET];
        $base = 'http://laravel-internal.test/store/v1/';
        $token = $this->withHeaders($headers)->postJson($base.'cart/items', ['product_id' => $product->id, 'quantity' => 1, 'unit_key' => 'base'])
            ->assertCreated()->getCookie(CommerceCartService::COOKIE_NAME, false)->getValue();
        $call = fn (string $method, string $path, array $body = [], array $extra = []) => $this->withHeaders($headers + $extra)->withCredentials()
            ->withUnencryptedCookie(CommerceCartService::COOKIE_NAME, $token)->json($method, $base.$path, $body);

        $call('POST', 'checkout')->assertSuccessful();
        $call('PATCH', 'checkout/contact', ['name' => 'سالم المشتري', 'phone' => '0501111111'])->assertOk();
        $call('PATCH', 'checkout/address', ['country' => 'SA', 'city' => 'الدمام', 'street' => 'شارع'])->assertOk();
        $call('PATCH', 'checkout/delivery', ['method' => 'pickup'])->assertOk();
        $call('PATCH', 'checkout/gift', ['recipient_name' => 'نورة', 'recipient_phone' => '0502222222', 'message' => 'مبروك'])->assertOk()
            ->assertJsonPath('data.gift.recipient_name', 'نورة');
        $call('PATCH', 'checkout/gift', ['bogus' => 1])->assertStatus(422);

        $done = $call('POST', 'checkout/complete', [], ['Idempotency-Key' => 'web-gift-key-1'])->assertCreated();
        $this->assertSame('مبروك', $done->json('data.order.gift.message'));
        $this->assertSame('سالم المشتري', $done->json('data.order.contact.name'));
    }

    // ── helpers ─────────────────────────────────────────────────────────

    private function seedWebStorefront(string $tenantId): Storefront
    {
        app(TenantContext::class)->set($tenantId);
        $channel = SalesChannel::query()->where('slug', 'web')->first()
            ?? SalesChannel::create(['slug' => 'web', 'name' => 'ويب', 'type' => SalesChannel::TYPE_WEB, 'is_active' => true]);
        $storefront = Storefront::create(['slug' => 'main', 'name' => 'المتجر', 'sales_channel_id' => $channel->id, 'is_active' => true]);
        app(TenantContext::class)->forget();

        return $storefront;
    }
}
