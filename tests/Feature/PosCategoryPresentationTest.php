<?php

namespace Tests\Feature;

use Tests\TestCase;
use Illuminate\Foundation\Testing\RefreshDatabase;

/**
 * PR-2C: يثبت عقد لون التصنيف ووضع عرض التصنيفات في POS
 * (`category_presentation_mode`: default|image|color) — التوافق الرجعي،
 * التحقق الآمن من اللون، عزل المستأجر، وظهور اللون في كتالوج POS نفسه.
 */
class PosCategoryPresentationTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    private function category(string $token, array $overrides = []): array
    {
        return $this->withToken($token)->postJson('/api/product-categories', array_merge([
            'name' => 'مشروبات',
        ], $overrides))->assertCreated()['data'];
    }

    /** @test */
    public function a_category_accepts_a_valid_hex_color_and_persists_it(): void
    {
        $auth = $this->registerTenant('cat-a', 'owner@cat-a.test');
        $category = $this->category($auth['token'], ['color' => '#2563EB']);

        $this->assertSame('#2563EB', $category['color']);

        $this->withToken($auth['token'])
            ->putJson("/api/product-categories/{$category['id']}", ['name' => 'مشروبات', 'color' => '#10B981'])
            ->assertOk()
            ->assertJsonPath('data.color', '#10B981');
    }

    /** @test */
    public function a_category_color_is_nullable_and_defaults_to_null(): void
    {
        $auth = $this->registerTenant('cat-b', 'owner@cat-b.test');
        $category = $this->category($auth['token']);

        $this->assertNull($category['color']);
    }

    /** @test */
    public function unsafe_or_malformed_color_values_are_rejected(): void
    {
        $auth = $this->registerTenant('cat-c', 'owner@cat-c.test');

        foreach ([
            'red',
            '#FFF',
            '#GGGGGG',
            'url(javascript:alert(1))',
            'var(--primary)',
            '<script>alert(1)</script>',
            'rgb(0,0,0)',
        ] as $unsafe) {
            $this->withToken($auth['token'])
                ->postJson('/api/product-categories', ['name' => 'تصنيف-' . uniqid(), 'color' => $unsafe])
                ->assertStatus(422);
        }
    }

    /** @test */
    public function pos_settings_accept_the_three_presentation_modes_and_reject_others(): void
    {
        $auth = $this->registerTenant('cat-d', 'owner@cat-d.test');

        foreach (['default', 'image', 'color'] as $mode) {
            $this->withToken($auth['token'])
                ->putJson('/api/sales-config/pos', ['data' => ['category_presentation_mode' => $mode]])
                ->assertOk()
                ->assertJsonPath('data.category_presentation_mode', $mode);
        }

        $this->withToken($auth['token'])
            ->putJson('/api/sales-config/pos', ['data' => ['category_presentation_mode' => 'rainbow']])
            ->assertStatus(422);
    }

    /** @test */
    public function a_tenant_that_never_saved_the_setting_falls_back_to_image_not_default(): void
    {
        $auth = $this->registerTenant('cat-e', 'owner@cat-e.test');

        // لم يُحفظ الإعداد إطلاقاً — التوافق الرجعي: نفس السلوك المرئي القائم
        // منذ PR-2 (صورة التصنيف)، لا القيمة الاسمية «افتراضي».
        $this->withToken($auth['token'])->getJson('/api/sales-config/pos')
            ->assertOk()
            ->assertJsonPath('data.category_presentation_mode', 'image');
    }

    /** @test */
    public function the_presentation_mode_setting_is_tenant_scoped_and_does_not_bleed_across_tenants(): void
    {
        $tenantA = $this->registerTenant('cat-tenant-a', 'owner@cat-tenant-a.test');
        $tenantB = $this->registerTenant('cat-tenant-b', 'owner@cat-tenant-b.test');

        $this->withToken($tenantA['token'])
            ->putJson('/api/sales-config/pos', ['data' => ['category_presentation_mode' => 'color']])
            ->assertOk();

        $this->withToken($tenantA['token'])->getJson('/api/sales-config/pos')
            ->assertJsonPath('data.category_presentation_mode', 'color');
        $this->withToken($tenantB['token'])->getJson('/api/sales-config/pos')
            ->assertJsonPath('data.category_presentation_mode', 'image');
    }

    /** @test */
    public function a_categorys_color_from_one_tenant_is_never_visible_through_another_tenants_categories(): void
    {
        $tenantA = $this->registerTenant('cat-color-a', 'owner@cat-color-a.test');
        $tenantB = $this->registerTenant('cat-color-b', 'owner@cat-color-b.test');

        $this->category($tenantA['token'], ['color' => '#FF0000']);

        $listB = $this->withToken($tenantB['token'])->getJson('/api/product-categories')->assertOk()['data'];
        $this->assertCount(0, $listB);
    }

    /** @test */
    public function the_pos_catalog_returns_the_categorys_color_alongside_its_existing_image(): void
    {
        $auth = $this->registerTenant('cat-f', 'owner@cat-f.test');
        $category = $this->category($auth['token'], ['color' => '#2563EB']);

        $product = $this->withToken($auth['token'])->postJson('/api/products', [
            'name' => 'قهوة', 'sku' => 'CAT-COLOR-001', 'type' => 'good', 'sale_price' => 1000,
            'category_id' => $category['id'],
        ])->assertCreated()['data'];

        $catalog = $this->withToken($auth['token'])->getJson('/api/pos/products')->assertOk()['data'];
        $entry = collect($catalog)->firstWhere('id', $product['id']);

        $this->assertSame('#2563EB', $entry['category_color']);
    }

    /** @test */
    public function existing_categories_without_a_color_remain_valid_and_keep_their_image_behavior(): void
    {
        $auth = $this->registerTenant('cat-g', 'owner@cat-g.test');
        $category = $this->category($auth['token']);

        $this->withToken($auth['token'])->getJson('/api/product-categories')
            ->assertOk()
            ->assertJsonPath('data.0.color', null)
            ->assertJsonPath('data.0.image', null);
        $this->assertNotNull($category['id']);
    }
}
