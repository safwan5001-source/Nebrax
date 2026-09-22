<?php

namespace Tests\Feature;

use App\Models\CommerceCategoryListing;
use App\Models\CommerceListing;
use App\Models\CommerceOrder;
use App\Models\CommercePaymentIntent;
use App\Models\Product;
use App\Models\ProductCategory;
use App\Models\ProductOption;
use App\Models\ProductOptionValue;
use App\Models\ProductVariant;
use App\Models\SalesChannel;
use App\Models\Tenant;
use App\Services\ApiClientKeyService;
use App\Services\Commerce\CommerceCheckoutService;
use App\Services\Commerce\Otp\FakeOtpProvider;
use App\Services\PaymentMethodChannelAvailabilityService;
use App\Support\PublicApiErrorCode;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Route;
use Illuminate\Support\Str;
use Illuminate\Testing\TestResponse;
use Symfony\Component\Yaml\Yaml;
use Tests\TestCase;

/**
 * COM-MOBILE-VERTICAL-TEST-1 (ADR-13 §3) — OpenAPI 3.1 contract test for
 * `/commerce/v1`, following `PublicApiOpenApiContractTest`'s own four-part
 * convention (structural / path-and-tier matching / schema-drift protection
 * / targeted contract pins), adapted for this surface's own shape:
 *
 *  (أ) بنيوي: يُحلَّل، 3.1، operationId فريد، كل $ref يُحَل، خادم مقولَب.
 *  (ب) مطابقة المسارات/الطبقة (حرِجة للدمج): كل مسار Commerce فعلي موثَّق
 *      وبالعكس؛ `x-auth-tier` الموثّق يطابق مجموعة الوسائط الفعلية المفروضة
 *      (`read`/`write`/`sensitive`/`customer` — لا `scope` هنا: هذا السطح
 *      يُصادق بعميل المتجر + قناة الجوال المحلولة، لا بصلاحيات مفتاح API)؛
 *      Idempotency-Key موثَّقة إلزامية على `checkout/complete` وحدها.
 *  (ج) حماية انحراف المخطّط: قراءةً (حيّة، عبر تركيبات حقيقية) وإنشاءً
 *      (انعكاسٌ على فئات FormRequest حيث توجد، وسلوكيٌّ حيث لا توجد —
 *      المتحكّمات هنا تستعمل `$request->validate()` مباشرةً لا فئة مخصّصة،
 *      فيُثبَت العقد بإرسال الحقول الموثَّقة بالضبط ثم حقلٍ إضافي مرفوض).
 *  (د) تثبيتات موجّهة: رموز الأخطاء، طرق التوصيل، وطرق الدفع (COD/الاستلام)
 *      مربوطة بمصادرها الحقيقية.
 *
 * `Category`/`Product` يحملان حقولاً **اختيارية حقاً** (`children`/`ancestors`
 * على `Category` تبعاً للعمق ووجود سلف؛ `media`/`options`/`variants` على
 * `Product` تبعاً للتفصيل ونوع المنتج) — عقدهما مبنيّان بـ`allOf`/خصائص غير
 * إلزامية، ويتحقّق `assertMatchesSchema()` أدناه أن الفعليّ ⊆ الموثَّق وأن كل
 * إلزاميٍّ موجود، لا مطابقةً حرفية — وهذا هو المعنى الصحيح لـ`required` في
 * OpenAPI، لا تساهلاً في العقد.
 *
 * تشغيل: php artisan test --filter=CommerceApiOpenApiContractTest
 */
class CommerceApiOpenApiContractTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    private const SPEC_PATH = 'docs/openapi/commerce-api-v1.yaml';

    private static ?array $spec = null;

    private function spec(): array
    {
        if (self::$spec === null) {
            $this->assertTrue(class_exists(Yaml::class));
            $path = base_path(self::SPEC_PATH);
            $this->assertFileExists($path, "ملف عقد Commerce OpenAPI مفقود: {$path}");
            self::$spec = Yaml::parseFile($path);
        }

        return self::$spec;
    }

    // ── (أ) تحقّق بنيوي ──────────────────────────────────────────────────

    /** @test */
    public function the_spec_is_a_well_formed_openapi_3_1_document(): void
    {
        $spec = $this->spec();
        foreach (['openapi', 'info', 'paths', 'components'] as $key) {
            $this->assertArrayHasKey($key, $spec, "مفتاح المستوى الأعلى «{$key}» مفقود.");
        }
        $this->assertStringStartsWith('3.1', (string) $spec['openapi']);
        $this->assertSame('v1', $spec['info']['version']);
    }

    /** @test */
    public function every_operation_has_a_unique_operation_id(): void
    {
        $ids = array_map(fn ($op) => $op['operation']['operationId'] ?? null, $this->operations());
        $this->assertNotContains(null, $ids, 'عملية بلا operationId.');
        $this->assertNotEmpty($ids);
        $this->assertSame(array_values(array_unique($ids)), $ids, 'operationId مكرّر.');
    }

    /** @test */
    public function every_internal_ref_resolves(): void
    {
        $spec = $this->spec();
        $refs = [];
        $this->collectRefs($spec, $refs);
        $this->assertNotEmpty($refs);
        foreach (array_unique($refs) as $ref) {
            $this->assertStringStartsWith('#/', $ref, "مرجع خارجي غير مسموح: {$ref}");
            $this->assertNotNull($this->resolvePointer($spec, $ref), "مرجع لا يُحَل: {$ref}");
        }
    }

    /** @test */
    public function the_server_url_is_templated_with_no_hardcoded_production_host(): void
    {
        foreach ($this->spec()['servers'] as $server) {
            $this->assertStringContainsString('{baseUrl}', $server['url']);
        }
    }

    // ── (ب) مطابقة المسارات/الطبقة — حرِجة للدمج ────────────────────────

    /** @test */
    public function documented_paths_match_the_actual_commerce_route_surface_exactly(): void
    {
        $routeSurface = $this->commerceRouteSurface();
        $specSurface = $this->specSurface();

        $missingFromSpec = array_diff(array_keys($routeSurface), array_keys($specSurface));
        $this->assertSame([], array_values($missingFromSpec), 'مسارات Commerce فعلية غير موثَّقة: ' . implode(', ', $missingFromSpec));

        $missingFromRoutes = array_diff(array_keys($specSurface), array_keys($routeSurface));
        $this->assertSame([], array_values($missingFromRoutes), 'عمليات موثَّقة بلا مسار فعلي مقابل: ' . implode(', ', $missingFromRoutes));
    }

    /** @test */
    public function documented_auth_tier_matches_the_enforced_middleware_group(): void
    {
        $routeSurface = $this->commerceRouteSurface();
        $specSurface = $this->specSurface();

        foreach ($specSurface as $combo => $op) {
            $this->assertArrayHasKey($combo, $routeSurface, "لا مسار مقابل لـ {$combo}.");
            $this->assertSame(
                $routeSurface[$combo]['tier'],
                $op['tier'],
                "طبقة المصادقة الموثَّقة لـ {$combo} لا تطابق الوسائط الفعلية.",
            );
        }
    }

    /** @test */
    public function only_checkout_complete_documents_a_required_idempotency_key(): void
    {
        $spec = $this->spec();
        $requiring = [];

        foreach ($this->operations() as $op) {
            $names = [];
            foreach ($op['operation']['parameters'] ?? [] as $param) {
                $resolved = isset($param['$ref']) ? $this->resolvePointer($spec, $param['$ref']) : $param;
                if (($resolved['in'] ?? null) === 'header' && ($resolved['name'] ?? null) === 'Idempotency-Key') {
                    if ($resolved['required'] ?? false) {
                        $requiring[] = "{$op['method']} {$op['path']}";
                    }
                }
            }
        }

        $this->assertSame(['POST /checkout/complete'], $requiring, 'Idempotency-Key يجب أن تكون إلزامية على checkout/complete وحدها.');
    }

    // ── (ج) حماية انحراف المخطّط — القراءة (حيّة) ───────────────────────

    /** @test */
    public function storefront_representation_matches_the_documented_schema(): void
    {
        $store = $this->seedMobileStore('cs-storefront');

        $data = $this->withHeaders($this->bearer($store['token']))
            ->getJson('/commerce/v1/storefront')->assertOk()->json('data');

        $this->assertSameSet(['name'], array_keys($data), 'StorefrontResponse.data');
    }

    /** @test */
    public function category_list_never_carries_ancestors_and_always_carries_children_at_depth(): void
    {
        $store = $this->seedMobileStore('cs-cat-list');
        [$root, $child] = $this->seedCategoryTree($store);

        $data = $this->withHeaders($this->bearer($store['token']))
            ->getJson('/commerce/v1/categories')->assertOk()->json('data');

        $this->assertNotEmpty($data);
        $row = collect($data)->firstWhere('id', $root->id);
        $this->assertNotNull($row);
        $this->assertMatchesSchema('Category', $row, 'Category (list root)');
        $this->assertArrayNotHasKey('ancestors', $row, 'القائمة لا تمرّر أسلافاً أبداً.');
        $this->assertArrayHasKey('children', $row, 'العمق>0 في القائمة، فـ children حاضرة دوماً.');
        foreach ($row['children'] as $grandchildLevel) {
            $this->assertMatchesSchema('Category', $grandchildLevel, 'Category (list child)');
        }
    }

    /** @test */
    public function category_detail_carries_ancestors_only_when_a_real_ancestor_exists(): void
    {
        $store = $this->seedMobileStore('cs-cat-detail');
        [$root, $child] = $this->seedCategoryTree($store);

        $rootDetail = $this->withHeaders($this->bearer($store['token']))
            ->getJson("/commerce/v1/categories/{$root->id}")->assertOk()->json('data');
        $this->assertMatchesSchema('Category', $rootDetail, 'Category (root detail)');
        $this->assertArrayNotHasKey('ancestors', $rootDetail, 'الجذر بلا سلف.');

        $childDetail = $this->withHeaders($this->bearer($store['token']))
            ->getJson("/commerce/v1/categories/{$child->id}")->assertOk()->json('data');
        $this->assertMatchesSchema('Category', $childDetail, 'Category (child detail)');
        $this->assertArrayHasKey('ancestors', $childDetail);
        $this->assertNotEmpty($childDetail['ancestors']);
        $this->assertSameSet(['id', 'name'], array_keys($childDetail['ancestors'][0]), 'Category.ancestors[]');
    }

    /** @test */
    public function simple_product_list_and_detail_representations_match_the_documented_schemas(): void
    {
        $store = $this->seedMobileStore('cs-product-simple');
        $product = $this->publishedProduct($store);

        $list = $this->withHeaders($this->bearer($store['token']))
            ->getJson('/commerce/v1/products')->assertOk()->json('data');
        $this->assertNotEmpty($list);
        $this->assertMatchesSchema('ProductListItem', $list[0], 'ProductListItem');
        $this->assertArrayNotHasKey('media', $list[0], 'الصف في القائمة لا يحمل media.');

        $detail = $this->withHeaders($this->bearer($store['token']))
            ->getJson("/commerce/v1/products/{$product->id}")->assertOk()->json('data');
        $this->assertMatchesSchema('ProductDetail', $detail, 'ProductDetail');
        $this->assertArrayNotHasKey('options', $detail);
        $this->assertArrayNotHasKey('variants', $detail);
        $this->assertFalse($detail['is_variant_managed']);
    }

    /** @test */
    public function variant_managed_product_detail_matches_the_documented_schema(): void
    {
        $store = $this->seedMobileStore('cs-product-variant');
        $product = $this->publishedVariantProduct($store);

        $detail = $this->withHeaders($this->bearer($store['token']))
            ->getJson("/commerce/v1/products/{$product->id}")->assertOk()->json('data');

        $this->assertMatchesSchema('ProductVariantDetail', $detail, 'ProductVariantDetail');
        $this->assertTrue($detail['is_variant_managed']);
        $this->assertNotEmpty($detail['options']);
        $this->assertNotEmpty($detail['variants']);
        $this->assertMatchesSchema('ProductOption', $detail['options'][0], 'ProductOption');
        $this->assertMatchesSchema('ProductVariant', $detail['variants'][0], 'ProductVariant');
    }

    /** @test */
    public function cart_representation_matches_the_documented_schema_empty_and_populated(): void
    {
        $store = $this->seedMobileStore('cs-cart');
        $product = $this->publishedProduct($store);

        $empty = $this->withHeaders($this->bearer($store['token']))
            ->getJson('/commerce/v1/cart')->assertOk()->json('data');
        $this->assertMatchesSchema('Cart', $empty, 'Cart (empty)');
        $this->assertSame([], $empty['items']);

        $response = $this->withHeaders($this->bearer($store['token']))
            ->postJson('/commerce/v1/cart/items', ['product_id' => $product->id, 'quantity' => 2])
            ->assertCreated();
        $populated = $response->json('data');
        $this->assertMatchesSchema('Cart', $populated, 'Cart (populated)');
        $this->assertMatchesSchema('CartItem', $populated['items'][0], 'CartItem');
    }

    /** @test */
    public function checkout_representation_matches_the_documented_schema_empty_and_populated(): void
    {
        $store = $this->seedMobileStore('cs-checkout');
        $product = $this->publishedProduct($store);
        $cartToken = $this->cartTokenWithItem($store, $product);

        $empty = $this->withHeaders($this->cartHeaders($store['token']))
            ->getJson('/commerce/v1/checkout')->assertOk()->json('data');
        $this->assertMatchesSchema('Checkout', $empty, 'Checkout (no checkout yet)');
        $this->assertNull($empty['status']);
        $this->assertArrayHasKey('payment', $empty);

        $this->withHeaders($this->cartHeaders($store['token'], $cartToken))
            ->postJson('/commerce/v1/checkout', [])->assertCreated();
        $this->withHeaders($this->cartHeaders($store['token'], $cartToken))
            ->patchJson('/commerce/v1/checkout/contact', ['name' => 'سالم', 'phone' => '0501234567'])->assertOk();
        $populated = $this->withHeaders($this->cartHeaders($store['token'], $cartToken))
            ->patchJson('/commerce/v1/checkout/address', ['country' => 'SA', 'city' => 'الدمام', 'street' => 'شارع'])
            ->assertOk()->json('data');
        $this->assertMatchesSchema('Checkout', $populated, 'Checkout (populated)');
    }

    /** @test */
    public function payment_methods_representation_matches_the_documented_schema(): void
    {
        $store = $this->seedMobileStore('cs-payment-methods');
        app(TenantContext::class)->set($store['tenant']->id);
        \App\Models\PaymentMethod::create(['name' => 'نقدي', 'settlement_type' => 'cash', 'available_online' => true, 'is_active' => true]);
        app(TenantContext::class)->forget();

        $data = $this->withHeaders($this->bearer($store['token']))
            ->getJson('/commerce/v1/payment-methods')->assertOk()->json('data');

        $this->assertNotEmpty($data['payment_methods']);
        $this->assertMatchesSchema('PaymentMethod', $data['payment_methods'][0], 'PaymentMethod');
    }

    /** @test */
    public function order_representation_matches_the_documented_schema_on_completion_and_guest_lookup(): void
    {
        $store = $this->seedMobileStore('cs-order');
        $product = $this->publishedProduct($store);
        $cartToken = $this->fullyReadyCheckout($store, $product);

        $response = $this->withHeaders($this->cartHeaders($store['token'], $cartToken) + ['Idempotency-Key' => 'contract-order-1'])
            ->postJson('/commerce/v1/checkout/complete', [])->assertCreated();
        $data = $response->json('data');
        $this->assertSameSet(['order', 'order_reference', 'replayed'], array_keys($data), 'CheckoutCompleteResponse.data');
        $this->assertMatchesSchema('Order', $data['order'], 'Order (completion)');
        $this->assertNotEmpty($data['order']['items']);
        $this->assertMatchesSchema('Order', $data['order'], 'Order.items[] implicitly checked via required keys');

        $lookup = $this->withHeaders($this->bearer($store['token']) + ['X-Order-Reference' => $data['order_reference']])
            ->getJson("/commerce/v1/orders/{$data['order']['id']}")->assertOk()->json('data');
        $this->assertMatchesSchema('Order', $lookup['order'], 'Order (guest lookup)');
    }

    /** @test */
    public function auth_responses_match_their_documented_schemas(): void
    {
        $store = $this->seedMobileStore('cs-auth');

        $register = $this->withHeaders($this->bearer($store['token']))->postJson('/commerce/v1/auth/register', [
            'display_name' => 'عميل', 'email' => 'c@contract.test', 'password' => 'password123',
        ])->assertStatus(202)->json('data');
        $this->assertSameSet(['verification_required'], array_keys($register));

        $phone = '+966500000099';
        $this->withHeaders($this->bearer($store['token']))
            ->postJson('/commerce/v1/auth/otp/request', ['phone' => $phone])
            ->assertStatus(202)->assertJsonPath('data.sent', true);

        $code = FakeOtpProvider::lastCodeFor($store['tenant']->id, $phone, 'login');
        $this->assertNotNull($code);
        $verify = $this->withHeaders($this->bearer($store['token']))
            ->postJson('/commerce/v1/auth/otp/verify', ['phone' => $phone, 'code' => $code])
            ->assertOk()->json('data');
        $this->assertSameSet(['token', 'customer'], array_keys($verify), 'TokenAuthResponse.data');
        $this->assertMatchesSchema('CustomerIdentity', $verify['customer'], 'CustomerIdentity');

        $customerToken = $verify['token'];
        $me = $this->withHeaders($this->withCustomerToken($store['token'], $customerToken))
            ->getJson('/commerce/v1/me')->assertOk()->json('data');
        $this->assertSameSet(['customer', 'partner_link'], array_keys($me));
        $this->assertMatchesSchema('CustomerIdentity', $me['customer'], 'CustomerIdentity (me)');

        $logout = $this->withHeaders($this->withCustomerToken($store['token'], $customerToken))
            ->postJson('/commerce/v1/auth/logout')->assertOk()->json('data');
        $this->assertSame(['logged_out' => true], $logout);
    }

    /** @test */
    public function address_representations_match_their_documented_schemas(): void
    {
        $store = $this->seedMobileStore('cs-addresses');
        $customerToken = $this->authenticatedCustomer($store);

        $created = $this->withHeaders($this->withCustomerToken($store['token'], $customerToken))
            ->postJson('/commerce/v1/addresses', [
                'recipient_name' => 'سالم', 'phone' => '0501234567',
                'country' => 'SA', 'city' => 'الدمام', 'street' => 'شارع الملك فهد',
                'district' => 'الشاطئ', 'building_no' => '1234', 'postal_code' => '32230', 'additional_number' => '5678',
            ])->assertCreated()->json('data');
        $this->assertMatchesSchema('Address', $created, 'Address (created)');

        $list = $this->withHeaders($this->withCustomerToken($store['token'], $customerToken))
            ->getJson('/commerce/v1/addresses')->assertOk()->json('data');
        $this->assertSameSet(['data'], array_keys($list));
        $this->assertMatchesSchema('Address', $list['data'][0], 'Address (list)');

        $updated = $this->withHeaders($this->withCustomerToken($store['token'], $customerToken))
            ->patchJson("/commerce/v1/addresses/{$created['id']}", ['city' => 'الخبر'])
            ->assertOk()->json('data');
        $this->assertMatchesSchema('Address', $updated, 'Address (updated)');
        $this->assertSame('الخبر', $updated['city']);

        $deleted = $this->withHeaders($this->withCustomerToken($store['token'], $customerToken))
            ->deleteJson("/commerce/v1/addresses/{$created['id']}")
            ->assertOk()->json('data');
        $this->assertSame(['deleted' => true], $deleted);
    }

    /** @test */
    public function order_history_representations_match_their_documented_schemas(): void
    {
        $store = $this->seedMobileStore('cs-order-history');
        $customerToken = $this->authenticatedCustomer($store);
        $product = $this->publishedProduct($store);
        $cartToken = $this->fullyReadyCheckout($store, $product);
        $order = $this->withHeaders($this->cartHeaders($store['token'], $cartToken) + [
            'X-Customer-Token' => $customerToken, 'Idempotency-Key' => 'contract-history-1',
        ])->postJson('/commerce/v1/checkout/complete', [])->assertCreated()->json('data.order');

        $list = $this->withHeaders($this->withCustomerToken($store['token'], $customerToken))
            ->getJson('/commerce/v1/me/orders')->assertOk()->json('data');
        $this->assertNotEmpty($list);
        $this->assertMatchesSchema('OrderSummary', $list[0], 'OrderSummary');

        $detail = $this->withHeaders($this->withCustomerToken($store['token'], $customerToken))
            ->getJson("/commerce/v1/me/orders/{$order['id']}")->assertOk()->json('data');
        $this->assertMatchesSchema('Order', $detail['order'], 'Order (me/orders detail)');
    }

    // ── (ج) حماية انحراف المخطّط — الإنشاء ───────────────────────────────

    /** @test */
    public function customer_register_schema_matches_the_request_allow_list(): void
    {
        $rules = (new \App\Http\Requests\CustomerRegisterRequest())->rules();
        $this->assertRequestSchemaMatchesFormRequest('CustomerRegisterRequest', $rules);
    }

    /** @test */
    public function customer_login_schema_matches_the_request_allow_list(): void
    {
        $rules = (new \App\Http\Requests\CustomerLoginRequest())->rules();
        $this->assertRequestSchemaMatchesFormRequest('CustomerLoginRequest', $rules);
    }

    /** @test */
    public function otp_request_schema_matches_the_request_allow_list(): void
    {
        $rules = (new \App\Http\Requests\CommerceCustomerOtpRequestRequest())->rules();
        $this->assertRequestSchemaMatchesFormRequest('OtpRequestRequest', $rules);
    }

    /** @test */
    public function otp_verify_schema_matches_the_request_allow_list(): void
    {
        $rules = (new \App\Http\Requests\CommerceCustomerOtpVerifyRequest())->rules();
        $this->assertRequestSchemaMatchesFormRequest('OtpVerifyRequest', $rules);
    }

    /**
     * الباقي يستعمل `$request->validate()` مباشرةً لا فئة FormRequest —
     * يُثبَت العقد سلوكياً: الحقول الموثَّقة بالضبط تُقبَل، وحقلٌ إضافي غير
     * موثَّق يُرفَض (422) — يطابق `rejectUnknown()`/قائمة السماح الفعلية.
     */
    /** @test */
    public function cart_item_create_and_update_reject_any_undocumented_field(): void
    {
        $store = $this->seedMobileStore('cs-cart-allowlist');
        $product = $this->publishedProduct($store);

        $this->withHeaders($this->bearer($store['token']))
            ->postJson('/commerce/v1/cart/items', ['product_id' => $product->id, 'quantity' => 1, 'bogus' => 'x'])
            ->assertStatus(422);

        $cartToken = $this->cartTokenWithItem($store, $product);
        $itemId = $this->withHeaders($this->cartHeaders($store['token'], $cartToken))
            ->getJson('/commerce/v1/cart')->json('data.items.0.id');

        $this->withHeaders($this->cartHeaders($store['token'], $cartToken))
            ->patchJson("/commerce/v1/cart/items/{$itemId}", ['quantity' => 2, 'bogus' => 'x'])
            ->assertStatus(422);
    }

    /** @test */
    public function checkout_mutation_endpoints_reject_any_undocumented_field(): void
    {
        $store = $this->seedMobileStore('cs-checkout-allowlist');
        $product = $this->publishedProduct($store);
        $cartToken = $this->cartTokenWithItem($store, $product);
        $this->createCheckout($store, $cartToken)->assertCreated();

        $h = fn () => $this->withHeaders($this->cartHeaders($store['token'], $cartToken));

        $h()->patchJson('/commerce/v1/checkout/contact', ['name' => 'x', 'bogus' => 'x'])->assertStatus(422);
        $h()->patchJson('/commerce/v1/checkout/address', ['country' => 'SA', 'city' => 'x', 'street' => 'x', 'bogus' => 'x'])->assertStatus(422);
        $h()->patchJson('/commerce/v1/checkout/delivery', ['method' => 'pickup', 'bogus' => 'x'])->assertStatus(422);
        $h()->postJson('/commerce/v1/checkout/complete', ['bogus' => 'x'])->assertStatus(422);
    }

    /** @test */
    public function address_create_and_update_reject_any_undocumented_field(): void
    {
        $store = $this->seedMobileStore('cs-address-allowlist');
        $customerToken = $this->authenticatedCustomer($store);

        // A fully valid, non-Saudi payload plus one extra field — isolates
        // the extra-field rejection from the separate Saudi-fields check.
        $this->withHeaders($this->withCustomerToken($store['token'], $customerToken))
            ->postJson('/commerce/v1/addresses', [
                'recipient_name' => 'سالم', 'phone' => '0501234567', 'country' => 'EG', 'city' => 'القاهرة', 'street' => 'شارع', 'bogus' => 'x',
            ])->assertStatus(422);

        $address = $this->withHeaders($this->withCustomerToken($store['token'], $customerToken))
            ->postJson('/commerce/v1/addresses', [
                'recipient_name' => 'سالم', 'phone' => '0501234567', 'country' => 'EG', 'city' => 'القاهرة', 'street' => 'شارع',
            ])->assertCreated()->json('data');

        $this->withHeaders($this->withCustomerToken($store['token'], $customerToken))
            ->patchJson("/commerce/v1/addresses/{$address['id']}", ['city' => 'الإسكندرية', 'bogus' => 'x'])
            ->assertStatus(422);
    }

    // ── (د) تثبيتات موجّهة — العقد مربوط بالكود ─────────────────────────

    /** @test */
    public function documented_error_codes_match_the_error_code_enum(): void
    {
        $documented = $this->spec()['components']['schemas']['Error']['properties']['error']['properties']['code']['enum'];
        $actual = array_map(fn (PublicApiErrorCode $c) => $c->value, PublicApiErrorCode::cases());
        $this->assertSameSet($actual, $documented, 'رموز الأخطاء الموثَّقة يجب أن تطابق PublicApiErrorCode.');
    }

    /** @test */
    public function documented_delivery_methods_match_the_source_constant(): void
    {
        $documented = $this->spec()['components']['schemas']['CheckoutDeliveryUpdate']['properties']['method']['enum'];
        $this->assertSameSet(CommerceCheckoutService::DELIVERY_METHODS, $documented);
    }

    /** @test */
    public function documented_payment_intent_methods_match_the_source_constant(): void
    {
        $documented = array_values(array_filter(
            $this->spec()['components']['schemas']['CheckoutPayment']['properties']['method']['enum'],
            fn ($v) => $v !== null,
        ));
        $this->assertSameSet(CommercePaymentIntent::METHODS, $documented);
    }

    // ══ مساعدات ═════════════════════════════════════════════════════════

    /** @return array<string, array{tier: string}> */
    private function commerceRouteSurface(): array
    {
        $surface = [];
        $verbs = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];

        foreach (Route::getRoutes() as $route) {
            $uri = $route->uri();
            if (! str_starts_with($uri, 'commerce/v1/') && $uri !== 'commerce/v1') {
                continue;
            }
            $path = substr($uri, strlen('commerce/v1'));
            $tier = $this->tierFromMiddleware($route->gatherMiddleware());
            foreach (array_intersect($route->methods(), $verbs) as $method) {
                $surface["{$method} {$path}"] = ['tier' => $tier];
            }
        }

        return $surface;
    }

    private function tierFromMiddleware(array $middleware): string
    {
        $has = fn (string $needle) => (bool) array_filter($middleware, fn ($m) => is_string($m) && str_contains($m, $needle));

        if ($has('AuthenticateCommerceCustomer')) {
            return 'customer';
        }
        if ($has('EnforcePublicApiRateLimit:sensitive')) {
            return 'sensitive';
        }
        if ($has('EnforcePublicApiRateLimit:write')) {
            return 'write';
        }

        return 'read';
    }

    /** @return array<string, array{tier: string}> */
    private function specSurface(): array
    {
        $surface = [];
        foreach ($this->operations() as $op) {
            $surface["{$op['method']} {$op['path']}"] = ['tier' => $op['operation']['x-auth-tier'] ?? null];
        }

        return $surface;
    }

    /** @return list<array{method: string, path: string, operation: array<string,mixed>}> */
    private function operations(): array
    {
        $methods = ['get', 'post', 'put', 'patch', 'delete'];
        $ops = [];
        foreach ($this->spec()['paths'] as $path => $item) {
            foreach ($methods as $method) {
                if (isset($item[$method])) {
                    $ops[] = ['method' => strtoupper($method), 'path' => $path, 'operation' => $item[$method]];
                }
            }
        }

        return $ops;
    }

    private function collectRefs(mixed $node, array &$refs): void
    {
        if (! is_array($node)) {
            return;
        }
        foreach ($node as $key => $value) {
            if ($key === '$ref' && is_string($value)) {
                $refs[] = $value;
            } else {
                $this->collectRefs($value, $refs);
            }
        }
    }

    private function resolvePointer(array $spec, string $ref): mixed
    {
        if (! str_starts_with($ref, '#/')) {
            return null;
        }
        $node = $spec;
        foreach (explode('/', substr($ref, 2)) as $segment) {
            $segment = str_replace(['~1', '~0'], ['/', '~'], $segment);
            if (! is_array($node) || ! array_key_exists($segment, $node)) {
                return null;
            }
            $node = $node[$segment];
        }

        return $node;
    }

    /**
     * يحلّ اسم مخطّط (مباشر أو `allOf`) إلى [properties مدموجة، required مدموجة].
     * `allOf` يُدمَج بمجرد جمع كل عنصر (سواءٌ `$ref` أو تعريف مباشر) — يطابق
     * دلالة JSON Schema لـ `allOf`: الكائن يجب أن يحقّق كل عناصره معاً.
     *
     * @return array{0: array<string,mixed>, 1: list<string>}
     */
    private function resolveSchema(string $name): array
    {
        $schema = $this->spec()['components']['schemas'][$name] ?? null;
        $this->assertNotNull($schema, "المخطّط «{$name}» مفقود.");

        return $this->resolveSchemaNode($schema);
    }

    /** @return array{0: array<string,mixed>, 1: list<string>} */
    private function resolveSchemaNode(array $schema): array
    {
        if (isset($schema['$ref'])) {
            $resolved = $this->resolvePointer($this->spec(), $schema['$ref']);
            $this->assertIsArray($resolved);

            return $this->resolveSchemaNode($resolved);
        }

        if (isset($schema['allOf'])) {
            $properties = [];
            $required = [];
            foreach ($schema['allOf'] as $part) {
                [$partProps, $partRequired] = $this->resolveSchemaNode($part);
                $properties = [...$properties, ...$partProps];
                $required = [...$required, ...$partRequired];
            }

            return [$properties, array_values(array_unique($required))];
        }

        return [$schema['properties'] ?? [], $schema['required'] ?? []];
    }

    /** مفاتيح خصائص مخطّط (بعد حلّ allOf) — للاستعمال المباشر خارج assertMatchesSchema. */
    private function schemaProps(string $name): array
    {
        return array_keys($this->resolveSchema($name)[0]);
    }

    /**
     * يؤكّد أن مفاتيح `$actual` مجموعةٌ جزئية من خصائص المخطّط الموثَّقة، وأن
     * كل مفتاحٍ إلزامي (`required`) حاضرٌ فعلياً — لا مطابقةً حرفية، لأن حقولاً
     * مثل `Category.children`/`Product.options` اختياريةٌ حقاً بحسب العمق/النوع.
     */
    private function assertMatchesSchema(string $schemaName, array $actual, string $label): void
    {
        [$properties, $required] = $this->resolveSchema($schemaName);
        $allowed = array_keys($properties);

        $extra = array_values(array_diff(array_keys($actual), $allowed));
        $this->assertSame([], $extra, "{$label}: مفاتيح فعلية غير موثَّقة: " . implode(', ', $extra));

        $missing = array_values(array_diff($required, array_keys($actual)));
        $this->assertSame([], $missing, "{$label}: مفاتيح إلزامية غائبة: " . implode(', ', $missing));
    }

    private function assertSameSet(array $expected, array $actual, string $label = ''): void
    {
        $missing = array_values(array_diff($expected, $actual));
        $extra = array_values(array_diff($actual, $expected));
        $this->assertSame([], $missing, "{$label}: عناصر متوقّعة غائبة: " . implode(', ', $missing));
        $this->assertSame([], $extra, "{$label}: عناصر غير متوقّعة: " . implode(', ', $extra));
    }

    /**
     * @param  array<string, mixed>  $rules
     */
    private function assertRequestSchemaMatchesFormRequest(string $schemaName, array $rules): void
    {
        [$fields, $required] = $this->requestFields($rules);
        [$properties] = $this->resolveSchema($schemaName);

        $this->assertSameSet(array_keys($properties), $fields, "{$schemaName}: الحقول");
        $this->assertSameSet($this->schemaRequired($schemaName), $required, "{$schemaName}.required");
    }

    private function schemaRequired(string $name): array
    {
        return $this->resolveSchema($name)[1];
    }

    /**
     * يفصل قواعد FormRequest إلى [كل الحقول المشروعة، الإلزامية]، مستبعداً
     * حقول `prohibited` وحدها (مثل `tenant_id`/`customer_id` في طلبات العميل)
     * — تلك حقول مضادّة (يُرفَض العميل إن أرسلها)، لا حقول عقدٍ مُدخَلة.
     *
     * @return array{0: list<string>, 1: list<string>}
     */
    private function requestFields(array $rules): array
    {
        $fields = [];
        $required = [];
        foreach ($rules as $key => $rule) {
            if (str_contains($key, '.')) {
                continue;
            }
            $tokens = $this->ruleTokens($rule);
            if (in_array('prohibited', $tokens, true)) {
                continue;
            }
            $fields[] = $key;
            if (in_array('required', $tokens, true)) {
                $required[] = $key;
            }
        }

        return [$fields, $required];
    }

    private function ruleTokens(mixed $rule): array
    {
        if (is_string($rule)) {
            return explode('|', $rule);
        }
        if (is_array($rule)) {
            return array_values(array_filter($rule, 'is_string'));
        }

        return [];
    }

    // ── تركيبات الاختبار ─────────────────────────────────────────────────

    private const TOKEN_HEADER = 'X-Cart-Token';

    /** @return array{tenant: Tenant, channel: SalesChannel, token: string} */
    private function seedMobileStore(string $slug): array
    {
        $tenant = Tenant::create([
            'name' => "متجر {$slug}", 'slug' => $slug.'-'.Str::random(6),
            'vat_number' => '300000000000003', 'currency' => 'SAR', 'is_active' => true,
        ]);
        app(TenantContext::class)->set($tenant->id);
        $channel = SalesChannel::create([
            'slug' => 'mobile', 'name' => 'تطبيق الجوال', 'type' => SalesChannel::TYPE_MOBILE, 'is_active' => true,
        ]);
        app(TenantContext::class)->forget();

        $client = app(ApiClientKeyService::class)->createClient($tenant, 'mobile-app', true);
        $key = app(ApiClientKeyService::class)->issueKey($client, 'default', []);

        return ['tenant' => $tenant, 'channel' => $channel, 'token' => $key->plainTextToken];
    }

    private function bearer(string $token): array
    {
        return ['Authorization' => 'Bearer '.$token];
    }

    private function withCustomerToken(string $apiToken, string $customerToken): array
    {
        return $this->bearer($apiToken) + ['X-Customer-Token' => $customerToken];
    }

    private function cartHeaders(string $bearerToken, ?string $cartToken = null): array
    {
        $headers = $this->bearer($bearerToken);
        if ($cartToken !== null) {
            $headers[self::TOKEN_HEADER] = $cartToken;
        }

        return $headers;
    }

    private function publishedProduct(array $store): Product
    {
        app(TenantContext::class)->set($store['tenant']->id);
        $product = Product::create([
            'sku' => 'SKU-'.Str::random(6), 'name' => 'منتج منشور', 'name_en' => 'Published Product',
            'type' => 'good', 'unit' => 'piece', 'sale_price' => 5000, 'tax_rate' => 15, 'is_active' => true,
        ]);
        CommerceListing::create(['product_id' => $product->id, 'sales_channel_id' => $store['channel']->id, 'is_published' => true]);
        app(TenantContext::class)->forget();

        return $product->fresh();
    }

    private function publishedVariantProduct(array $store): Product
    {
        app(TenantContext::class)->set($store['tenant']->id);
        $product = Product::create([
            'sku' => 'SKU-'.Str::random(6), 'name' => 'منتج بخيارات', 'name_en' => 'Variant Product',
            'type' => 'good', 'unit' => 'piece', 'sale_price' => 5000, 'tax_rate' => 15, 'is_active' => true,
        ]);
        $product->forceFill(['variant_state' => 'variant_managed'])->save();
        $option = ProductOption::create(['product_id' => $product->id, 'name' => 'اللون', 'name_key' => 'اللون', 'name_en' => 'Color', 'is_active' => true, 'sort_order' => 1]);
        $value = ProductOptionValue::create(['product_option_id' => $option->id, 'value' => 'أحمر', 'value_key' => 'أحمر', 'value_en' => 'Red', 'is_active' => true, 'sort_order' => 1]);
        $variant = ProductVariant::create(['product_id' => $product->id, 'sku' => 'SKU-V-'.Str::random(4), 'combination_key' => $value->id, 'sale_price' => 5500, 'is_active' => true]);
        $variant->optionValues()->attach($value->id, [
            'id' => (string) Str::uuid(), 'tenant_id' => $store['tenant']->id, 'product_option_id' => $option->id,
        ]);
        CommerceListing::create(['product_id' => $product->id, 'sales_channel_id' => $store['channel']->id, 'is_published' => true]);
        app(TenantContext::class)->forget();

        return $product->fresh();
    }

    /** @return array{0: ProductCategory, 1: ProductCategory} root, child */
    private function seedCategoryTree(array $store): array
    {
        app(TenantContext::class)->set($store['tenant']->id);
        $root = ProductCategory::create(['name' => 'جذر', 'is_active' => true]);
        $child = ProductCategory::create(['name' => 'فرع', 'parent_id' => $root->id, 'is_active' => true]);
        CommerceCategoryListing::create(['category_id' => $root->id, 'sales_channel_id' => $store['channel']->id, 'is_published' => true]);
        CommerceCategoryListing::create(['category_id' => $child->id, 'sales_channel_id' => $store['channel']->id, 'is_published' => true]);
        app(TenantContext::class)->forget();

        return [$root->fresh(), $child->fresh()];
    }

    private function cartTokenWithItem(array $store, Product $product): string
    {
        $response = $this->withHeaders($this->bearer($store['token']))
            ->postJson('/commerce/v1/cart/items', ['product_id' => $product->id, 'quantity' => 1])
            ->assertCreated();

        return $response->headers->get(self::TOKEN_HEADER);
    }

    private function createCheckout(array $store, string $cartToken): TestResponse
    {
        return $this->withHeaders($this->cartHeaders($store['token'], $cartToken))->postJson('/commerce/v1/checkout', []);
    }

    private function fullyReadyCheckout(array $store, Product $product): string
    {
        $cartToken = $this->cartTokenWithItem($store, $product);
        $this->createCheckout($store, $cartToken)->assertCreated();
        $this->withHeaders($this->cartHeaders($store['token'], $cartToken))
            ->patchJson('/commerce/v1/checkout/contact', ['name' => 'سالم الأحمدي', 'phone' => '0501234567'])->assertOk();
        $this->withHeaders($this->cartHeaders($store['token'], $cartToken))
            ->patchJson('/commerce/v1/checkout/address', ['country' => 'SA', 'city' => 'الدمام', 'street' => 'شارع الملك فهد'])->assertOk();
        $this->withHeaders($this->cartHeaders($store['token'], $cartToken))
            ->patchJson('/commerce/v1/checkout/delivery', ['method' => 'standard'])->assertOk();

        return $cartToken;
    }

    /** يسجّل عميلاً عبر OTP ويعيد رمز customer:access. */
    private function authenticatedCustomer(array $store): string
    {
        $phone = '+9665'.random_int(10000000, 99999999);
        $this->withHeaders($this->bearer($store['token']))->postJson('/commerce/v1/auth/otp/request', ['phone' => $phone])->assertStatus(202);
        $code = FakeOtpProvider::lastCodeFor($store['tenant']->id, $phone, 'login');

        return $this->withHeaders($this->bearer($store['token']))
            ->postJson('/commerce/v1/auth/otp/verify', ['phone' => $phone, 'code' => $code])
            ->assertOk()->json('data.token');
    }
}
