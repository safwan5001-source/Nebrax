<?php

namespace Tests\Feature;

use App\Models\SalesChannel;
use App\Models\Storefront;
use App\Models\StorefrontDomain;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class MultiStoreCreationApiTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    private const PATH = '/api/commerce/workspace/storefronts/create';

    /** @test */
    public function an_authorized_owner_can_create_additional_stores_through_the_explicit_api(): void
    {
        config(['storefront.managed_base_domain' => 'store.awjdev.xyz']);
        $auth = $this->registerTenant('api-multi', 'owner@api-multi.test');

        $first = $this->withToken($auth['token'])
            ->postJson(self::PATH, ['name' => 'Gifts', 'default_locale' => 'en'])
            ->assertCreated()
            ->assertJsonStructure(['data' => ['store' => ['id', 'name', 'sales_channel_id', 'is_active', 'preview_url', 'default_locale']], 'meta' => ['created']]);
        $second = $this->withToken($auth['token'])
            ->postJson(self::PATH, ['name' => 'Gifts'])
            ->assertCreated();

        $this->assertSame('Gifts', $first->json('data.store.name'));
        $this->assertSame('en', $first->json('data.store.default_locale'));
        $this->assertSame('https://gifts.api-multi.store.awjdev.xyz/', $first->json('data.store.preview_url'));
        $this->assertSame('https://gifts-2.api-multi.store.awjdev.xyz/', $second->json('data.store.preview_url'));
        $this->assertNotSame($first->json('data.store.id'), $second->json('data.store.id'));

        $this->assertSame(2, Storefront::withoutGlobalScopes()->where('tenant_id', $auth['tenant_id'])->count());
        $this->assertSame(2, SalesChannel::withoutGlobalScopes()->where('tenant_id', $auth['tenant_id'])->where('type', SalesChannel::TYPE_WEB)->count());
        $this->assertSame(2, StorefrontDomain::withoutGlobalScopes()->where('tenant_id', $auth['tenant_id'])->count());
    }

    /** @test */
    public function the_api_derives_tenant_identity_and_ignores_client_hostname_or_tenant_fields(): void
    {
        config(['storefront.managed_base_domain' => 'store.awjdev.xyz']);
        $a = $this->registerTenant('api-a', 'owner@api-a.test');
        $b = $this->registerTenant('api-b', 'owner@api-b.test');

        $response = $this->withToken($a['token'])->postJson(self::PATH, [
            'name' => 'Local',
            'tenant_id' => $b['tenant_id'],
            'hostname' => 'attacker.example.com',
        ])->assertCreated();

        $storeId = $response->json('data.store.id');
        $this->assertSame('https://local.api-a.store.awjdev.xyz/', $response->json('data.store.preview_url'));
        $this->assertSame($a['tenant_id'], Storefront::withoutGlobalScopes()->findOrFail($storeId)->tenant_id);
        $this->assertStringNotContainsString('attacker.example.com', $response->getContent());
    }

    /** @test */
    public function invalid_payload_is_rejected_without_creating_a_partial_graph(): void
    {
        $auth = $this->registerTenant('api-invalid', 'owner@api-invalid.test');

        $this->withToken($auth['token'])->postJson(self::PATH, ['name' => '   '])->assertUnprocessable();
        $this->withToken($auth['token'])->postJson(self::PATH, ['name' => 'Valid', 'default_locale' => 'fr'])->assertUnprocessable();

        $this->assertSame(0, Storefront::withoutGlobalScopes()->where('tenant_id', $auth['tenant_id'])->count());
        $this->assertSame(0, SalesChannel::withoutGlobalScopes()->where('tenant_id', $auth['tenant_id'])->where('type', SalesChannel::TYPE_WEB)->count());
    }

    /** @test */
    public function only_commerce_manage_users_can_create_and_guests_are_rejected(): void
    {
        $auth = $this->registerTenant('api-rbac', 'owner@api-rbac.test');
        $staff = $this->tokenForRole($auth['tenant_id'], 'staff', 'staff@api-rbac.test');
        $selfService = $this->tokenForRole($auth['tenant_id'], 'self_service', 'self@api-rbac.test');

        $this->withToken($staff)->postJson(self::PATH, ['name' => 'Staff'])->assertForbidden();
        $this->withToken($selfService)->postJson(self::PATH, ['name' => 'Self'])->assertForbidden();
        $this->postJson(self::PATH, ['name' => 'Guest'])->assertUnauthorized();
    }
}
