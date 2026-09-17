<?php

namespace Tests\Feature;

use App\Models\Product;
use App\Models\ProductMedia;
use App\Models\ProductOptionValue;
use App\Models\Tenant;
use App\Services\ProductMediaService;
use App\Services\ProductVariantService;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

/**
 * VAR-OPTION-VISUAL-1 — صريّة بصرية (swatch) على قيمة خيار المنتج.
 *
 * يغطّي: التوافق الرجعي النصّي البحت، تطبيع/رفض ألوان `#RRGGBB`، ثبات
 * تركيبات النوع الثلاث (none/color/image)، مرجع صورةٍ تابعٍ حصراً لهذه
 * القيمة بالذات (بلا تسرّب عبر مستأجرٍ أو قيمةٍ أخرى)، ثبات هوية المتغيّر
 * عند تعديل الصريّة، وبقاء صلاحيات الخيار/المتغيّر القائمة سارية.
 *
 * تشغيل: php artisan test --filter=ProductOptionValueVisualTest
 */
class ProductOptionValueVisualTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    protected function setUp(): void
    {
        parent::setUp();

        config()->set('document_center.storage.driver', 'local');
        config()->set('document_center.storage.disk', 'local');
        Storage::fake('local');
    }

    private function createSimpleProduct(string $token, string $sku = 'SHIRT-001'): array
    {
        return $this->withToken($token)->postJson('/api/products', [
            'name' => 'قميص كلاسيك', 'sku' => $sku, 'type' => 'good', 'sale_price' => 10000,
        ])->assertCreated()->json('data');
    }

    private function enableVariants(string $token, string $productId): void
    {
        $this->withToken($token)->postJson("/api/products/{$productId}/variants/enable")->assertOk();
    }

    private function addOption(string $token, string $productId, string $name = 'اللون'): array
    {
        return $this->withToken($token)->postJson("/api/products/{$productId}/options", ['name' => $name])
            ->assertCreated()->json('data');
    }

    private function addValue(string $token, string $productId, string $optionId, array $payload): \Illuminate\Testing\TestResponse
    {
        return $this->withToken($token)->postJson("/api/products/{$productId}/options/{$optionId}/values", $payload);
    }

    private function updateValue(string $token, string $productId, string $optionId, string $valueId, array $payload): \Illuminate\Testing\TestResponse
    {
        return $this->withToken($token)->putJson("/api/products/{$productId}/options/{$optionId}/values/{$valueId}", $payload);
    }

    // ───────────────────────── توافقٌ رجعي ─────────────────────────

    /** @test */
    public function existing_text_only_option_values_still_work_without_any_visual_field(): void
    {
        $auth = $this->registerTenant();
        $product = $this->createSimpleProduct($auth['token']);
        $this->enableVariants($auth['token'], $product['id']);
        $option = $this->addOption($auth['token'], $product['id'], 'المقاس');

        $value = $this->addValue($auth['token'], $product['id'], $option['id'], ['value' => 'L'])
            ->assertCreated()
            ->json('data');

        $this->assertSame('none', $value['visual_type']);
        $this->assertNull($value['color_value']);
        $this->assertArrayNotHasKey('image_media', $value);
    }

    /** @test */
    public function a_new_value_created_with_no_visual_fields_resolves_to_none_by_default(): void
    {
        $auth = $this->registerTenant();
        $product = $this->createSimpleProduct($auth['token']);
        $this->enableVariants($auth['token'], $product['id']);
        $option = $this->addOption($auth['token'], $product['id']);

        $raw = ProductOptionValue::create([
            'tenant_id' => $auth['tenant_id'], 'product_option_id' => $option['id'],
            'value' => 'أحمر', 'value_key' => 'أحمر',
        ]);

        $this->assertSame('none', $raw->visual_type);
        $this->assertNull($raw->color_value);
        $this->assertNull($raw->image_media_id);
    }

    // ───────────────────────── لون: إنشاء/تحديث/تطبيع ─────────────────────────

    /** @test */
    public function a_valid_color_can_be_created(): void
    {
        $auth = $this->registerTenant();
        $product = $this->createSimpleProduct($auth['token']);
        $this->enableVariants($auth['token'], $product['id']);
        $option = $this->addOption($auth['token'], $product['id']);

        $value = $this->addValue($auth['token'], $product['id'], $option['id'], [
            'value' => 'أزرق سماوي', 'visual_type' => 'color', 'color_value' => '#AFC9F5',
        ])->assertCreated()->json('data');

        $this->assertSame('color', $value['visual_type']);
        $this->assertSame('#AFC9F5', $value['color_value']);
    }

    /** @test */
    public function a_valid_color_can_be_updated(): void
    {
        $auth = $this->registerTenant();
        $product = $this->createSimpleProduct($auth['token']);
        $this->enableVariants($auth['token'], $product['id']);
        $option = $this->addOption($auth['token'], $product['id']);
        $value = $this->addValue($auth['token'], $product['id'], $option['id'], [
            'value' => 'أزرق سماوي', 'visual_type' => 'color', 'color_value' => '#AFC9F5',
        ])->assertCreated()->json('data');

        $updated = $this->updateValue($auth['token'], $product['id'], $option['id'], $value['id'], [
            'color_value' => '#B7D3FA',
        ])->assertOk()->json('data');

        $this->assertSame('color', $updated['visual_type']);
        $this->assertSame('#B7D3FA', $updated['color_value']);
    }

    /** @test */
    public function lowercase_hex_input_is_normalized_to_uppercase(): void
    {
        $auth = $this->registerTenant();
        $product = $this->createSimpleProduct($auth['token']);
        $this->enableVariants($auth['token'], $product['id']);
        $option = $this->addOption($auth['token'], $product['id']);

        $value = $this->addValue($auth['token'], $product['id'], $option['id'], [
            'value' => 'أبيض', 'visual_type' => 'color', 'color_value' => '#ffffff',
        ])->assertCreated()->json('data');

        $this->assertSame('#FFFFFF', $value['color_value']);
    }

    /** @test */
    public function an_invalid_hex_format_is_rejected(): void
    {
        $auth = $this->registerTenant();
        $product = $this->createSimpleProduct($auth['token']);
        $this->enableVariants($auth['token'], $product['id']);
        $option = $this->addOption($auth['token'], $product['id']);

        $this->addValue($auth['token'], $product['id'], $option['id'], [
            'value' => 'أحمر', 'visual_type' => 'color', 'color_value' => '#ABC',
        ])->assertStatus(422);

        $this->addValue($auth['token'], $product['id'], $option['id'], [
            'value' => 'أحمر٢', 'visual_type' => 'color', 'color_value' => 'AFC9F5',
        ])->assertStatus(422);
    }

    /** @test */
    public function a_css_named_color_is_rejected(): void
    {
        $auth = $this->registerTenant();
        $product = $this->createSimpleProduct($auth['token']);
        $this->enableVariants($auth['token'], $product['id']);
        $option = $this->addOption($auth['token'], $product['id']);

        $this->addValue($auth['token'], $product['id'], $option['id'], [
            'value' => 'أحمر', 'visual_type' => 'color', 'color_value' => 'red',
        ])->assertStatus(422);
    }

    /** @test */
    public function an_rgb_css_expression_is_rejected(): void
    {
        $auth = $this->registerTenant();
        $product = $this->createSimpleProduct($auth['token']);
        $this->enableVariants($auth['token'], $product['id']);
        $option = $this->addOption($auth['token'], $product['id']);

        $this->addValue($auth['token'], $product['id'], $option['id'], [
            'value' => 'أحمر', 'visual_type' => 'color', 'color_value' => 'rgb(255,0,0)',
        ])->assertStatus(422);
    }

    /** @test */
    public function color_visual_type_requires_a_color_value(): void
    {
        $auth = $this->registerTenant();
        $product = $this->createSimpleProduct($auth['token']);
        $this->enableVariants($auth['token'], $product['id']);
        $option = $this->addOption($auth['token'], $product['id']);

        $this->addValue($auth['token'], $product['id'], $option['id'], [
            'value' => 'أحمر', 'visual_type' => 'color',
        ])->assertStatus(422);
    }

    // ───────────────────────── none/image لا يحتفظان بلون ─────────────────────────

    /** @test */
    public function none_visual_type_rejects_an_explicit_color_value(): void
    {
        $auth = $this->registerTenant();
        $product = $this->createSimpleProduct($auth['token']);
        $this->enableVariants($auth['token'], $product['id']);
        $option = $this->addOption($auth['token'], $product['id']);

        $this->addValue($auth['token'], $product['id'], $option['id'], [
            'value' => 'أحمر', 'visual_type' => 'none', 'color_value' => '#FF0000',
        ])->assertStatus(422);
    }

    /** @test */
    public function switching_from_color_to_none_clears_the_stored_color(): void
    {
        $auth = $this->registerTenant();
        $product = $this->createSimpleProduct($auth['token']);
        $this->enableVariants($auth['token'], $product['id']);
        $option = $this->addOption($auth['token'], $product['id']);
        $value = $this->addValue($auth['token'], $product['id'], $option['id'], [
            'value' => 'أحمر', 'visual_type' => 'color', 'color_value' => '#FF0000',
        ])->assertCreated()->json('data');

        $updated = $this->updateValue($auth['token'], $product['id'], $option['id'], $value['id'], [
            'visual_type' => 'none',
        ])->assertOk()->json('data');

        $this->assertSame('none', $updated['visual_type']);
        $this->assertNull($updated['color_value']);
    }

    /** @test */
    public function image_visual_type_rejects_an_explicit_color_value(): void
    {
        $auth = $this->registerTenant();
        $product = $this->createSimpleProduct($auth['token']);
        $this->enableVariants($auth['token'], $product['id']);
        $option = $this->addOption($auth['token'], $product['id']);

        $this->addValue($auth['token'], $product['id'], $option['id'], [
            'value' => 'خشبي', 'visual_type' => 'image', 'color_value' => '#FF0000',
        ])->assertStatus(422);
    }

    /** @test */
    public function unknown_visual_types_are_rejected(): void
    {
        $auth = $this->registerTenant();
        $product = $this->createSimpleProduct($auth['token']);
        $this->enableVariants($auth['token'], $product['id']);
        $option = $this->addOption($auth['token'], $product['id']);

        $this->addValue($auth['token'], $product['id'], $option['id'], [
            'value' => 'متدرّج', 'visual_type' => 'gradient',
        ])->assertStatus(422);
    }

    // ───────────────────────── round-trip عبر الـ API ─────────────────────────

    /** @test */
    public function visual_metadata_round_trips_through_the_options_read_endpoint(): void
    {
        $auth = $this->registerTenant();
        $product = $this->createSimpleProduct($auth['token']);
        $this->enableVariants($auth['token'], $product['id']);
        $option = $this->addOption($auth['token'], $product['id']);
        $this->addValue($auth['token'], $product['id'], $option['id'], [
            'value' => 'أزرق سماوي', 'visual_type' => 'color', 'color_value' => '#AFC9F5',
        ])->assertCreated();

        $options = $this->withToken($auth['token'])->getJson("/api/products/{$product['id']}/options")
            ->assertOk()->json('data');

        $value = collect($options[0]['values'])->firstWhere('value', 'أزرق سماوي');
        $this->assertSame('color', $value['visual_type']);
        $this->assertSame('#AFC9F5', $value['color_value']);
    }

    // ───────────────────────── صورة: مرجع تابع لهذه القيمة بالذات ─────────────────────────

    /** @test */
    public function an_image_visual_type_requires_media_already_scoped_to_this_exact_value(): void
    {
        $auth = $this->registerTenant();
        $product = $this->createSimpleProduct($auth['token']);
        $this->enableVariants($auth['token'], $product['id']);
        $option = $this->addOption($auth['token'], $product['id']);
        $value = $this->addValue($auth['token'], $product['id'], $option['id'], ['value' => 'خشبي'])
            ->assertCreated()->json('data');

        // لا وسيط مرفوعٌ بعد لهذه القيمة — مرجعٌ عشوائي يُرفض.
        $this->updateValue($auth['token'], $product['id'], $option['id'], $value['id'], [
            'visual_type' => 'image', 'image_media_id' => (string) \Illuminate\Support\Str::uuid(),
        ])->assertStatus(422);
    }

    /** @test */
    public function an_image_visual_type_succeeds_once_media_is_scoped_to_the_value_and_round_trips(): void
    {
        $auth = $this->registerTenant();
        app(TenantContext::class)->set($auth['tenant_id']);
        $product = $this->createSimpleProduct($auth['token']);
        $this->enableVariants($auth['token'], $product['id']);
        $option = $this->addOption($auth['token'], $product['id']);
        $value = $this->addValue($auth['token'], $product['id'], $option['id'], ['value' => 'خشبي'])
            ->assertCreated()->json('data');

        $rawValue = ProductOptionValue::findOrFail($value['id']);
        $rawProduct = Product::findOrFail($product['id']);
        $media = app(ProductMediaService::class)->attachToOptionValue(
            $rawProduct, $rawValue, [UploadedFile::fake()->image('wood.jpg')], null
        )[0];

        $updated = $this->updateValue($auth['token'], $product['id'], $option['id'], $value['id'], [
            'visual_type' => 'image', 'image_media_id' => $media->id,
        ])->assertOk()->json('data');

        $this->assertSame('image', $updated['visual_type']);
        $this->assertNull($updated['color_value']);
        $this->assertSame($media->id, $updated['image_media']['id']);
    }

    /** @test */
    public function an_image_reference_belonging_to_a_sibling_value_is_rejected(): void
    {
        $auth = $this->registerTenant();
        app(TenantContext::class)->set($auth['tenant_id']);
        $product = $this->createSimpleProduct($auth['token']);
        $this->enableVariants($auth['token'], $product['id']);
        $option = $this->addOption($auth['token'], $product['id']);
        $valueA = $this->addValue($auth['token'], $product['id'], $option['id'], ['value' => 'خشبي'])
            ->assertCreated()->json('data');
        $valueB = $this->addValue($auth['token'], $product['id'], $option['id'], ['value' => 'رخامي'])
            ->assertCreated()->json('data');

        $rawValueA = ProductOptionValue::findOrFail($valueA['id']);
        $rawProduct = Product::findOrFail($product['id']);
        $mediaForA = app(ProductMediaService::class)->attachToOptionValue(
            $rawProduct, $rawValueA, [UploadedFile::fake()->image('wood.jpg')], null
        )[0];

        // مرجع وسيطٍ يخصّ قيمةً شقيقة (خشبي) لا يُقبل لقيمةٍ أخرى (رخامي).
        $this->updateValue($auth['token'], $product['id'], $option['id'], $valueB['id'], [
            'visual_type' => 'image', 'image_media_id' => $mediaForA->id,
        ])->assertStatus(422);
    }

    /** @test */
    public function a_cross_tenant_image_media_reference_is_denied_without_leaking_existence(): void
    {
        $ownerAuth = $this->registerTenant('media-owner', 'owner@media-owner.test');
        app(TenantContext::class)->set($ownerAuth['tenant_id']);
        $ownerProduct = $this->createSimpleProduct($ownerAuth['token'], 'OWNER-SKU-1');
        $this->enableVariants($ownerAuth['token'], $ownerProduct['id']);
        $ownerOption = $this->addOption($ownerAuth['token'], $ownerProduct['id']);
        $ownerValue = $this->addValue($ownerAuth['token'], $ownerProduct['id'], $ownerOption['id'], ['value' => 'خشبي'])
            ->assertCreated()->json('data');

        $rawOwnerValue = ProductOptionValue::findOrFail($ownerValue['id']);
        $rawOwnerProduct = Product::findOrFail($ownerProduct['id']);
        $foreignMedia = app(ProductMediaService::class)->attachToOptionValue(
            $rawOwnerProduct, $rawOwnerValue, [UploadedFile::fake()->image('wood.jpg')], null
        )[0];

        $attackerAuth = $this->registerTenant('media-attacker', 'owner@media-attacker.test');
        $attackerProduct = $this->createSimpleProduct($attackerAuth['token'], 'ATTACKER-SKU-1');
        $this->enableVariants($attackerAuth['token'], $attackerProduct['id']);
        $attackerOption = $this->addOption($attackerAuth['token'], $attackerProduct['id']);
        $attackerValue = $this->addValue($attackerAuth['token'], $attackerProduct['id'], $attackerOption['id'], ['value' => 'خشبي'])
            ->assertCreated()->json('data');

        $response = $this->updateValue($attackerAuth['token'], $attackerProduct['id'], $attackerOption['id'], $attackerValue['id'], [
            'visual_type' => 'image', 'image_media_id' => $foreignMedia->id,
        ])->assertStatus(422);

        // نفس الرسالة العامة المستعملة لمرجعٍ غير موجود أصلاً — لا كشف لوجود صفٍّ من مستأجرٍ آخر.
        $this->assertStringNotContainsString($ownerAuth['tenant_id'], (string) $response->json('message'));
    }

    // ───────────────────────── ثبات هوية المتغيّر ─────────────────────────

    /** @test */
    public function editing_a_swatch_color_does_not_recreate_the_variant_or_change_its_sku(): void
    {
        $auth = $this->registerTenant();
        $product = $this->createSimpleProduct($auth['token']);
        $this->enableVariants($auth['token'], $product['id']);
        $colorOption = $this->addOption($auth['token'], $product['id'], 'اللون');
        $colorValue = $this->addValue($auth['token'], $product['id'], $colorOption['id'], [
            'value' => 'أزرق سماوي', 'visual_type' => 'color', 'color_value' => '#AFC9F5',
        ])->assertCreated()->json('data');
        $sizeOption = $this->addOption($auth['token'], $product['id'], 'المقاس');
        $sizeValue = $this->addValue($auth['token'], $product['id'], $sizeOption['id'], ['value' => 'L'])
            ->assertCreated()->json('data');

        $created = $this->withToken($auth['token'])->postJson("/api/products/{$product['id']}/variants", [
            'combinations' => [[$colorValue['id'], $sizeValue['id']]],
        ])->assertCreated()->json();
        $variant = $created['created'][0];
        $variantId = $variant['id'];
        $variantSku = $variant['sku'];
        $combinationKey = $variant['combination_key'];

        $this->updateValue($auth['token'], $product['id'], $colorOption['id'], $colorValue['id'], [
            'color_value' => '#B7D3FA',
        ])->assertOk();

        $variants = $this->withToken($auth['token'])->getJson("/api/products/{$product['id']}/variants")
            ->assertOk()->json('data');

        $this->assertCount(1, $variants);
        $this->assertSame($variantId, $variants[0]['id'], 'تعديل اللون يجب ألّا يُعيد إنشاء المتغيّر.');
        $this->assertSame($variantSku, $variants[0]['sku'], 'تعديل اللون يجب ألّا يُغيّر SKU المتغيّر.');
        $this->assertSame($combinationKey, $variants[0]['combination_key'], 'تركيبة الهوية لا تتغيّر.');

        $colorInVariant = collect($variants[0]['option_values'])->firstWhere('value_id', $colorValue['id']);
        $this->assertSame('#B7D3FA', $colorInVariant['color_value'], 'المتغيّر يعرض اللون الجديد قراءةً، لا نسخةً قديمة.');
    }

    /** @test */
    public function variant_combination_matrix_is_unchanged_by_a_swatch_color_edit(): void
    {
        $auth = $this->registerTenant();
        $product = $this->createSimpleProduct($auth['token']);
        $this->enableVariants($auth['token'], $product['id']);
        $colorOption = $this->addOption($auth['token'], $product['id'], 'اللون');
        $colorValue = $this->addValue($auth['token'], $product['id'], $colorOption['id'], [
            'value' => 'أزرق سماوي', 'visual_type' => 'color', 'color_value' => '#AFC9F5',
        ])->assertCreated()->json('data');
        $sizeOption = $this->addOption($auth['token'], $product['id'], 'المقاس');
        $sizeValue = $this->addValue($auth['token'], $product['id'], $sizeOption['id'], ['value' => 'L'])
            ->assertCreated()->json('data');

        $before = $this->withToken($auth['token'])->getJson("/api/products/{$product['id']}/variants/combinations")
            ->assertOk()->json();

        $this->updateValue($auth['token'], $product['id'], $colorOption['id'], $colorValue['id'], [
            'color_value' => '#000000',
        ])->assertOk();

        $after = $this->withToken($auth['token'])->getJson("/api/products/{$product['id']}/variants/combinations")
            ->assertOk()->json();

        $this->assertSame(
            collect($before['combinations'])->pluck('combination_key')->all(),
            collect($after['combinations'])->pluck('combination_key')->all(),
            'تركيبات المتغيّرات المقترَحة لا تتأثر بتعديل صريّة اللون.'
        );
    }

    // ───────────────────────── الصلاحيات القائمة ─────────────────────────

    /** @test */
    public function existing_option_value_permissions_still_apply_to_visual_metadata_writes(): void
    {
        $auth = $this->registerTenant();
        $product = $this->createSimpleProduct($auth['token']);
        $this->enableVariants($auth['token'], $product['id']);
        $option = $this->addOption($auth['token'], $product['id']);
        $value = $this->addValue($auth['token'], $product['id'], $option['id'], ['value' => 'أحمر'])
            ->assertCreated()->json('data');

        $staff = $this->tokenForRole($auth['tenant_id'], 'staff', 'staff@acme.test');

        $this->withToken($staff)->postJson("/api/products/{$product['id']}/options/{$option['id']}/values", [
            'value' => 'أزرق', 'visual_type' => 'color', 'color_value' => '#0000FF',
        ])->assertForbidden();

        $this->withToken($staff)->putJson("/api/products/{$product['id']}/options/{$option['id']}/values/{$value['id']}", [
            'visual_type' => 'color', 'color_value' => '#0000FF',
        ])->assertForbidden();
    }
}
