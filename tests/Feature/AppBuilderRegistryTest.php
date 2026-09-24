<?php

namespace Tests\Feature;

use App\Services\AppBuilder\RuntimeCapabilities;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * APP-BUILDER-5 — نقطة `GET /app-builder/registries` (تسلسل ComponentRegistry/ActionRegistry
 * لمستهلكها الحقيقي الأول: Inspector مساحة عمل الـ Builder). نفس بوابتَي الصلاحية/القدرة
 * اللتين تحرسان بقية مسارات app-builder — لا حاجة لتكرار اختبارات عزل المستأجر إذ البيانات
 * منصّة ثابتة لا مستأجَرة.
 *
 * تشغيل: php artisan test --filter=AppBuilderRegistryTest
 */
class AppBuilderRegistryTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    /** @test */
    public function it_returns_every_component_and_action_the_runtime_supports(): void
    {
        $auth = $this->registerTenant('appb-registries', 'owner@appb-registries.test');

        $response = $this->withToken($auth['token'])->getJson('/api/app-builder/registries')->assertOk();

        $this->assertSame(
            array_keys(RuntimeCapabilities::COMPONENTS),
            array_keys($response->json('data.components'))
        );
        $this->assertSame(
            array_keys(RuntimeCapabilities::ACTIONS),
            array_keys($response->json('data.actions'))
        );
    }

    /** @test */
    public function a_component_definition_exposes_its_typed_props_and_children_rule(): void
    {
        $auth = $this->registerTenant('appb-registries-shape', 'owner@appb-registries-shape.test');

        $response = $this->withToken($auth['token'])->getJson('/api/app-builder/registries')->assertOk();

        $response->assertJsonPath('data.components.ProductCard.type', 'ProductCard');
        $response->assertJsonPath('data.components.ProductCard.children_rule.kind', 'none');
        $response->assertJsonPath('data.components.ProductCard.actionable', true);
        $amountProp = collect($response->json('data.components.ProductCard.props'))
            ->firstWhere('key', 'amountMinor');
        $this->assertNotNull($amountProp);
        $this->assertSame('amountMinor', $amountProp['type']);
        $this->assertTrue($amountProp['required']);
    }

    /** @test */
    public function an_action_definition_exposes_its_typed_params_and_dispatch_status(): void
    {
        $auth = $this->registerTenant('appb-registries-action', 'owner@appb-registries-action.test');

        $response = $this->withToken($auth['token'])->getJson('/api/app-builder/registries')->assertOk();

        $response->assertJsonPath('data.actions.addToCart.type', 'addToCart');
        $response->assertJsonPath('data.actions.addToCart.dispatch_status', 'provenNoop');
        $quantityParam = collect($response->json('data.actions.addToCart.params'))
            ->firstWhere('key', 'quantity');
        $this->assertNotNull($quantityParam);
        $this->assertFalse($quantityParam['required']);
        $this->assertSame(1, $quantityParam['min_value']);
    }

    /** @test */
    public function a_component_and_its_props_expose_bilingual_labels_without_changing_internal_keys(): void
    {
        $auth = $this->registerTenant('appb-registries-labels', 'owner@appb-registries-labels.test');

        $response = $this->withToken($auth['token'])->getJson('/api/app-builder/registries')->assertOk();

        // المعرّف الداخلي يبقى كما هو (`type`) — التسمية إضافية لا بديلة.
        $response->assertJsonPath('data.components.ProductList.type', 'ProductList');
        $response->assertJsonPath('data.components.ProductList.label.ar', 'قائمة المنتجات');
        $response->assertJsonPath('data.components.ProductList.label.en', 'Product List');

        $amountProp = collect($response->json('data.components.ProductCard.props'))
            ->firstWhere('key', 'amountMinor');
        $this->assertNotNull($amountProp);
        $this->assertSame('amountMinor', $amountProp['key']);
        $this->assertSame('السعر', $amountProp['label']['ar']);
        $this->assertSame('Price', $amountProp['label']['en']);
    }

    /** @test */
    public function an_action_and_its_params_expose_bilingual_labels_without_changing_internal_keys(): void
    {
        $auth = $this->registerTenant('appb-registries-action-labels', 'owner@appb-registries-action-labels.test');

        $response = $this->withToken($auth['token'])->getJson('/api/app-builder/registries')->assertOk();

        $response->assertJsonPath('data.actions.addToCart.type', 'addToCart');
        $response->assertJsonPath('data.actions.addToCart.label.ar', 'إضافة إلى السلة');
        $response->assertJsonPath('data.actions.addToCart.label.en', 'Add to Cart');

        $quantityParam = collect($response->json('data.actions.addToCart.params'))
            ->firstWhere('key', 'quantity');
        $this->assertNotNull($quantityParam);
        $this->assertSame('quantity', $quantityParam['key']);
        $this->assertSame('الكمية', $quantityParam['label']['ar']);
        $this->assertSame('Quantity', $quantityParam['label']['en']);
    }

    /** @test */
    public function staff_role_without_the_permission_is_denied(): void
    {
        $auth = $this->registerTenant('appb-registries-rbac', 'owner@appb-registries-rbac.test');
        $staffToken = $this->tokenForRole($auth['tenant_id'], 'staff', 'staff@appb-registries-rbac.test');

        $this->withToken($staffToken)->getJson('/api/app-builder/registries')->assertForbidden();
    }
}
