<?php

namespace Tests\Feature;

use App\Models\Product;
use App\Models\SalesChannel;
use App\Models\Storefront;
use App\Models\StorefrontBusinessProfile;
use App\Models\StorefrontDomain;
use App\Support\Commerce\BusinessVertical;
use App\Support\Commerce\VerticalCapability;
use App\Services\Commerce\CommerceWorkspaceStorefrontsService;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use RuntimeException;
use Tests\TestCase;

/**
 * FLOWERS-H1 — ملف نشاط المتجر (Business Vertical).
 *
 * يغطي: الافتراض `general` لمتجر قائم بلا صفّ، الإسناد عبر PUT الهوية، التحقق
 * من القائمة المحدودة، العزل بين المستأجرين، RBAC، عدم فقد بيانات التاجر عند
 * تغيير الملف، التزويد، كتالوج الملفات، والانعكاس على الإعداد العام.
 *
 * تشغيل: php artisan test --filter=FlowersBusinessVerticalApiTest
 */
class FlowersBusinessVerticalApiTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    private function path(string $id): string
    {
        return '/api/commerce/workspace/storefronts/'.$id;
    }

    /** @return array{channel: SalesChannel, storefront: Storefront} */
    private function seedWebStorefront(string $tenantId, ?string $hostname = null): array
    {
        app(TenantContext::class)->set($tenantId);

        $channel = SalesChannel::query()->where('slug', 'web')->first()
            ?? SalesChannel::create(['slug' => 'web', 'name' => 'ويب', 'type' => SalesChannel::TYPE_WEB, 'is_active' => true]);

        $storefront = Storefront::create([
            'slug' => 'main', 'name' => 'المتجر الرئيسي', 'sales_channel_id' => $channel->id, 'is_active' => true,
        ]);

        if ($hostname !== null) {
            StorefrontDomain::create([
                'storefront_id' => $storefront->id,
                'hostname' => $hostname,
                'type' => StorefrontDomain::TYPE_CUSTOM,
                'is_primary' => true,
                'is_active' => true,
                'verification_status' => StorefrontDomain::VERIFICATION_VERIFIED,
            ]);
        }

        app(TenantContext::class)->forget();

        return compact('channel', 'storefront');
    }

    private function profileCount(string $tenantId): int
    {
        app(TenantContext::class)->set($tenantId);
        $count = StorefrontBusinessProfile::query()->count();
        app(TenantContext::class)->forget();

        return $count;
    }

    /** @test */
    public function an_existing_store_without_a_profile_row_is_general_and_nothing_is_backfilled(): void
    {
        $auth = $this->registerTenant('v-default', 'owner@v-default.test');
        $this->seedWebStorefront($auth['tenant_id']);

        $res = $this->withToken($auth['token'])->getJson('/api/commerce/workspace/storefronts')->assertOk();

        $this->assertSame('general', $res->json('data.stores.0.business_vertical'));
        $this->assertSame([], $res->json('data.stores.0.vertical_profile.recommended_capabilities'));
        $this->assertSame(0, $this->profileCount($auth['tenant_id']));
    }

    /** @test */
    public function an_owner_can_choose_flowers_and_gifts_and_it_persists(): void
    {
        $auth = $this->registerTenant('v-flowers', 'owner@v-flowers.test');
        $seeded = $this->seedWebStorefront($auth['tenant_id']);

        $res = $this->withToken($auth['token'])
            ->putJson($this->path($seeded['storefront']->id), ['business_vertical' => 'flowers_gifts'])
            ->assertOk();

        $this->assertSame('flowers_gifts', $res->json('data.store.business_vertical'));
        $this->assertSame('flowers_gifts', $res->json('data.store.vertical_profile.key'));

        $keys = array_column($res->json('data.store.vertical_profile.recommended_capabilities'), 'key');
        $this->assertContains('occasions', $keys);
        $this->assertContains('gift_message', $keys);
        $this->assertContains('delivery_scheduling', $keys);

        $list = $this->withToken($auth['token'])->getJson('/api/commerce/workspace/storefronts')->assertOk();
        $this->assertSame('flowers_gifts', $list->json('data.stores.0.business_vertical'));
        $this->assertSame(1, $this->profileCount($auth['tenant_id']));
    }

    /** @test */
    public function assigning_the_same_vertical_twice_is_idempotent_and_keeps_one_row(): void
    {
        $auth = $this->registerTenant('v-idem', 'owner@v-idem.test');
        $seeded = $this->seedWebStorefront($auth['tenant_id']);

        foreach ([1, 2] as $_) {
            $this->withToken($auth['token'])
                ->putJson($this->path($seeded['storefront']->id), ['business_vertical' => 'flowers_gifts'])
                ->assertOk();
        }

        $this->assertSame(1, $this->profileCount($auth['tenant_id']));
    }

    /** @test */
    public function an_unknown_vertical_is_rejected_and_nothing_changes(): void
    {
        $auth = $this->registerTenant('v-bad', 'owner@v-bad.test');
        $seeded = $this->seedWebStorefront($auth['tenant_id']);

        foreach (['grocery', 'FLOWERS_GIFTS', '<script>', ['flowers_gifts']] as $bad) {
            $this->withToken($auth['token'])
                ->putJson($this->path($seeded['storefront']->id), ['business_vertical' => $bad])
                ->assertStatus(422);
        }

        $this->assertSame(0, $this->profileCount($auth['tenant_id']));
    }

    /** @test */
    public function null_or_omitted_vertical_does_not_reset_an_existing_choice(): void
    {
        $auth = $this->registerTenant('v-keep', 'owner@v-keep.test');
        $seeded = $this->seedWebStorefront($auth['tenant_id']);
        $id = $seeded['storefront']->id;

        $this->withToken($auth['token'])->putJson($this->path($id), ['business_vertical' => 'flowers_gifts'])->assertOk();

        $this->withToken($auth['token'])->putJson($this->path($id), ['name' => 'اسم جديد'])
            ->assertOk()->assertJsonPath('data.store.business_vertical', 'flowers_gifts');
        $this->withToken($auth['token'])->putJson($this->path($id), ['business_vertical' => null])
            ->assertOk()->assertJsonPath('data.store.business_vertical', 'flowers_gifts');
    }

    /** @test */
    public function identity_and_vertical_changes_roll_back_together_when_the_vertical_write_fails(): void
    {
        $auth = $this->registerTenant('v-atomic', 'owner@v-atomic.test');
        $seeded = $this->seedWebStorefront($auth['tenant_id']);
        $id = $seeded['storefront']->id;
        $originalName = $seeded['storefront']->name;

        app(TenantContext::class)->set($auth['tenant_id']);

        try {
            app(CommerceWorkspaceStorefrontsService::class)->updateIdentityForCurrentTenant($id, [
                'name' => 'اسم يجب ألا يثبت',
                'business_vertical' => 'not-a-real-vertical',
            ]);
            $this->fail('Expected the invalid vertical to abort the atomic settings update.');
        } catch (RuntimeException $e) {
            $this->assertSame('ملف النشاط غير معروف.', $e->getMessage());
        } finally {
            app(TenantContext::class)->forget();
        }

        app(TenantContext::class)->set($auth['tenant_id']);
        $this->assertSame($originalName, Storefront::query()->findOrFail($id)->name);
        $this->assertSame(0, StorefrontBusinessProfile::query()->where('storefront_id', $id)->count());
        app(TenantContext::class)->forget();
    }

    /** @test */
    public function switching_back_to_general_never_deletes_merchant_data(): void
    {
        $auth = $this->registerTenant('v-nodelete', 'owner@v-nodelete.test');
        $seeded = $this->seedWebStorefront($auth['tenant_id']);
        $id = $seeded['storefront']->id;

        app(TenantContext::class)->set($auth['tenant_id']);
        $product = Product::create(['name' => 'باقة ورد جوري', 'type' => 'good', 'unit' => 'piece']);
        app(TenantContext::class)->forget();

        $this->withToken($auth['token'])->putJson($this->path($id), ['business_vertical' => 'flowers_gifts'])->assertOk();
        $this->withToken($auth['token'])->putJson($this->path($id), ['business_vertical' => 'general'])
            ->assertOk()->assertJsonPath('data.store.business_vertical', 'general');

        app(TenantContext::class)->set($auth['tenant_id']);
        $this->assertNotNull(Product::query()->find($product->id));
        $this->assertNotNull(Storefront::query()->find($id));
        app(TenantContext::class)->forget();
    }

    /** @test */
    public function a_cross_tenant_storefront_cannot_have_its_vertical_changed(): void
    {
        $a = $this->registerTenant('v-idor-a', 'owner@v-idor-a.test');
        $b = $this->registerTenant('v-idor-b', 'owner@v-idor-b.test');
        $seededB = $this->seedWebStorefront($b['tenant_id']);

        $this->withToken($a['token'])
            ->putJson($this->path($seededB['storefront']->id), ['business_vertical' => 'flowers_gifts'])
            ->assertNotFound();

        $this->assertSame(0, $this->profileCount($b['tenant_id']));
        $this->assertSame(0, $this->profileCount($a['tenant_id']));
    }

    /** @test */
    public function a_profile_row_cannot_point_at_another_tenants_storefront(): void
    {
        $a = $this->registerTenant('v-model-a', 'owner@v-model-a.test');
        $b = $this->registerTenant('v-model-b', 'owner@v-model-b.test');
        $seededB = $this->seedWebStorefront($b['tenant_id']);

        app(TenantContext::class)->set($a['tenant_id']);
        $this->expectException(RuntimeException::class);
        StorefrontBusinessProfile::create(['storefront_id' => $seededB['storefront']->id, 'vertical' => 'flowers_gifts']);
    }

    /** @test */
    public function the_model_rejects_an_unknown_vertical_key(): void
    {
        $a = $this->registerTenant('v-model-key', 'owner@v-model-key.test');
        $seeded = $this->seedWebStorefront($a['tenant_id']);

        app(TenantContext::class)->set($a['tenant_id']);
        $this->expectException(RuntimeException::class);
        StorefrontBusinessProfile::create(['storefront_id' => $seeded['storefront']->id, 'vertical' => 'grocery']);
    }

    /** @test */
    public function staff_without_commerce_manage_and_self_service_and_guests_are_denied(): void
    {
        $auth = $this->registerTenant('v-rbac', 'owner@v-rbac.test');
        $seeded = $this->seedWebStorefront($auth['tenant_id']);
        $id = $seeded['storefront']->id;

        $staff = $this->tokenForRole($auth['tenant_id'], 'staff', 'staff@v-rbac.test');
        $ss = $this->tokenForRole($auth['tenant_id'], 'self_service', 'ss@v-rbac.test');

        $this->withToken($staff)->putJson($this->path($id), ['business_vertical' => 'flowers_gifts'])->assertForbidden();
        $this->withToken($ss)->putJson($this->path($id), ['business_vertical' => 'flowers_gifts'])->assertForbidden();

        $this->assertSame(0, $this->profileCount($auth['tenant_id']));
    }

    /** @test */
    public function guests_cannot_change_the_vertical(): void
    {
        $auth = $this->registerTenant('v-guest', 'owner@v-guest.test');
        $seeded = $this->seedWebStorefront($auth['tenant_id']);

        $this->putJson($this->path($seeded['storefront']->id), ['business_vertical' => 'flowers_gifts'])->assertUnauthorized();
        $this->assertSame(0, $this->profileCount($auth['tenant_id']));
    }

    /** @test */
    public function provisioning_can_set_the_vertical_only_when_it_creates_the_store(): void
    {
        $auth = $this->registerTenant('v-prov', 'owner@v-prov.test');

        $created = $this->withToken($auth['token'])
            ->postJson('/api/commerce/workspace/storefronts', ['business_vertical' => 'flowers_gifts'])
            ->assertCreated();
        $this->assertSame('flowers_gifts', $created->json('data.store.business_vertical'));

        // إعادة التزويد (تقارب) لا تغيّر الملف القائم.
        $again = $this->withToken($auth['token'])
            ->postJson('/api/commerce/workspace/storefronts', ['business_vertical' => 'general'])
            ->assertOk();
        $this->assertFalse($again->json('meta.created'));
        $this->assertSame('flowers_gifts', $again->json('data.store.business_vertical'));
    }

    /** @test */
    public function provisioning_without_a_vertical_stays_general_and_creates_no_profile_row(): void
    {
        $auth = $this->registerTenant('v-prov-default', 'owner@v-prov-default.test');

        $res = $this->withToken($auth['token'])->postJson('/api/commerce/workspace/storefronts')->assertCreated();

        $this->assertSame('general', $res->json('data.store.business_vertical'));
        $this->assertSame(0, $this->profileCount($auth['tenant_id']));
    }

    /** @test */
    public function the_profile_reports_capability_availability_honestly_from_code(): void
    {
        $auth = $this->registerTenant('v-profile', 'owner@v-profile.test');
        $seeded = $this->seedWebStorefront($auth['tenant_id']);

        $res = $this->withToken($auth['token'])
            ->putJson($this->path($seeded['storefront']->id), ['business_vertical' => 'flowers_gifts'])
            ->assertOk();

        $capabilities = $res->json('data.store.vertical_profile.recommended_capabilities');
        $this->assertNotEmpty($capabilities);
        foreach ($capabilities as $capability) {
            // لا قدرة تُعلن «جاهزة» ما لم يقل الكود صراحةً إنها مبنية.
            $this->assertSame(VerticalCapability::from($capability['key'])->isAvailable(), $capability['available']);
        }
        $this->assertSame(
            array_map(static fn ($c) => $c->value, BusinessVertical::FlowersGifts->recommendedCapabilities()),
            array_column($capabilities, 'key'),
        );
    }

    /** @test */
    public function the_public_config_exposes_only_the_key_for_the_resolved_store(): void
    {
        $a = $this->registerTenant('v-pub-a', 'owner@v-pub-a.test');
        $b = $this->registerTenant('v-pub-b', 'owner@v-pub-b.test');
        $seededA = $this->seedWebStorefront($a['tenant_id'], 'v-pub-a.example.com');
        $this->seedWebStorefront($b['tenant_id'], 'v-pub-b.example.com');

        $this->withToken($a['token'])
            ->putJson($this->path($seededA['storefront']->id), ['business_vertical' => 'flowers_gifts'])
            ->assertOk();

        $resA = $this->getJson('http://v-pub-a.example.com/store/v1/storefront')->assertOk();
        $resB = $this->getJson('http://v-pub-b.example.com/store/v1/storefront')->assertOk();

        $this->assertSame('flowers_gifts', $resA->json('data.business_vertical'));
        $this->assertSame('general', $resB->json('data.business_vertical'));
        $this->assertArrayNotHasKey('vertical_profile', $resA->json('data'));
    }

    /** @test */
    public function an_unrecognised_stored_key_reads_back_as_general_instead_of_breaking(): void
    {
        $this->assertSame(BusinessVertical::General, BusinessVertical::fromStored('legacy_thing'));
        $this->assertSame(BusinessVertical::General, BusinessVertical::fromStored(null));
        $this->assertSame(BusinessVertical::FlowersGifts, BusinessVertical::fromStored('flowers_gifts'));
    }

    /** @test */
    public function a_generic_store_keeps_every_existing_workspace_field(): void
    {
        $auth = $this->registerTenant('v-compat', 'owner@v-compat.test');
        $this->seedWebStorefront($auth['tenant_id']);

        $store = $this->withToken($auth['token'])->getJson('/api/commerce/workspace/storefronts')->json('data.stores.0');

        foreach (['id', 'name', 'sales_channel_id', 'is_active', 'preview_url', 'default_locale'] as $key) {
            $this->assertArrayHasKey($key, $store);
        }
    }
}
