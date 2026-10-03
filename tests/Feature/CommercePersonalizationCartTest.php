<?php

namespace Tests\Feature;

use App\Models\CommerceListing;
use App\Models\CommerceOrder;
use App\Models\CommerceOrderLinePersonalization;
use App\Models\Product;
use App\Models\SalesChannel;
use App\Models\Tenant;
use App\Services\ApiClientKeyService;
use App\Services\Commerce\Otp\FakeOtpProvider;
use App\Services\Commerce\ProductPersonalizationService;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Illuminate\Testing\TestResponse;
use LogicException;
use Tests\TestCase;

/**
 * FLOWERS-H4b / ADR-16 — التخصيص في السلة والدفع والطلب: هوية السطر ببصمة المُدخَل،
 * التحقق من الخادم، الدمج، إعادة التحقق عند الإتمام، لقطة الطلب الثابتة، وعدم تغيّر
 * سلوك المنتج العادي.
 *
 * تشغيل: php artisan test --filter=CommercePersonalizationCartTest
 */
class CommercePersonalizationCartTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    private const TOKEN = 'X-Cart-Token';

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

        return ['tenant' => $tenant, 'channel' => $channel, 'token' => $service->issueKey($service->createClient($tenant, 'mobile-app', true), 'default', [])->plainTextToken];
    }

    private function product(array $store, string $name = 'كيكة', array $fields = []): Product
    {
        app(TenantContext::class)->set($store['tenant']->id);
        $product = Product::create(['name' => $name, 'sku' => 'P-'.Str::random(6), 'unit' => 'piece', 'sale_price' => 12000, 'is_active' => true]);
        CommerceListing::create(['product_id' => $product->id, 'sales_channel_id' => $store['channel']->id, 'is_published' => true]);
        if ($fields !== []) {
            app(ProductPersonalizationService::class)->replaceDefinitions($product, $fields);
        }
        app(TenantContext::class)->forget();

        return $product;
    }

    private function fields(): array
    {
        return [
            ['key' => 'cake-text', 'type' => 'text', 'label' => 'الكتابة', 'is_required' => true, 'max_length' => 12],
            ['key' => 'flavor', 'type' => 'select', 'label' => 'النكهة', 'options' => [
                ['value_key' => 'vanilla', 'label' => 'فانيلا'], ['value_key' => 'choc', 'label' => 'شوكولاتة'],
            ]],
            ['key' => 'card', 'type' => 'textarea', 'label' => 'البطاقة', 'max_length' => 40],
        ];
    }

    private function headers(array $store, ?string $cart = null, ?string $customer = null): array
    {
        $headers = ['Authorization' => 'Bearer '.$store['token']];
        if ($cart !== null) {
            $headers[self::TOKEN] = $cart;
        }
        if ($customer !== null) {
            $headers['X-Customer-Token'] = $customer;
        }

        return $headers;
    }

    private function add(array $store, Product $product, array $body = [], ?string $cart = null, ?string $customer = null): TestResponse
    {
        // الترويسات كمعامل ثالث (لا `withHeaders`) كي لا تتسرّب ترويسة عميل إلى طلب لاحق.
        return $this->postJson(
            '/commerce/v1/cart/items',
            array_merge(['product_id' => $product->id, 'quantity' => 1], $body),
            $this->headers($store, $cart, $customer),
        );
    }

    private function cartToken(TestResponse $response): string
    {
        return $response->headers->get(self::TOKEN);
    }

    // ── validation ──────────────────────────────────────────────────────

    /** @test */
    public function a_valid_personalization_is_stored_and_shown_on_the_line(): void
    {
        $store = $this->mobileStore('pc-ok');
        $product = $this->product($store, 'كيكة', $this->fields());

        $res = $this->add($store, $product, ['personalization' => ['cake-text' => 'عيد سعيد', 'flavor' => 'choc']])->assertCreated();

        $line = $res->json('data.items.0');
        $this->assertSame(
            [['key' => 'cake-text', 'label' => 'الكتابة', 'label_en' => null, 'value' => 'عيد سعيد', 'value_label' => null],
             ['key' => 'flavor', 'label' => 'النكهة', 'label_en' => null, 'value' => 'choc', 'value_label' => 'شوكولاتة']],
            $line['personalization'],
        );
        $this->assertSame(12000, $line['unit_price']['amount_minor']); // لا أثر سعري
    }

    /** @test */
    public function invalid_input_is_refused_and_nothing_is_added(): void
    {
        $store = $this->mobileStore('pc-bad');
        $product = $this->product($store, 'كيكة', $this->fields());
        $plain = $this->product($store, 'عادي');

        $cases = [
            'missing required' => [[], 'personalization.cake-text'],
            'empty required' => [['cake-text' => '   '], 'personalization.cake-text'],
            'unknown key' => [['cake-text' => 'x', 'bogus' => 'y'], 'personalization'],
            'bad option' => [['cake-text' => 'x', 'flavor' => 'mango'], 'personalization.flavor'],
            'too long' => [['cake-text' => str_repeat('م', 13)], 'personalization.cake-text'],
            'too many lines' => [['cake-text' => 'x', 'card' => str_repeat("\nx", 8)], 'personalization.card'],
            'list shape' => [['x', 'y'], 'personalization'],
        ];
        foreach ($cases as $name => [$input, $errorKey]) {
            $res = $this->add($store, $product, ['personalization' => $input])->assertStatus(422);
            $this->assertStringContainsString($errorKey, json_encode($res->json(), JSON_UNESCAPED_UNICODE), $name);
        }

        // منتج بلا تعريفات يرفض أي مُدخَل بدل تجاهله
        $this->add($store, $plain, ['personalization' => ['x' => 'y']])->assertStatus(422);

        $this->assertSame(0, \App\Models\CommerceCartItem::withoutGlobalScopes()->count());
    }

    /** @test */
    public function text_is_sanitized_and_length_is_counted_in_characters(): void
    {
        $store = $this->mobileStore('pc-san');
        $product = $this->product($store, 'كيكة', $this->fields());

        $res = $this->add($store, $product, ['personalization' => ['cake-text' => "م\u{202E}ر\x07حبا"]])->assertCreated();
        $this->assertSame('مرحبا', $res->json('data.items.0.personalization.0.value'));

        // 12 حرفاً عربياً (24 بايت) مقبولة
        $this->add($store, $product, ['personalization' => ['cake-text' => str_repeat('ب', 12)]], $this->cartToken($res))->assertOk();
    }

    /** @test */
    public function an_ordinary_product_is_byte_identical_to_before(): void
    {
        $store = $this->mobileStore('pc-plain');
        $product = $this->product($store, 'عادي');

        $res = $this->add($store, $product)->assertCreated();

        $this->assertArrayNotHasKey('personalization', $res->json('data.items.0'));
        $this->assertSame(1, $res->json('data.items.0.quantity'));
    }

    // ── line identity ───────────────────────────────────────────────────

    /** @test */
    public function the_same_input_merges_quantity_and_different_input_is_a_separate_line(): void
    {
        $store = $this->mobileStore('pc-ident');
        $product = $this->product($store, 'كيكة', $this->fields());

        $first = $this->add($store, $product, ['personalization' => ['cake-text' => 'أ', 'flavor' => 'vanilla']])->assertCreated();
        $cart = $this->cartToken($first);
        $this->add($store, $product, ['personalization' => ['flavor' => 'vanilla', 'cake-text' => 'أ']], $cart)->assertOk(); // ترتيب مفاتيح مختلف، نفس المُدخَل
        $res = $this->add($store, $product, ['personalization' => ['cake-text' => 'ب']], $cart)->assertOk();

        $items = $res->json('data.items');
        $this->assertCount(2, $items);
        $byText = collect($items)->keyBy(fn ($i) => $i['personalization'][0]['value']);
        $this->assertSame(2, $byText['أ']['quantity']);
        $this->assertSame(1, $byText['ب']['quantity']);
    }

    /** @test */
    public function personalization_carries_through_the_guest_to_customer_cart_merge(): void
    {
        $store = $this->mobileStore('pc-merge');
        $product = $this->product($store, 'كيكة', $this->fields());

        $phone = '+966500000777';
        $this->postJson('/commerce/v1/auth/otp/request', ['phone' => $phone], $this->headers($store));
        $code = FakeOtpProvider::lastCodeFor($store['tenant']->id, $phone, 'login');
        $customer = $this->postJson('/commerce/v1/auth/otp/verify', ['phone' => $phone, 'code' => $code], $this->headers($store))->assertOk()->json('data.token');

        // سلة العميل أولاً
        $own = $this->add($store, $product, ['personalization' => ['cake-text' => 'أ']], null, $customer)->assertCreated();
        // ثم سلة ضيف (دون رمز عميل) بسطرين: نفس المُدخَل ومُدخَل مختلف
        $guest = $this->add($store, $product, ['personalization' => ['cake-text' => 'أ']])->assertCreated();
        $guestToken = $this->cartToken($guest);
        $this->add($store, $product, ['personalization' => ['cake-text' => 'ج']], $guestToken)->assertOk();

        $merged = $this->getJson('/commerce/v1/cart', $this->headers($store, $guestToken, $customer))->assertOk();
        $byText = collect($merged->json('data.items'))->keyBy(fn ($i) => $i['personalization'][0]['value']);

        $this->assertCount(2, $byText);
        $this->assertSame(2, $byText['أ']['quantity']);
        $this->assertSame(1, $byText['ج']['quantity']);
        $this->assertNotNull($own);
    }

    // ── checkout / order ────────────────────────────────────────────────

    private function readyCheckout(array $store, string $cart): void
    {
        $h = $this->headers($store, $cart);
        $this->postJson('/commerce/v1/checkout', [], $h)->assertCreated();
        $this->patchJson('/commerce/v1/checkout/contact', ['name' => 'المشتري', 'phone' => '0501111111'], $h)->assertOk();
        $this->patchJson('/commerce/v1/checkout/address', ['country' => 'SA', 'city' => 'الدمام', 'street' => 'شارع'], $h)->assertOk();
        $this->patchJson('/commerce/v1/checkout/delivery', ['method' => 'pickup'], $h)->assertOk();
    }

    private function complete(array $store, string $cart, string $key = 'pz-key-0001'): TestResponse
    {
        return $this->postJson('/commerce/v1/checkout/complete', [], $this->headers($store, $cart) + ['Idempotency-Key' => $key]);
    }

    /** @test */
    public function completion_snapshots_the_personalization_on_the_order_line_and_replay_is_stable(): void
    {
        $store = $this->mobileStore('pc-order');
        $product = $this->product($store, 'كيكة', $this->fields());
        $cart = $this->cartToken($this->add($store, $product, ['quantity' => 2, 'personalization' => ['cake-text' => 'مبروك', 'flavor' => 'vanilla']])->assertCreated());
        $this->readyCheckout($store, $cart);

        $done = $this->complete($store, $cart)->assertCreated();
        $item = $done->json('data.order.items.0');
        $this->assertSame(2, $item['quantity']);
        $this->assertSame(24000, $item['line_total']['amount_minor']);
        $this->assertSame('مبروك', $item['personalization'][0]['value']);
        $this->assertSame('فانيلا', $item['personalization'][1]['value_label']);

        $replay = $this->complete($store, $cart)->assertOk();
        $this->assertSame($done->json('data.order.id'), $replay->json('data.order.id'));
        $this->assertSame(2, CommerceOrderLinePersonalization::withoutGlobalScopes()->count());
    }

    /** @test */
    public function editing_the_definition_after_adding_to_cart_blocks_completion_with_a_review_and_no_order(): void
    {
        $store = $this->mobileStore('pc-reval');
        $product = $this->product($store, 'كيكة', $this->fields());
        $cart = $this->cartToken($this->add($store, $product, ['personalization' => ['cake-text' => 'مبروك']])->assertCreated());
        $this->readyCheckout($store, $cart);

        // يضيف التاجر حقلاً إلزامياً جديداً
        app(TenantContext::class)->set($store['tenant']->id);
        app(ProductPersonalizationService::class)->replaceDefinitions($product, array_merge($this->fields(), [
            ['key' => 'ribbon', 'type' => 'text', 'label' => 'الشريط', 'is_required' => true],
        ]));
        app(TenantContext::class)->forget();

        $res = $this->complete($store, $cart)->assertStatus(409);
        $this->assertSame('review_required', $res->json('error.code'));
        $this->assertSame('personalization_invalid', $res->json('error.details.items.0.reason'));
        $this->assertSame(0, CommerceOrder::withoutGlobalScopes()->count());
    }

    /** @test */
    public function the_order_line_snapshot_is_frozen_after_confirmation_and_survives_definition_changes(): void
    {
        $store = $this->mobileStore('pc-frozen');
        $product = $this->product($store, 'كيكة', $this->fields());
        $cart = $this->cartToken($this->add($store, $product, ['personalization' => ['cake-text' => 'ثابت']])->assertCreated());
        $this->readyCheckout($store, $cart);
        $orderId = $this->complete($store, $cart)->assertCreated()->json('data.order.id');

        // حذف كل التعريفات لا يمسّ الطلب التاريخي
        app(TenantContext::class)->set($store['tenant']->id);
        app(ProductPersonalizationService::class)->replaceDefinitions($product, []);
        $row = CommerceOrderLinePersonalization::query()->firstOrFail();
        foreach ([
            fn () => $row->update(['value' => 'تعديل']),
            fn () => $row->delete(),
        ] as $mutation) {
            try {
                $mutation();
                $this->fail('a confirmed order personalization was mutated');
            } catch (LogicException) {
                $this->addToAssertionCount(1);
            }
        }
        app(TenantContext::class)->forget();

        $this->assertSame('ثابت', $row->fresh()->value);
        $this->assertNotNull($orderId);
    }

    /** @test */
    public function another_tenants_definitions_never_apply(): void
    {
        $a = $this->mobileStore('pc-iso-a');
        $b = $this->mobileStore('pc-iso-b');
        $productA = $this->product($a, 'منتج أ'); // بلا تعريفات
        $this->product($b, 'منتج ب', $this->fields());

        // مُدخَل بمفاتيح مستأجر ب على منتج أ مرفوض (لا تعريفات عند أ)
        $this->add($a, $productA, ['personalization' => ['cake-text' => 'x']])->assertStatus(422);
        $this->add($a, $productA)->assertCreated();
    }
}
