<?php

namespace Tests\Feature;

use App\Models\PriceList;
use App\Models\Product;
use App\Models\ProductVariant;
use App\Models\SalesChannel;
use App\Models\UnitTemplate;
use App\Models\User;
use App\Services\Commerce\CommercePriceResolver;
use App\Services\ProductPricingService;
use App\Services\ProductVariantService;
use App\Support\Settings;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * ═══════════════════════════════════════════════════════════════
 *  VAR-FU-4/GAP-05 — الحدّ الأدنى للسعر لا يُتجاوَز عبر اختيار متغيّر
 * ═══════════════════════════════════════════════════════════════
 *  يثبت أن `InvoiceService::minimumPriceDecision()` — الحارس الأدنى الوحيد،
 *  على مستوى `Product.min_sale_price` كما كان — يبقى ساري المفعول حرفياً
 *  بصرف النظر عن كون الهويّة القابلة للبيع الآن `Product + product_variant_id
 *  + UOM`. الحارس **لا يقرأ المتغيّر إطلاقاً** (يقرأ `$product->min_sale_price`
 *  وحده من السطر المحلول)، فاختيار متغيّرٍ بعينه لا يغيّر قيمة الحدّ ولا
 *  يفتح مساراً يتفاداه — هذا ما تثبته هذه المجموعة، لا تُدخل سلطة حدٍّ جديدة
 *  ولا تغيّر السياسة القائمة. POS يُعيد استخدام `InvoiceService::create()`
 *  نفسه فيرث نفس الحارس تلقائياً؛ التجارة (`CommercePriceResolver`) تُعيد
 *  `min_sale_price` بياناً وصفياً فقط بتصميمٍ موثَّقٍ مسبقاً — لا إنفاذ هناك،
 *  ولا يُضاف أيّ إنفاذٍ هنا.
 *
 *  تشغيل: php artisan test --filter=VariantMinimumSalePriceGuardTest
 */
class VariantMinimumSalePriceGuardTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    private function customer(string $token): string
    {
        return $this->withToken($token)
            ->postJson('/api/partners', ['name' => 'عميل الحدّ الأدنى', 'type' => 'customer'])
            ->assertCreated()['data']['id'];
    }

    /** منتجٌ بسيطٌ بحدٍّ أدنى 1000.00 (١٠٠٠٠٠ هللة). */
    private function simpleProduct(string $token, int $minSalePrice = 100000): string
    {
        return $this->withToken($token)
            ->postJson('/api/products', [
                'name' => 'منتج بسيط محروس', 'sku' => 'MIN-SIMPLE-'.Str::random(6),
                'type' => 'good', 'sale_price' => 150000, 'min_sale_price' => $minSalePrice,
            ])
            ->assertCreated()['data']['id'];
    }

    /**
     * منتجٌ متعدد الخيارات بحدٍّ أدنى `min_sale_price` على **الأب فقط** — لا
     * تخزين حدٍّ خاصٍّ بالمتغيّر (المهمة تمنع اختراع سلطةٍ كهذه). متغيّران:
     * أسود وأبيض. `$sale_price` على الأب يبقى مرجعاً تراجعياً صالحاً لسعر
     * الأساس (VAR-PRICE-1 البند ٦) لكنه غير محلٍّ هنا — الحارس لا يقرأ سعراً
     * محلولاً إطلاقاً، بل `unit_price` الفعلي المرسَل على السطر.
     *
     * @return array{0: string, 1: ProductVariant, 2: ProductVariant} معرّف المنتج، أسود، أبيض
     */
    private function variantManagedProduct(string $token, string $tenantId, int $minSalePrice = 100000): array
    {
        $productId = $this->withToken($token)
            ->postJson('/api/products', [
                'name' => 'قميصٌ محروس', 'sku' => 'MIN-VAR-'.Str::random(6),
                'type' => 'good', 'sale_price' => 150000, 'min_sale_price' => $minSalePrice,
            ])
            ->assertCreated()['data']['id'];

        app(TenantContext::class)->set($tenantId);
        $product = Product::findOrFail($productId);
        $color = $product->options()->create(['tenant_id' => $tenantId, 'name' => 'اللون', 'name_key' => 'اللون', 'sort_order' => 0]);
        $black = $color->values()->create(['tenant_id' => $tenantId, 'value' => 'أسود', 'value_key' => 'أسود', 'sort_order' => 0]);
        $white = $color->values()->create(['tenant_id' => $tenantId, 'value' => 'أبيض', 'value_key' => 'أبيض', 'sort_order' => 1]);

        $variants = app(ProductVariantService::class);
        $variants->enableVariantManagement($product, null);
        $product = $product->fresh();
        $blackVariant = $variants->createSingleVariant($product, [$black->id], null)['variant'];
        $whiteVariant = $variants->createSingleVariant($product, [$white->id], null)['variant'];
        app(TenantContext::class)->forget();

        return [$productId, $blackVariant, $whiteVariant];
    }

    private function invoicePayload(string $partnerId, array $item): array
    {
        return [
            'partner_id' => $partnerId,
            'tax_inclusive' => false,
            'items' => [array_merge(['quantity' => 1, 'tax_rate' => 0], $item)],
        ];
    }

    // ═══════════════════ ١-٢) أساسٌ للمقارنة: منتجٌ بسيط ═══════════════════

    /** @test */
    public function simple_product_below_min_is_rejected(): void
    {
        $auth = $this->registerTenant();
        $customer = $this->customer($auth['token']);
        $productId = $this->simpleProduct($auth['token']);

        $this->withToken($auth['token'])
            ->postJson('/api/invoices', $this->invoicePayload($customer, ['product_id' => $productId, 'unit_price' => 99999]))
            ->assertStatus(422);
    }

    /** @test */
    public function simple_product_equal_min_is_accepted(): void
    {
        $auth = $this->registerTenant();
        $customer = $this->customer($auth['token']);
        $productId = $this->simpleProduct($auth['token']);

        $this->withToken($auth['token'])
            ->postJson('/api/invoices', $this->invoicePayload($customer, ['product_id' => $productId, 'unit_price' => 100000]))
            ->assertCreated()
            ->assertJsonPath('data.lines.0.minimum_price_override', null);
    }

    // ═══════════════════ ٣-٥) سعرٌ صريحٌ للمتغيّر: تحت/يساوي/فوق الحدّ ═══════════════════

    /** @test */
    public function variant_explicit_price_below_product_min_cannot_bypass_guard(): void
    {
        $auth = $this->registerTenant();
        $customer = $this->customer($auth['token']);
        [$productId, $black, $white] = $this->variantManagedProduct($auth['token'], $auth['tenant_id']);

        // أبيض: سعرٌ قانونيٌّ صريحٌ ٨٠٠.٠٠ — أقل من حدّ الأب ١٠٠٠.٠٠.
        app(TenantContext::class)->set($auth['tenant_id']);
        app(ProductPricingService::class)->setPrice(Product::findOrFail($productId), $white->fresh(), null, 80000);
        app(TenantContext::class)->forget();

        $this->withToken($auth['token'])
            ->postJson('/api/invoices', $this->invoicePayload($customer, [
                'product_id' => $productId, 'product_variant_id' => $white->id, 'unit_price' => 80000,
            ]))
            ->assertStatus(422)
            ->assertJsonPath('message', 'سعر «قميصٌ محروس» الصافي أقل من الحد الأدنى. اكتب سبب الاستثناء وأرسله لاعتماد مدير أو مالك.');
    }

    /** @test */
    public function variant_explicit_price_equal_min_follows_normal_allowed_path(): void
    {
        $auth = $this->registerTenant();
        $customer = $this->customer($auth['token']);
        [$productId, $black] = $this->variantManagedProduct($auth['token'], $auth['tenant_id']);

        $response = $this->withToken($auth['token'])
            ->postJson('/api/invoices', $this->invoicePayload($customer, [
                'product_id' => $productId, 'product_variant_id' => $black->id, 'unit_price' => 100000,
            ]))
            ->assertCreated();

        $response->assertJsonPath('data.lines.0.minimum_price_override', null);
        $response->assertJsonPath('data.lines.0.product_variant_id', $black->id);
    }

    /** @test */
    public function variant_explicit_price_above_min_is_allowed(): void
    {
        $auth = $this->registerTenant();
        $customer = $this->customer($auth['token']);
        [$productId, $black] = $this->variantManagedProduct($auth['token'], $auth['tenant_id']);

        $this->withToken($auth['token'])
            ->postJson('/api/invoices', $this->invoicePayload($customer, [
                'product_id' => $productId, 'product_variant_id' => $black->id, 'unit_price' => 150000,
            ]))
            ->assertCreated()
            ->assertJsonPath('data.lines.0.minimum_price_override', null);
    }

    // ═══════════════════ ٦-٨) سلطة التسعير (VAR-PRICE-1) لا تُغيَّر ═══════════════════

    /** @test */
    public function variant_using_product_same_uom_canonical_fallback_still_receives_min_guard(): void
    {
        $auth = $this->registerTenant();
        $customer = $this->customer($auth['token']);
        // أبيض بلا سعرٍ صريحٍ خاصٍّ به — لو بِيع فعلياً بسعر سقوط الأب (١٥٠٠.٠٠،
        // فوق الحدّ) يُقبَل بلا استثناء؛ ولو أُرسل سطرٌ دونه (٨٠٠.٠٠، كأنّ
        // العميل أدخل سعراً غير مطابقٍ لسقوط الأب) يبقى الحارس ساري المفعول
        // بصرف النظر عن سلطة التسعير — الحارس لا يستشير `ProductPricingService`
        // إطلاقاً، فلا صلة بين مصدر الرقم وتفعيل الحارس.
        [$productId, , $white] = $this->variantManagedProduct($auth['token'], $auth['tenant_id']);

        $this->withToken($auth['token'])
            ->postJson('/api/invoices', $this->invoicePayload($customer, [
                'product_id' => $productId, 'product_variant_id' => $white->id, 'unit_price' => 150000,
            ]))
            ->assertCreated()
            ->assertJsonPath('data.lines.0.minimum_price_override', null);

        $this->withToken($auth['token'])
            ->postJson('/api/invoices', $this->invoicePayload($customer, [
                'product_id' => $productId, 'product_variant_id' => $white->id, 'unit_price' => 80000,
            ]))
            ->assertStatus(422);
    }

    /** @test */
    public function alternate_uom_variant_price_receives_correctly_converted_min_guard(): void
    {
        $auth = $this->registerTenant();
        $customer = $this->customer($auth['token']);
        [$productId, $black] = $this->variantManagedProduct($auth['token'], $auth['tenant_id'], minSalePrice: 10000); // ١٠٠.٠٠ للوحدة الأساس

        app(TenantContext::class)->set($auth['tenant_id']);
        $template = UnitTemplate::create(['tenant_id' => $auth['tenant_id'], 'name' => 'قالبٌ محروس', 'base_unit' => 'piece']);
        $template->units()->create(['tenant_id' => $auth['tenant_id'], 'name' => 'pack', 'factor' => 6]);
        Product::whereKey($productId)->update(['unit_template_id' => $template->id, 'unit' => 'piece']);
        // سعرٌ صريحٌ للمتغيّر بوحدة «pack» — ٦٥٠.٠٠ للعبوة كلّها (لا مشتقّاً من المعامل).
        app(ProductPricingService::class)->setPrice(Product::findOrFail($productId), $black->fresh(), 'pack', 65000);
        app(TenantContext::class)->forget();

        // الحدّ الأدنى للعبوة = ١٠٠.٠٠ × ٦ = ٦٠٠.٠٠ — ٦٥٠.٠٠ فوقه فيُقبَل بلا استثناء.
        $this->withToken($auth['token'])
            ->postJson('/api/invoices', $this->invoicePayload($customer, [
                'product_id' => $productId, 'product_variant_id' => $black->id, 'unit' => 'pack', 'unit_price' => 65000,
            ]))
            ->assertCreated()
            ->assertJsonPath('data.lines.0.minimum_price_override', null);

        // ٥٩٠.٠٠ للعبوة أقل من ٦٠٠.٠٠ المحوَّل — يُرفض دون استثناء.
        $this->withToken($auth['token'])
            ->postJson('/api/invoices', $this->invoicePayload($customer, [
                'product_id' => $productId, 'product_variant_id' => $black->id, 'unit' => 'pack', 'unit_price' => 59000,
            ]))
            ->assertStatus(422);
    }

    /** @test */
    public function no_factor_derived_price_affects_the_min_price_comparison(): void
    {
        // العبوة (معاملها ٦) بسعرٍ صريحٍ ١٠٠.٠٠ فقط — أقل بكثير من ٦×الأساس
        // (لو اشتُقّ خطأً) لكنه فوق الحدّ الأدنى المحوَّل الحقيقي (الحدّ ١٠.٠٠
        // للأساس × ٦ = ٦٠.٠٠). يثبت أن المقارنة لا تفترض سعراً مشتقّاً من
        // المعامل في أيّ اتجاه — القيمة المُرسَلة صريحةً هي ما يُقاس.
        $auth = $this->registerTenant();
        $customer = $this->customer($auth['token']);
        [$productId, $black] = $this->variantManagedProduct($auth['token'], $auth['tenant_id'], minSalePrice: 1000); // ١٠.٠٠ للأساس

        app(TenantContext::class)->set($auth['tenant_id']);
        $template = UnitTemplate::create(['tenant_id' => $auth['tenant_id'], 'name' => 'قالبٌ آخر', 'base_unit' => 'piece']);
        $template->units()->create(['tenant_id' => $auth['tenant_id'], 'name' => 'pack', 'factor' => 6]);
        Product::whereKey($productId)->update(['unit_template_id' => $template->id, 'unit' => 'piece']);
        app(TenantContext::class)->forget();

        $this->withToken($auth['token'])
            ->postJson('/api/invoices', $this->invoicePayload($customer, [
                'product_id' => $productId, 'product_variant_id' => $black->id, 'unit' => 'pack', 'unit_price' => 10000,
            ]))
            ->assertCreated()
            ->assertJsonPath('data.lines.0.minimum_price_override', null);
    }

    // ═══════════════════ ٩-١٠) قائمة السعر/أسبقية العميل لا تتجاوز الحارس ═══════════════════

    /** @test */
    public function price_list_resolved_price_below_min_still_receives_the_guard_in_pos(): void
    {
        $auth = $this->registerTenant();
        [$productId, $black] = $this->variantManagedProduct($auth['token'], $auth['tenant_id']);
        $customerId = $this->customer($auth['token']);

        app(TenantContext::class)->set($auth['tenant_id']);
        $priceList = PriceList::create(['tenant_id' => $auth['tenant_id'], 'name' => 'قائمة عميلٍ محروسة', 'is_active' => true]);
        app(\App\Services\PriceListService::class)->upsertItem(
            $priceList, Product::findOrFail($productId), ['price' => 80000], $black->fresh() // أقل من الحدّ ١٠٠٠.٠٠
        );
        \App\Models\Partner::whereKey($customerId)->update(['default_price_list_id' => $priceList->id]);
        app(TenantContext::class)->forget();

        $warehouseId = $this->withToken($auth['token'])->postJson('/api/warehouses', [
            'name' => 'مخزن الحدّ الأدنى', 'code' => 'MIN-VAR-W', 'is_active' => true,
        ])->assertCreated()['data']['id'];
        $deviceId = $this->withToken($auth['token'])->postJson('/api/pos-devices', [
            'name' => 'كاشير الحدّ الأدنى', 'code' => 'MIN-VAR-POS', 'warehouse_id' => $warehouseId, 'is_active' => true,
        ])->assertCreated()['data']['id'];
        $sessionId = $this->withToken($auth['token'])
            ->postJson('/api/pos-sessions/open', ['opening_balance' => 0, 'pos_device_id' => $deviceId])
            ->assertCreated()['data']['id'];

        // سعر القائمة (٨٠٠.٠٠) يمرّ تلقائياً بلا حاجة للسماح بتعديل السعر —
        // POS يقبله كمطابقٍ لقائمة العميل النشطة، ثم الحارس الأدنى يرفضه رغم ذلك.
        $this->withToken($auth['token'])
            ->postJson('/api/pos/checkout', [
                'idempotency_key' => (string) Str::uuid(),
                'partner_id' => $customerId,
                'pos_session_id' => $sessionId,
                'items' => [[
                    'product_id' => $productId, 'product_variant_id' => $black->id,
                    'quantity' => 1, 'unit_price' => 80000, 'tax_rate' => 0,
                ]],
                'tenders' => ['credit' => 80000],
            ])
            ->assertStatus(422)
            ->assertJsonPath('message', 'سعر «قميصٌ محروس» الصافي أقل من الحد الأدنى. اكتب سبب الاستثناء وأرسله لاعتماد مدير أو مالك.');
    }

    // ═══════════════════ ١١-١٤) الاستثناء: صلاحية/سبب/فاعل ═══════════════════

    /** @test */
    public function allowed_override_succeeds_for_a_variant_sale_with_reason_and_permission(): void
    {
        $auth = $this->registerTenant();
        $customer = $this->customer($auth['token']);
        [$productId, , $white] = $this->variantManagedProduct($auth['token'], $auth['tenant_id']);
        $owner = User::where('tenant_id', $auth['tenant_id'])->firstOrFail();

        $this->withToken($auth['token'])
            ->postJson('/api/invoices', $this->invoicePayload($customer, [
                'product_id' => $productId, 'product_variant_id' => $white->id, 'unit_price' => 80000,
                'minimum_price_override_reason' => 'تصريف مخزون المتغيّر الأبيض',
            ]))
            ->assertCreated()
            ->assertJsonPath('data.lines.0.min_sale_price', '1000.00')
            ->assertJsonPath('data.lines.0.minimum_price_override.reason', 'تصريف مخزون المتغيّر الأبيض')
            ->assertJsonPath('data.lines.0.minimum_price_override.approved_by_user_id', $owner->id)
            ->assertJsonPath('data.lines.0.product_variant_id', $white->id);
    }

    /** @test */
    public function override_without_permission_fails_for_a_variant_sale(): void
    {
        $owner = $this->registerTenant();
        $customer = $this->customer($owner['token']);
        [$productId, , $white] = $this->variantManagedProduct($owner['token'], $owner['tenant_id']);
        $accountant = $this->tokenForRole($owner['tenant_id'], 'accountant', 'accountant@var-min-price.test');

        $this->withToken($accountant)
            ->postJson('/api/invoices', $this->invoicePayload($customer, [
                'product_id' => $productId, 'product_variant_id' => $white->id, 'unit_price' => 80000,
                'minimum_price_override_reason' => 'طلب خصمٍ خاص',
            ]))
            ->assertStatus(422)
            ->assertJsonPath('message', 'السعر الأقل من الحد الأدنى يتطلب اعتماد مالك أو مدير مخوّل.');
    }

    /** @test */
    public function override_requires_a_reason_and_fails_without_one_for_a_variant_sale(): void
    {
        $auth = $this->registerTenant();
        $customer = $this->customer($auth['token']);
        [$productId, , $white] = $this->variantManagedProduct($auth['token'], $auth['tenant_id']);

        $this->withToken($auth['token'])
            ->postJson('/api/invoices', $this->invoicePayload($customer, [
                'product_id' => $productId, 'product_variant_id' => $white->id, 'unit_price' => 80000,
            ]))
            ->assertStatus(422)
            ->assertJsonPath('message', 'سعر «قميصٌ محروس» الصافي أقل من الحد الأدنى. اكتب سبب الاستثناء وأرسله لاعتماد مدير أو مالك.');
    }

    /** @test */
    public function override_actor_propagates_correctly_for_the_variant_override_path(): void
    {
        $auth = $this->registerTenant();
        $customer = $this->customer($auth['token']);
        [$productId, , $white] = $this->variantManagedProduct($auth['token'], $auth['tenant_id']);
        $owner = User::where('tenant_id', $auth['tenant_id'])->firstOrFail();

        // لا `minimum_price_override_actor_id` في حمولة العميل إطلاقاً — يُحقَن
        // خادمياً من المستخدم المصادَق فقط (InvoiceController). تأكيدٌ أن مسار
        // المتغيّر لا يفتح قناة فاعلٍ إضافية أو أوسع من مسار المنتج البسيط.
        $response = $this->withToken($auth['token'])
            ->postJson('/api/invoices', $this->invoicePayload($customer, [
                'product_id' => $productId, 'product_variant_id' => $white->id, 'unit_price' => 80000,
                'minimum_price_override_reason' => 'استثناءٌ تجريبي',
            ]))
            ->assertCreated();

        $response->assertJsonPath('data.lines.0.minimum_price_override.approved_by_user_id', $owner->id);
    }

    // ═══════════════════ ١٥-١٧) فشلٌ مغلَق قبل بلوغ الحارس أصلاً ═══════════════════

    /** @test */
    public function a_variant_belonging_to_a_different_product_fails_closed_before_the_price_guard(): void
    {
        $auth = $this->registerTenant();
        $customer = $this->customer($auth['token']);
        [$productAId] = $this->variantManagedProduct($auth['token'], $auth['tenant_id'], minSalePrice: 100000);
        [, $variantOfB] = $this->variantManagedProduct($auth['token'], $auth['tenant_id'], minSalePrice: 100000);

        // سعرٌ عالٍ جداً (فوق أي حدٍّ) — لو نجح الحارس المرور لكان هذا مقبولاً؛
        // الرفض هنا مصدره حصراً تحقّق الهويّة (VAR-DOC-1)، لا الحدّ الأدنى.
        $this->withToken($auth['token'])
            ->postJson('/api/invoices', $this->invoicePayload($customer, [
                'product_id' => $productAId, 'product_variant_id' => $variantOfB->id, 'unit_price' => 999999,
            ]))
            ->assertStatus(422)
            ->assertJsonPath('message', 'المتغيّر المحدَّد لا يتبع هذا المنتج.');
    }

    /** @test */
    public function a_cross_tenant_variant_is_a_negative_control_and_never_influences_pricing(): void
    {
        $first = $this->registerTenant('min-var-a', 'owner-a@min-var.test');
        [, $variantOfA] = $this->variantManagedProduct($first['token'], $first['tenant_id']);

        $second = $this->registerTenant('min-var-b', 'owner-b@min-var.test');
        $customerB = $this->customer($second['token']);
        [$productBId] = $this->variantManagedProduct($second['token'], $second['tenant_id']);

        $this->withToken($second['token'])
            ->postJson('/api/invoices', $this->invoicePayload($customerB, [
                'product_id' => $productBId, 'product_variant_id' => $variantOfA->id, 'unit_price' => 999999,
            ]))
            ->assertStatus(422)
            ->assertJsonPath('message', 'المتغيّر المحدَّد لا يتبع هذا المنتج.');
    }

    /** @test */
    public function an_inactive_variant_cannot_be_sold_regardless_of_price(): void
    {
        $auth = $this->registerTenant();
        $customer = $this->customer($auth['token']);
        [$productId, $black] = $this->variantManagedProduct($auth['token'], $auth['tenant_id']);

        app(TenantContext::class)->set($auth['tenant_id']);
        $black->update(['is_active' => false]);
        app(TenantContext::class)->forget();

        $this->withToken($auth['token'])
            ->postJson('/api/invoices', $this->invoicePayload($customer, [
                'product_id' => $productId, 'product_variant_id' => $black->id, 'unit_price' => 150000,
            ]))
            ->assertStatus(422)
            ->assertJsonPath('message', 'هذا المتغيّر معطَّل ولا يصلح للاستخدام التجاري.');
    }

    // ═══════════════════ ١٨) حدّ الهللة بدقّة ═══════════════════

    /** @test */
    public function the_halala_boundary_is_exact_for_a_variant_sale(): void
    {
        $auth = $this->registerTenant();
        $customer = $this->customer($auth['token']);
        [$productId, $black] = $this->variantManagedProduct($auth['token'], $auth['tenant_id'], minSalePrice: 1000);

        // ٩٩٩ هللة: أقل من الحدّ.
        $this->withToken($auth['token'])
            ->postJson('/api/invoices', $this->invoicePayload($customer, [
                'product_id' => $productId, 'product_variant_id' => $black->id, 'unit_price' => 999,
            ]))
            ->assertStatus(422);

        // ١٠٠٠ هللة: يساوي الحدّ — مقبول.
        $this->withToken($auth['token'])
            ->postJson('/api/invoices', $this->invoicePayload($customer, [
                'product_id' => $productId, 'product_variant_id' => $black->id, 'unit_price' => 1000,
            ]))
            ->assertCreated()
            ->assertJsonPath('data.lines.0.minimum_price_override', null);

        // ١٠٠١ هللة: فوق الحدّ — مقبول.
        $this->withToken($auth['token'])
            ->postJson('/api/invoices', $this->invoicePayload($customer, [
                'product_id' => $productId, 'product_variant_id' => $black->id, 'unit_price' => 1001,
            ]))
            ->assertCreated()
            ->assertJsonPath('data.lines.0.minimum_price_override', null);
    }

    // ═══════════════════ ٢٠) انحدار: فاتورةٌ عادية بسطرين معاً ═══════════════════

    /** @test */
    public function a_normal_invoice_guards_a_simple_line_and_a_variant_line_independently_together(): void
    {
        $auth = $this->registerTenant();
        $customer = $this->customer($auth['token']);
        $simpleId = $this->simpleProduct($auth['token'], minSalePrice: 50000);
        [$variantProductId, $black, $white] = $this->variantManagedProduct($auth['token'], $auth['tenant_id'], minSalePrice: 100000);

        // السطر البسيط فوق حدّه (٦٠٠.٠٠ > ٥٠٠.٠٠)، وسطر «أبيض» تحت حدّ الأب
        // (٨٠٠.٠٠ < ١٠٠٠.٠٠) — الفاتورة كلّها تُرفض بسبب السطر الثاني وحده،
        // ولا يُنشأ شيء (لا كتابة جزئية).
        $this->withToken($auth['token'])
            ->postJson('/api/invoices', [
                'partner_id' => $customer, 'tax_inclusive' => false,
                'items' => [
                    ['product_id' => $simpleId, 'quantity' => 1, 'unit_price' => 60000, 'tax_rate' => 0],
                    ['product_id' => $variantProductId, 'product_variant_id' => $white->id, 'quantity' => 1, 'unit_price' => 80000, 'tax_rate' => 0],
                ],
            ])
            ->assertStatus(422);

        // الآن كلا السطرين فوق حدّهما — تُقبَل الفاتورة بسطرين، وكلٌّ منهما
        // بلا استثناء.
        $response = $this->withToken($auth['token'])
            ->postJson('/api/invoices', [
                'partner_id' => $customer, 'tax_inclusive' => false,
                'items' => [
                    ['product_id' => $simpleId, 'quantity' => 1, 'unit_price' => 60000, 'tax_rate' => 0],
                    ['product_id' => $variantProductId, 'product_variant_id' => $black->id, 'quantity' => 1, 'unit_price' => 150000, 'tax_rate' => 0],
                ],
            ])
            ->assertCreated();

        $response->assertJsonPath('data.lines.0.minimum_price_override', null);
        $response->assertJsonPath('data.lines.1.minimum_price_override', null);
        $response->assertJsonPath('data.lines.1.product_variant_id', $black->id);
    }

    // ═══════════════════ ٢٢) حدّ التجارة (Commerce) — وصفيٌّ لا إنفاذيّ بتصميم موثَّق ═══════════════════

    /** @test */
    public function commerce_price_resolver_returns_min_sale_price_as_descriptive_metadata_only_for_a_variant(): void
    {
        // CommerceOrderService لا يستدعي InvoiceService/LedgerService إطلاقاً
        // (حدٌّ معماريٌّ موثَّقٌ صراحةً في رأس الملف) — لا مستندٌ ماليٌّ يُنشأ عند
        // التأكيد التجاري، فلا نقطة إنفاذٍ فعلية هناك بعد. هذا الاختبار يثبت
        // أن سلوك `CommercePriceResolver` الحالي هذا لم يتغيّر بهذه المهمة:
        // سعرٌ صريحٌ للمتغيّر أقل من حدّ الأب يُحسم بنجاح (`resolved === true`)
        // مع `minSalePrice` كبيانٍ وصفي فقط — لا رفض، لا استثناء.
        $auth = $this->registerTenant();
        [$productId, , $white] = $this->variantManagedProduct($auth['token'], $auth['tenant_id']);

        app(TenantContext::class)->set($auth['tenant_id']);
        $product = Product::findOrFail($productId);
        $variant = $white->fresh();
        app(ProductPricingService::class)->setPrice($product, $variant, null, 80000); // تحت الحدّ ١٠٠٠.٠٠
        $channel = SalesChannel::create([
            'slug' => 'min-price-channel', 'name' => 'قناة اختبار الحدّ الأدنى',
            'type' => SalesChannel::TYPE_WEB, 'is_active' => true,
        ]);

        $resolved = app(CommercePriceResolver::class)->resolve(
            productId: $product->id,
            salesChannelId: $channel->id,
            variantId: $variant->id,
        );

        $this->assertTrue($resolved->resolved);
        $this->assertSame(80000, $resolved->amount);
        $this->assertSame(100000, $resolved->minSalePrice, 'الحدّ الأدنى يُعاد وصفياً — لا إنفاذ في طبقة التجارة.');
        app(TenantContext::class)->forget();
    }
}
