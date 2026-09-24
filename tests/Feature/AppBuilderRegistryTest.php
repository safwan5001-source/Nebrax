<?php

namespace Tests\Feature;

use App\Services\AppBuilder\DataResourceRegistry;
use App\Services\AppBuilder\RuntimeCapabilities;
use App\Services\AppBuilder\VisibilityOperator;
use App\Services\AppBuilder\VisibilitySignal;
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
    public function it_exposes_every_bindable_resource_the_data_resource_registry_defines(): void
    {
        $auth = $this->registerTenant('appb-registries-resources', 'owner@appb-registries-resources.test');

        $response = $this->withToken($auth['token'])->getJson('/api/app-builder/registries')->assertOk();

        $resources = $response->json('data.resources');
        $this->assertSame(array_keys(DataResourceRegistry::RESOURCES), array_keys($resources));
        $this->assertSame('list', $resources['commerce.products']['shape']);
        $this->assertTrue($resources['commerce.products']['paginated']);
        $nameField = collect($resources['commerce.products']['fields'])->firstWhere('key', 'name');
        $this->assertNotNull($nameField);
        $this->assertTrue($nameField['localized']);
        $categoryIdParam = collect($resources['commerce.products']['query_params'])->firstWhere('key', 'category_id');
        $this->assertNotNull($categoryIdParam);
        $this->assertSame('filter', $categoryIdParam['kind']);
    }

    /** @test */
    public function a_component_definition_exposes_the_resources_it_may_bind_to(): void
    {
        $auth = $this->registerTenant('appb-registries-bindable', 'owner@appb-registries-bindable.test');

        $response = $this->withToken($auth['token'])->getJson('/api/app-builder/registries')->assertOk();

        $response->assertJsonPath('data.components.ProductList.bindable_resources', ['commerce.products']);
        $response->assertJsonPath('data.components.CartSummary.bindable_resources', ['commerce.cart']);
        $response->assertJsonPath('data.components.Text.bindable_resources', []);
    }

    /** @test */
    public function it_exposes_the_closed_visibility_signal_and_operator_vocabularies(): void
    {
        $auth = $this->registerTenant('appb-registries-visibility', 'owner@appb-registries-visibility.test');

        $response = $this->withToken($auth['token'])->getJson('/api/app-builder/registries')->assertOk();

        $this->assertSame(VisibilitySignal::ALL, $response->json('data.visibility_signals'));
        $operators = collect($response->json('data.visibility_operators'));
        $this->assertSame(VisibilityOperator::ALL, $operators->pluck('type')->all());
        $this->assertSame('none', $operators->firstWhere('type', 'isTrue')['value_arity']);
        $this->assertSame('list', $operators->firstWhere('type', 'in')['value_arity']);
        $this->assertSame('single', $operators->firstWhere('type', 'equals')['value_arity']);
    }

    /** @test */
    public function staff_role_without_the_permission_is_denied(): void
    {
        $auth = $this->registerTenant('appb-registries-rbac', 'owner@appb-registries-rbac.test');
        $staffToken = $this->tokenForRole($auth['tenant_id'], 'staff', 'staff@appb-registries-rbac.test');

        $this->withToken($staffToken)->getJson('/api/app-builder/registries')->assertForbidden();
    }
}
