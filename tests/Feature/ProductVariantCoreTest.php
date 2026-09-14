<?php

namespace Tests\Feature;

use App\Models\Product;
use App\Models\ProductOption;
use App\Models\ProductOptionValue;
use App\Models\ProductVariant;
use App\Models\SkuRegistryEntry;
use App\Services\ProductVariantService;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * ═══════════════════════════════════════════════════════════════
 *  VAR-CORE-1 — خيارات/قيم/متغيّرات المنتج
 * ═══════════════════════════════════════════════════════════════
 *  يغطي: دورة حياة الخيار/القيمة، مصفوفة التركيبات، إنشاء المتغيّرات، منع
 *  الازدواج، فضاء SKU الموحّد بين المنتج والمتغيّر، الانتقال بسيط⇄متعدد،
 *  والعزل بين المستأجرين (سلبيّاً). تزامن PostgreSQL الحقيقي في اختبارٍ منفصل
 *  (`ProductVariantPostgresConcurrencyTest`) — لا يعمل تحت SQLite.
 */
class ProductVariantCoreTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    private function createSimpleProduct(string $token, string $name = 'قميص كلاسيك', string $sku = 'SHIRT-001'): array
    {
        return $this->withToken($token)->postJson('/api/products', [
            'name' => $name, 'sku' => $sku, 'type' => 'good', 'sale_price' => 10000,
        ])->assertCreated()->json('data');
    }

    private function enableVariants(string $token, string $productId): \Illuminate\Testing\TestResponse
    {
        return $this->withToken($token)->postJson("/api/products/{$productId}/variants/enable");
    }

    private function addOption(string $token, string $productId, string $name): array
    {
        return $this->withToken($token)->postJson("/api/products/{$productId}/options", ['name' => $name])
            ->assertCreated()->json('data');
    }

    private function addValue(string $token, string $productId, string $optionId, string $value): array
    {
        return $this->withToken($token)->postJson("/api/products/{$productId}/options/{$optionId}/values", ['value' => $value])
            ->assertCreated()->json('data');
    }

    // ───────────────────────── بسيط يبقى بسيطاً ─────────────────────────

    /** @test */
    public function a_simple_product_has_no_variants_and_needs_no_synthetic_default(): void
    {
        $auth = $this->registerTenant();
        $product = $this->createSimpleProduct($auth['token']);

        $this->assertSame('simple', $product['variant_state']);

        $this->withToken($auth['token'])->getJson("/api/products/{$product['id']}/variants")
            ->assertOk()
            ->assertJsonCount(0, 'data');
    }

    // ───────────────────────── خيارات وقيم ─────────────────────────

    /** @test */
    public function options_and_values_can_be_built_after_enabling_variant_management(): void
    {
        $auth = $this->registerTenant();
        $product = $this->createSimpleProduct($auth['token']);

        $this->enableVariants($auth['token'], $product['id'])
            ->assertOk()
            ->assertJsonPath('data.variant_state', 'variant_managed');

        $color = $this->addOption($auth['token'], $product['id'], 'اللون');
        $this->addValue($auth['token'], $product['id'], $color['id'], 'أسود');
        $this->addValue($auth['token'], $product['id'], $color['id'], 'أبيض');

        $this->withToken($auth['token'])->getJson("/api/products/{$product['id']}/options")
            ->assertOk()
            ->assertJsonCount(1, 'data')
            ->assertJsonCount(2, 'data.0.values');
    }

    /** @test */
    public function duplicate_option_names_are_rejected_after_normalization(): void
    {
        $auth = $this->registerTenant();
        $product = $this->createSimpleProduct($auth['token']);
        $this->enableVariants($auth['token'], $product['id']);

        $this->addOption($auth['token'], $product['id'], 'اللون');

        $this->withToken($auth['token'])->postJson("/api/products/{$product['id']}/options", ['name' => '  اللون  '])
            ->assertStatus(422);
    }

    /** @test */
    public function duplicate_option_values_are_rejected_after_normalization(): void
    {
        $auth = $this->registerTenant();
        $product = $this->createSimpleProduct($auth['token']);
        $this->enableVariants($auth['token'], $product['id']);
        $color = $this->addOption($auth['token'], $product['id'], 'اللون');

        $this->addValue($auth['token'], $product['id'], $color['id'], 'أسود');

        $this->withToken($auth['token'])->postJson("/api/products/{$product['id']}/options/{$color['id']}/values", ['value' => ' أسود '])
            ->assertStatus(422);
    }

    // ───────────────────────── التركيبات والمتغيّرات ─────────────────────────

    /** @test */
    public function combinations_are_proposed_and_created_only_after_explicit_selection(): void
    {
        $auth = $this->registerTenant();
        $product = $this->createSimpleProduct($auth['token']);
        $this->enableVariants($auth['token'], $product['id']);

        $color = $this->addOption($auth['token'], $product['id'], 'اللون');
        $black = $this->addValue($auth['token'], $product['id'], $color['id'], 'أسود');
        $white = $this->addValue($auth['token'], $product['id'], $color['id'], 'أبيض');

        $size = $this->addOption($auth['token'], $product['id'], 'المقاس');
        $m = $this->addValue($auth['token'], $product['id'], $size['id'], 'M');
        $xl = $this->addValue($auth['token'], $product['id'], $size['id'], 'XL');

        $matrix = $this->withToken($auth['token'])->getJson("/api/products/{$product['id']}/variants/combinations")
            ->assertOk()->json();

        $this->assertSame(4, $matrix['total_possible']);
        $this->assertCount(4, $matrix['combinations']);
        foreach ($matrix['combinations'] as $combo) {
            $this->assertFalse($combo['exists']);
        }

        // إنشاءٌ صريح لتركيبتين فقط من أصل أربع — لا Cartesian صامت.
        $selected = [
            [$black['id'], $m['id']],
            [$black['id'], $xl['id']],
        ];

        $result = $this->withToken($auth['token'])->postJson("/api/products/{$product['id']}/variants", [
            'combinations' => $selected,
        ])->assertStatus(201)->json();

        $this->assertCount(2, $result['created']);
        $this->assertCount(0, $result['duplicates']);

        $this->withToken($auth['token'])->getJson("/api/products/{$product['id']}/variants")
            ->assertOk()
            ->assertJsonCount(2, 'data');

        // إعادة نفس الطلب: كلاهما مكرّر الآن، لا تركيبتان جديدتان.
        $again = $this->withToken($auth['token'])->postJson("/api/products/{$product['id']}/variants", [
            'combinations' => $selected,
        ])->assertStatus(201)->json();

        $this->assertCount(0, $again['created']);
        $this->assertCount(2, $again['duplicates']);

        // لا شيء تكرر فعلياً في القاعدة.
        $this->assertSame(2, ProductVariant::where('product_id', $product['id'])->count());
    }

    /** @test */
    public function combination_identity_is_order_independent_and_server_derived(): void
    {
        $auth = $this->registerTenant();
        app(TenantContext::class)->set($auth['tenant_id']);

        $product = $this->createSimpleProduct($auth['token']);
        $this->enableVariants($auth['token'], $product['id']);
        $color = $this->addOption($auth['token'], $product['id'], 'اللون');
        $black = $this->addValue($auth['token'], $product['id'], $color['id'], 'أسود');
        $size = $this->addOption($auth['token'], $product['id'], 'المقاس');
        $xl = $this->addValue($auth['token'], $product['id'], $size['id'], 'XL');

        $service = app(ProductVariantService::class);
        $productModel = Product::find($product['id']);

        $first = $service->createSingleVariant($productModel, [$black['id'], $xl['id']], null);
        $this->assertSame('created', $first['status']);

        // نفس المجموعة بترتيبٍ معكوس — يجب أن تُكتشف كمكرّرة، لا متغيّرٍ ثانٍ.
        $second = $service->createSingleVariant($productModel, [$xl['id'], $black['id']], null);
        $this->assertSame('duplicate', $second['status']);

        $this->assertSame(1, ProductVariant::where('product_id', $product['id'])->count());
    }

    /** @test */
    public function a_variant_cannot_select_two_values_from_the_same_option(): void
    {
        $auth = $this->registerTenant();
        app(TenantContext::class)->set($auth['tenant_id']);
        $product = $this->createSimpleProduct($auth['token']);
        $this->enableVariants($auth['token'], $product['id']);
        $color = $this->addOption($auth['token'], $product['id'], 'اللون');
        $black = $this->addValue($auth['token'], $product['id'], $color['id'], 'أسود');
        $white = $this->addValue($auth['token'], $product['id'], $color['id'], 'أبيض');

        $service = app(ProductVariantService::class);
        $productModel = Product::find($product['id']);

        $result = $service->createVariants($productModel, [[$black['id'], $white['id']]], null);

        $this->assertCount(0, $result['created']);
        $this->assertCount(1, $result['failed']);
    }

    /** @test */
    public function a_variant_must_cover_every_active_option_of_its_product(): void
    {
        $auth = $this->registerTenant();
        app(TenantContext::class)->set($auth['tenant_id']);
        $product = $this->createSimpleProduct($auth['token']);
        $this->enableVariants($auth['token'], $product['id']);
        $color = $this->addOption($auth['token'], $product['id'], 'اللون');
        $black = $this->addValue($auth['token'], $product['id'], $color['id'], 'أسود');
        $size = $this->addOption($auth['token'], $product['id'], 'المقاس');
        $this->addValue($auth['token'], $product['id'], $size['id'], 'M');

        $service = app(ProductVariantService::class);
        $productModel = Product::find($product['id']);

        // قيمة اللون فقط بلا مقاس — يجب الرفض، لا إنشاء متغيّرٍ ناقص التغطية.
        $result = $service->createVariants($productModel, [[$black['id']]], null);

        $this->assertCount(0, $result['created']);
        $this->assertCount(1, $result['failed']);
    }

    // ───────────────────────── فضاء SKU الموحّد ─────────────────────────

    /** @test */
    public function a_new_product_cannot_take_the_sku_of_an_existing_variant(): void
    {
        $auth = $this->registerTenant();
        $product = $this->createSimpleProduct($auth['token'], sku: 'SHIRT-001');
        $this->enableVariants($auth['token'], $product['id']);
        $color = $this->addOption($auth['token'], $product['id'], 'اللون');
        $black = $this->addValue($auth['token'], $product['id'], $color['id'], 'أسود');

        $variants = $this->withToken($auth['token'])->postJson("/api/products/{$product['id']}/variants", [
            'combinations' => [[$black['id']]],
        ])->assertStatus(201)->json();

        $variantSku = $variants['created'][0]['sku'];

        $this->withToken($auth['token'])->postJson('/api/products', [
            'name' => 'منتجٌ آخر', 'sku' => $variantSku, 'type' => 'good', 'sale_price' => 5000,
        ])->assertStatus(422);
    }

    /** @test */
    public function a_variant_cannot_take_the_sku_of_an_existing_product(): void
    {
        $auth = $this->registerTenant();
        app(TenantContext::class)->set($auth['tenant_id']);

        $this->createSimpleProduct($auth['token'], 'منتجٌ آخر', 'TAKEN-SKU');

        $product = $this->createSimpleProduct($auth['token'], 'قميص', 'SHIRT-002');
        $this->enableVariants($auth['token'], $product['id']);
        $color = $this->addOption($auth['token'], $product['id'], 'اللون');
        $black = $this->addValue($auth['token'], $product['id'], $color['id'], 'أسود');

        $service = app(ProductVariantService::class);
        $productModel = Product::find($product['id']);

        $this->expectException(\RuntimeException::class);
        try {
            $service->createSingleVariant($productModel, [$black['id']], null, sku: 'TAKEN-SKU');
        } finally {
            // فشل صريحٌ لا صفّاً يتيماً: لا متغيّر ولا تسجيلاً مزدوَجاً.
            $this->assertSame(1, SkuRegistryEntry::where('sku', 'TAKEN-SKU')->count());
            $this->assertDatabaseMissing('product_variants', ['sku' => 'TAKEN-SKU']);
        }
    }

    /** @test */
    public function auto_generated_variant_sku_avoids_a_registry_collision_with_a_single_fallback(): void
    {
        $auth = $this->registerTenant();
        app(TenantContext::class)->set($auth['tenant_id']);
        $product = $this->createSimpleProduct($auth['token'], sku: 'SHIRT-003');
        $this->enableVariants($auth['token'], $product['id']);
        $color = $this->addOption($auth['token'], $product['id'], 'اللون');
        $black = $this->addValue($auth['token'], $product['id'], $color['id'], 'Black');

        // نحجز مسبقاً بالضبط SKU الذي سيولّده المحرك تلقائياً (SHIRT-003-BLACK)
        // كي نجبره على مسار المحاولة الثانية — عبر متغيّرٍ نائبٍ حقيقيٍّ (لا
        // معرّفٍ عشوائي) لأن `product_variant_id` مفتاحٌ أجنبي حقيقي.
        $placeholderId = (string) \Illuminate\Support\Str::uuid();
        \Illuminate\Support\Facades\DB::table('product_variants')->insert([
            'id' => $placeholderId,
            'tenant_id' => $auth['tenant_id'],
            'product_id' => $product['id'],
            'sku' => 'SHIRT-003-BLACK',
            'combination_key' => 'placeholder-seed',
            'is_active' => true,
            'created_at' => now(), 'updated_at' => now(),
        ]);
        SkuRegistryEntry::claim('SHIRT-003-BLACK', 'variant', variantId: $placeholderId);

        $service = app(ProductVariantService::class);
        $productModel = Product::find($product['id']);

        $result = $service->createSingleVariant($productModel, [$black['id']], null);

        $this->assertSame('created', $result['status']);
        $this->assertSame('SHIRT-003-BLACK-2', $result['variant']->sku);
    }

    // ───────────────────────── الانتقال بسيط ⇄ متعدد ─────────────────────────

    /** @test */
    public function enabling_variants_is_rejected_while_stock_exists(): void
    {
        $auth = $this->registerTenant();

        $product = $this->withToken($auth['token'])->postJson('/api/products', [
            'name' => 'صنفٌ له رصيد', 'sku' => 'STOCK-1', 'type' => 'good',
            'sale_price' => 10000, 'purchase_price' => 5000,
            'track_inventory' => true, 'initial_quantity' => 5,
        ])->assertCreated()->json('data');

        $this->enableVariants($auth['token'], $product['id'])->assertStatus(422);
    }

    /** @test */
    public function disabling_variant_management_is_blocked_while_any_variant_exists(): void
    {
        $auth = $this->registerTenant();
        $product = $this->createSimpleProduct($auth['token']);
        $this->enableVariants($auth['token'], $product['id']);
        $color = $this->addOption($auth['token'], $product['id'], 'اللون');
        $black = $this->addValue($auth['token'], $product['id'], $color['id'], 'أسود');
        $this->withToken($auth['token'])->postJson("/api/products/{$product['id']}/variants", [
            'combinations' => [[$black['id']]],
        ])->assertStatus(201);

        $this->withToken($auth['token'])->postJson("/api/products/{$product['id']}/variants/disable")
            ->assertStatus(422);
    }

    /** @test */
    public function deleting_a_product_is_blocked_while_it_has_any_variant(): void
    {
        $auth = $this->registerTenant();
        $product = $this->createSimpleProduct($auth['token']);
        $this->enableVariants($auth['token'], $product['id']);
        $color = $this->addOption($auth['token'], $product['id'], 'اللون');
        $black = $this->addValue($auth['token'], $product['id'], $color['id'], 'أسود');
        $this->withToken($auth['token'])->postJson("/api/products/{$product['id']}/variants", [
            'combinations' => [[$black['id']]],
        ])->assertStatus(201);

        $this->withToken($auth['token'])->deleteJson("/api/products/{$product['id']}")
            ->assertStatus(422);
    }

    // ───────────────────────── دورة حياة الخيار/القيمة/المتغيّر ─────────────────────────

    /** @test */
    public function an_option_value_used_by_a_variant_cannot_be_hard_deleted(): void
    {
        $auth = $this->registerTenant();
        $product = $this->createSimpleProduct($auth['token']);
        $this->enableVariants($auth['token'], $product['id']);
        $color = $this->addOption($auth['token'], $product['id'], 'اللون');
        $black = $this->addValue($auth['token'], $product['id'], $color['id'], 'أسود');
        $this->withToken($auth['token'])->postJson("/api/products/{$product['id']}/variants", [
            'combinations' => [[$black['id']]],
        ])->assertStatus(201);

        $this->withToken($auth['token'])
            ->deleteJson("/api/products/{$product['id']}/options/{$color['id']}/values/{$black['id']}")
            ->assertStatus(422);

        // التعطيل يبقى متاحاً — لا حذفاً تدريجياً.
        $this->withToken($auth['token'])
            ->putJson("/api/products/{$product['id']}/options/{$color['id']}/values/{$black['id']}", ['is_active' => false])
            ->assertOk();
    }

    /** @test */
    public function an_option_used_by_a_variant_cannot_be_hard_deleted(): void
    {
        $auth = $this->registerTenant();
        $product = $this->createSimpleProduct($auth['token']);
        $this->enableVariants($auth['token'], $product['id']);
        $color = $this->addOption($auth['token'], $product['id'], 'اللون');
        $black = $this->addValue($auth['token'], $product['id'], $color['id'], 'أسود');
        $this->withToken($auth['token'])->postJson("/api/products/{$product['id']}/variants", [
            'combinations' => [[$black['id']]],
        ])->assertStatus(201);

        $this->withToken($auth['token'])
            ->deleteJson("/api/products/{$product['id']}/options/{$color['id']}")
            ->assertStatus(422);
    }

    /** @test */
    public function deleting_an_unused_variant_releases_its_sku(): void
    {
        $auth = $this->registerTenant();
        $product = $this->createSimpleProduct($auth['token']);
        $this->enableVariants($auth['token'], $product['id']);
        $color = $this->addOption($auth['token'], $product['id'], 'اللون');
        $black = $this->addValue($auth['token'], $product['id'], $color['id'], 'أسود');
        $created = $this->withToken($auth['token'])->postJson("/api/products/{$product['id']}/variants", [
            'combinations' => [[$black['id']]],
        ])->assertStatus(201)->json();

        $variant = $created['created'][0];

        $this->withToken($auth['token'])
            ->deleteJson("/api/products/{$product['id']}/variants/{$variant['id']}")
            ->assertOk();

        $this->assertDatabaseMissing('product_variants', ['id' => $variant['id']]);
        $this->assertDatabaseMissing('sku_registry', ['sku' => $variant['sku']]);
    }

    /** @test */
    public function a_variant_can_be_renamed_but_not_to_an_sku_taken_by_another_variant(): void
    {
        $auth = $this->registerTenant();
        $product = $this->createSimpleProduct($auth['token']);
        $this->enableVariants($auth['token'], $product['id']);
        $color = $this->addOption($auth['token'], $product['id'], 'اللون');
        $black = $this->addValue($auth['token'], $product['id'], $color['id'], 'أسود');
        $white = $this->addValue($auth['token'], $product['id'], $color['id'], 'أبيض');

        $created = $this->withToken($auth['token'])->postJson("/api/products/{$product['id']}/variants", [
            'combinations' => [[$black['id']], [$white['id']]],
        ])->assertStatus(201)->json('created');

        [$v1, $v2] = $created;

        $this->withToken($auth['token'])
            ->putJson("/api/products/{$product['id']}/variants/{$v1['id']}", ['sku' => $v2['sku']])
            ->assertStatus(422);
    }

    // ───────────────────────── عزل المستأجرين (سلبيّاً) ─────────────────────────

    /** @test */
    public function an_option_cannot_be_attached_to_another_tenants_product(): void
    {
        $authA = $this->registerTenant('acme-a', 'a@acme.test');
        $authB = $this->registerTenant('acme-b', 'b@acme.test');

        $productB = $this->createSimpleProduct($authB['token'], 'منتج ب');
        $this->enableVariants($authB['token'], $productB['id']);

        // مستخدم أ يحاول إضافة خيارٍ لمنتج ب عبر رقمه — التوكن يحدّد المستأجر
        // النشط فعلياً بصرف النظر عمّا يُرسَل، فالنطاق العام يُرجع 404.
        $this->withToken($authA['token'])
            ->postJson("/api/products/{$productB['id']}/options", ['name' => 'اللون'])
            ->assertStatus(404);
    }

    /** @test */
    public function a_variant_cannot_select_an_option_value_belonging_to_another_tenant(): void
    {
        $authA = $this->registerTenant('acme-a2', 'a2@acme.test');
        $authB = $this->registerTenant('acme-b2', 'b2@acme.test');

        $productA = $this->createSimpleProduct($authA['token'], 'منتج أ');
        $this->enableVariants($authA['token'], $productA['id']);
        $colorA = $this->addOption($authA['token'], $productA['id'], 'اللون');

        $productB = $this->createSimpleProduct($authB['token'], 'منتج ب');
        $this->enableVariants($authB['token'], $productB['id']);
        $colorB = $this->addOption($authB['token'], $productB['id'], 'اللون');
        $valueB = $this->addValue($authB['token'], $productB['id'], $colorB['id'], 'أسود');

        app(TenantContext::class)->set($authA['tenant_id']);
        $service = app(ProductVariantService::class);
        $productAModel = Product::find($productA['id']);

        $result = $service->createVariants($productAModel, [[$valueB['id']]], null);

        $this->assertCount(0, $result['created']);
        $this->assertCount(1, $result['failed']);
        $this->assertSame(0, ProductVariant::where('product_id', $productA['id'])->count());
    }

    /** @test */
    public function a_variant_cannot_select_a_same_tenant_value_belonging_to_another_product(): void
    {
        $auth = $this->registerTenant();
        app(TenantContext::class)->set($auth['tenant_id']);

        $productOne = $this->createSimpleProduct($auth['token'], 'منتج ١', 'P-ONE');
        $this->enableVariants($auth['token'], $productOne['id']);
        $colorOne = $this->addOption($auth['token'], $productOne['id'], 'اللون');

        $productTwo = $this->createSimpleProduct($auth['token'], 'منتج ٢', 'P-TWO');
        $this->enableVariants($auth['token'], $productTwo['id']);
        $colorTwo = $this->addOption($auth['token'], $productTwo['id'], 'اللون');
        $valueTwo = $this->addValue($auth['token'], $productTwo['id'], $colorTwo['id'], 'أسود');

        $service = app(ProductVariantService::class);
        $productOneModel = Product::find($productOne['id']);

        $result = $service->createVariants($productOneModel, [[$valueTwo['id']]], null);

        $this->assertCount(0, $result['created']);
        $this->assertCount(1, $result['failed']);
    }

    /** @test */
    public function a_variant_lookup_cannot_resolve_another_tenants_variant_by_id(): void
    {
        $authA = $this->registerTenant('acme-a3', 'a3@acme.test');
        $authB = $this->registerTenant('acme-b3', 'b3@acme.test');

        $productB = $this->createSimpleProduct($authB['token'], 'منتج ب');
        $this->enableVariants($authB['token'], $productB['id']);
        $colorB = $this->addOption($authB['token'], $productB['id'], 'اللون');
        $valueB = $this->addValue($authB['token'], $productB['id'], $colorB['id'], 'أسود');
        $createdB = $this->withToken($authB['token'])->postJson("/api/products/{$productB['id']}/variants", [
            'combinations' => [[$valueB['id']]],
        ])->assertStatus(201)->json('created');

        $variantIdB = $createdB[0]['id'];

        $this->withToken($authA['token'])
            ->putJson("/api/products/{$productB['id']}/variants/{$variantIdB}", ['is_active' => false])
            ->assertStatus(404);
    }

    /** @test */
    public function the_same_sku_may_exist_independently_in_different_tenants(): void
    {
        $authA = $this->registerTenant('acme-a4', 'a4@acme.test');
        $authB = $this->registerTenant('acme-b4', 'b4@acme.test');

        $this->createSimpleProduct($authA['token'], 'منتج أ', 'SHARED-SKU')['id'];
        $this->createSimpleProduct($authB['token'], 'منتج ب', 'SHARED-SKU');

        $this->assertSame(2, SkuRegistryEntry::withoutGlobalScopes()->where('sku', 'SHARED-SKU')->count());
    }
}
