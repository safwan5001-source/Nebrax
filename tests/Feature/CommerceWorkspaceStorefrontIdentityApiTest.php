<?php

namespace Tests\Feature;

use App\Models\SalesChannel;
use App\Models\Storefront;
use App\Models\StorefrontDomain;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * STORE-ADMIN-ADOPT-1B-1 — `PUT /api/commerce/workspace/storefronts/{id}`:
 * تحديث `name`/`default_locale` فقط، عزل المستأجر (IDOR)، RBAC
 * (`commerce.manage`)، التحقق من `default_locale`، ورفض الاسم الفارغ.
 * انعكاس القيمة على `GET /store/v1/storefront` العام مغطّى في
 * `StorefrontPublicIdentityTest`-الأسلوب هنا أيضاً.
 *
 * تشغيل: php artisan test --filter=CommerceWorkspaceStorefrontIdentityApiTest
 */
class CommerceWorkspaceStorefrontIdentityApiTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    private function path(string $id): string
    {
        return '/api/commerce/workspace/storefronts/'.$id;
    }

    /**
     * @return array{channel: SalesChannel, storefront: Storefront, domain: ?StorefrontDomain}
     */
    private function seedWebStorefront(string $tenantId, array $overrides = []): array
    {
        app(TenantContext::class)->set($tenantId);

        $channelSlug = $overrides['channel_slug'] ?? 'web';
        $channel = SalesChannel::query()->where('slug', $channelSlug)->first()
            ?? SalesChannel::create([
                'slug' => $channelSlug,
                'name' => 'ويب',
                'type' => SalesChannel::TYPE_WEB,
                'is_active' => $overrides['channel_active'] ?? true,
            ]);

        $storefront = Storefront::create([
            'slug' => $overrides['slug'] ?? 'main',
            'name' => $overrides['name'] ?? 'المتجر الرئيسي',
            'sales_channel_id' => $channel->id,
            'is_active' => true,
            'default_locale' => $overrides['default_locale'] ?? 'ar',
        ]);

        $domain = null;
        if (array_key_exists('hostname', $overrides) && $overrides['hostname'] !== null) {
            $domain = StorefrontDomain::create([
                'storefront_id' => $storefront->id,
                'hostname' => $overrides['hostname'],
                'type' => StorefrontDomain::TYPE_CUSTOM,
                'is_primary' => true,
                'is_active' => true,
                'verification_status' => StorefrontDomain::VERIFICATION_VERIFIED,
            ]);
        }

        app(TenantContext::class)->forget();

        return compact('channel', 'storefront', 'domain');
    }

    /** @test */
    public function an_authorized_owner_can_update_the_storefront_name(): void
    {
        $auth = $this->registerTenant('name-update', 'owner@name-update.test');
        $seeded = $this->seedWebStorefront($auth['tenant_id'], ['name' => 'الاسم القديم']);

        $res = $this->withToken($auth['token'])
            ->putJson($this->path($seeded['storefront']->id), ['name' => 'الاسم الجديد'])
            ->assertOk();

        $this->assertSame('الاسم الجديد', $res->json('data.store.name'));

        app(TenantContext::class)->set($auth['tenant_id']);
        $this->assertSame('الاسم الجديد', Storefront::query()->find($seeded['storefront']->id)->name);
        app(TenantContext::class)->forget();
    }

    /** @test */
    public function an_authorized_owner_can_update_the_default_locale_from_ar_to_en(): void
    {
        $auth = $this->registerTenant('locale-update', 'owner@locale-update.test');
        $seeded = $this->seedWebStorefront($auth['tenant_id'], ['default_locale' => 'ar']);

        $res = $this->withToken($auth['token'])
            ->putJson($this->path($seeded['storefront']->id), ['default_locale' => 'en'])
            ->assertOk();

        $this->assertSame('en', $res->json('data.store.default_locale'));

        app(TenantContext::class)->set($auth['tenant_id']);
        $this->assertSame('en', Storefront::query()->find($seeded['storefront']->id)->default_locale);
        app(TenantContext::class)->forget();
    }

    /** @test */
    public function both_fields_persist_together_and_independently(): void
    {
        $auth = $this->registerTenant('both-fields', 'owner@both-fields.test');
        $seeded = $this->seedWebStorefront($auth['tenant_id'], ['name' => 'قديم', 'default_locale' => 'ar']);

        $this->withToken($auth['token'])
            ->putJson($this->path($seeded['storefront']->id), ['name' => 'جديد', 'default_locale' => 'en'])
            ->assertOk();

        app(TenantContext::class)->set($auth['tenant_id']);
        $fresh = Storefront::query()->find($seeded['storefront']->id);
        $this->assertSame('جديد', $fresh->name);
        $this->assertSame('en', $fresh->default_locale);
        app(TenantContext::class)->forget();

        // Updating only one field leaves the other untouched.
        $this->withToken($auth['token'])
            ->putJson($this->path($seeded['storefront']->id), ['name' => 'أحدث'])
            ->assertOk();

        app(TenantContext::class)->set($auth['tenant_id']);
        $fresh = Storefront::query()->find($seeded['storefront']->id);
        $this->assertSame('أحدث', $fresh->name);
        $this->assertSame('en', $fresh->default_locale);
        app(TenantContext::class)->forget();
    }

    /** @test */
    public function an_invalid_locale_is_rejected(): void
    {
        $auth = $this->registerTenant('bad-locale', 'owner@bad-locale.test');
        $seeded = $this->seedWebStorefront($auth['tenant_id']);

        $this->withToken($auth['token'])
            ->putJson($this->path($seeded['storefront']->id), ['default_locale' => 'fr'])
            ->assertStatus(422);

        app(TenantContext::class)->set($auth['tenant_id']);
        $this->assertSame('ar', Storefront::query()->find($seeded['storefront']->id)->default_locale);
        app(TenantContext::class)->forget();
    }

    /** @test */
    public function a_blank_or_whitespace_only_name_is_rejected(): void
    {
        $auth = $this->registerTenant('blank-name', 'owner@blank-name.test');
        $seeded = $this->seedWebStorefront($auth['tenant_id'], ['name' => 'الاسم الأصلي']);

        $this->withToken($auth['token'])
            ->putJson($this->path($seeded['storefront']->id), ['name' => '   '])
            ->assertStatus(422);

        app(TenantContext::class)->set($auth['tenant_id']);
        $this->assertSame('الاسم الأصلي', Storefront::query()->find($seeded['storefront']->id)->name);
        app(TenantContext::class)->forget();
    }

    /** @test */
    public function omitted_or_null_name_does_not_blank_the_existing_value(): void
    {
        $auth = $this->registerTenant('omitted-name', 'owner@omitted-name.test');
        $seeded = $this->seedWebStorefront($auth['tenant_id'], ['name' => 'يبقى كما هو']);

        $this->withToken($auth['token'])
            ->putJson($this->path($seeded['storefront']->id), ['name' => null, 'default_locale' => 'en'])
            ->assertOk();

        app(TenantContext::class)->set($auth['tenant_id']);
        $this->assertSame('يبقى كما هو', Storefront::query()->find($seeded['storefront']->id)->name);
        app(TenantContext::class)->forget();
    }

    /** @test */
    public function a_staff_user_without_commerce_manage_is_denied(): void
    {
        $auth = $this->registerTenant('staff-identity', 'owner@staff-identity.test');
        $seeded = $this->seedWebStorefront($auth['tenant_id']);
        $staff = $this->tokenForRole($auth['tenant_id'], 'staff', 'staff@staff-identity.test');

        $this->withToken($staff)
            ->putJson($this->path($seeded['storefront']->id), ['name' => 'محاولة موظف'])
            ->assertForbidden();

        app(TenantContext::class)->set($auth['tenant_id']);
        $this->assertNotSame('محاولة موظف', Storefront::query()->find($seeded['storefront']->id)->name);
        app(TenantContext::class)->forget();
    }

    /** @test */
    public function self_service_is_forbidden(): void
    {
        $auth = $this->registerTenant('ss-identity', 'owner@ss-identity.test');
        $seeded = $this->seedWebStorefront($auth['tenant_id']);
        $ss = $this->tokenForRole($auth['tenant_id'], 'self_service', 'ss@ss-identity.test');

        $this->withToken($ss)
            ->putJson($this->path($seeded['storefront']->id), ['name' => 'محاولة عميل'])
            ->assertForbidden();
    }

    /** @test */
    public function guests_are_rejected(): void
    {
        $auth = $this->registerTenant('guest-identity', 'owner@guest-identity.test');
        $seeded = $this->seedWebStorefront($auth['tenant_id']);

        $this->putJson($this->path($seeded['storefront']->id), ['name' => 'محاولة زائر'])
            ->assertUnauthorized();
    }

    /** @test */
    public function a_cross_tenant_storefront_id_returns_404_and_leaves_it_unchanged(): void
    {
        $a = $this->registerTenant('idor-a', 'owner@idor-a.test');
        $b = $this->registerTenant('idor-b', 'owner@idor-b.test');
        $seededB = $this->seedWebStorefront($b['tenant_id'], ['name' => 'متجر باء الأصلي']);

        $this->withToken($a['token'])
            ->putJson($this->path($seededB['storefront']->id), ['name' => 'استولى عليه ألف'])
            ->assertNotFound();

        app(TenantContext::class)->set($b['tenant_id']);
        $this->assertSame('متجر باء الأصلي', Storefront::query()->find($seededB['storefront']->id)->name);
        app(TenantContext::class)->forget();
    }

    /** @test */
    public function a_nonexistent_storefront_id_returns_404(): void
    {
        $auth = $this->registerTenant('missing-identity', 'owner@missing-identity.test');

        $this->withToken($auth['token'])
            ->putJson($this->path('00000000-0000-0000-0000-000000000000'), ['name' => 'لا يوجد'])
            ->assertNotFound();
    }

    /** @test */
    public function the_client_cannot_mutate_protected_storefront_fields(): void
    {
        $auth = $this->registerTenant('protected-fields', 'owner@protected-fields.test');
        $other = $this->registerTenant('protected-fields-other', 'owner@protected-fields-other.test');
        $seeded = $this->seedWebStorefront($auth['tenant_id'], ['name' => 'قبل', 'slug' => 'main']);

        app(TenantContext::class)->set($other['tenant_id']);
        $otherChannel = SalesChannel::query()->where('slug', 'web')->first()
            ?? SalesChannel::create(['slug' => 'web', 'name' => 'ويب', 'type' => SalesChannel::TYPE_WEB, 'is_active' => true]);
        app(TenantContext::class)->forget();

        $res = $this->withToken($auth['token'])
            ->putJson($this->path($seeded['storefront']->id), [
                'tenant_id' => $other['tenant_id'],
                'sales_channel_id' => $otherChannel->id,
                'slug' => 'hijacked-slug',
                'is_active' => false,
                'name' => 'بعد',
            ])
            ->assertOk();

        $this->assertSame('بعد', $res->json('data.store.name'));

        app(TenantContext::class)->set($auth['tenant_id']);
        $fresh = Storefront::query()->find($seeded['storefront']->id);
        $this->assertSame($auth['tenant_id'], $fresh->tenant_id);
        $this->assertSame($seeded['channel']->id, $fresh->sales_channel_id);
        $this->assertSame('main', $fresh->slug);
        $this->assertTrue($fresh->is_active);
        app(TenantContext::class)->forget();
    }

    /** @test */
    public function the_existing_get_storefront_workspace_contract_remains_compatible(): void
    {
        $auth = $this->registerTenant('get-compat', 'owner@get-compat.test');
        $this->seedWebStorefront($auth['tenant_id'], ['name' => 'متجر التوافق', 'hostname' => 'compat.example.com']);

        $res = $this->withToken($auth['token'])->getJson('/api/commerce/workspace/storefronts')->assertOk();

        $this->assertSame(
            ['id', 'name', 'sales_channel_id', 'is_active', 'preview_url', 'default_locale'],
            array_keys($res->json('data.stores.0'))
        );
        $this->assertSame('ar', $res->json('data.stores.0.default_locale'));
    }

    /** @test */
    public function the_existing_post_provisioning_contract_remains_compatible(): void
    {
        $auth = $this->registerTenant('post-compat', 'owner@post-compat.test');

        $res = $this->withToken($auth['token'])->postJson('/api/commerce/workspace/storefronts')->assertCreated();

        $this->assertTrue($res->json('meta.created'));
        $this->assertSame('ar', $res->json('data.store.default_locale'));
    }

    /** @test */
    public function the_public_host_resolved_storefront_config_reflects_an_updated_name_and_locale(): void
    {
        $auth = $this->registerTenant('public-reflect', 'owner@public-reflect.test');
        $seeded = $this->seedWebStorefront($auth['tenant_id'], [
            'name' => 'قبل التحديث',
            'default_locale' => 'ar',
            'hostname' => 'public-reflect.example.com',
        ]);

        $this->withToken($auth['token'])
            ->putJson($this->path($seeded['storefront']->id), ['name' => 'بعد التحديث', 'default_locale' => 'en'])
            ->assertOk();

        $res = $this->getJson('http://public-reflect.example.com/store/v1/storefront')->assertOk();

        $this->assertSame('بعد التحديث', $res->json('data.name'));
        $this->assertSame('en', $res->json('data.default_locale'));
    }
}
