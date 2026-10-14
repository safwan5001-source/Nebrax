<?php

namespace Tests\Feature;

use App\Models\SalesChannel;
use App\Models\Storefront;
use App\Models\StorefrontPresentationVersion;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * AWJ-STORE-CTX-1 — حارس الخادم لسياق المتجر النشط.
 *
 * إصلاح الواجهة يمنع تحوّل المتجر النشط تلقائياً («زهور طيبة» ← «زهور الرشد»). هذا الملف يثبت أن الخادم —
 * لا الواجهة — هو السلطة: كل قراءة/كتابة لمظهر متجر محصورة بالمتجر المسمّى في المسار، داخل مستأجر الجلسة،
 * وبصلاحية `commerce.manage`. معرّف نسخة من متجر آخر (في المستأجر نفسه أو غيره) = 404 بلا أي أثر، ولا يوجد
 * مسار حفظ بلا متجر صريح يسقط إلى متجر افتراضي.
 *
 * تشغيل: php artisan test --filter=CommerceActiveStoreIsolationTest
 */
class CommerceActiveStoreIsolationTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    private function versionsPath(string $storefrontId): string
    {
        return '/api/commerce/workspace/storefronts/'.$storefrontId.'/presentation/versions';
    }

    private function versionPath(string $storefrontId, string $versionId): string
    {
        return $this->versionsPath($storefrontId).'/'.$versionId;
    }

    private function seedStorefront(string $tenantId, string $slug, string $name): Storefront
    {
        app(TenantContext::class)->set($tenantId);

        $channel = SalesChannel::query()->where('slug', 'web')->first()
            ?? SalesChannel::create([
                'slug' => 'web',
                'name' => 'ويب',
                'type' => SalesChannel::TYPE_WEB,
                'is_active' => true,
            ]);

        $storefront = Storefront::create([
            'slug' => $slug,
            'name' => $name,
            'sales_channel_id' => $channel->id,
            'is_active' => true,
        ]);

        app(TenantContext::class)->forget();

        return $storefront;
    }

    /** @return array{token: string, tenant_id: string, rashd: Storefront, taiba: Storefront} */
    private function flowersTenant(string $slug = 'flowers'): array
    {
        $auth = $this->registerTenant($slug, 'owner@'.$slug.'.test');

        return [
            'token' => $auth['token'],
            'tenant_id' => $auth['tenant_id'],
            // الاسم يحدّد ترتيب القائمة (`orderBy('name')`): «الرشد» أولاً — الافتراضي الصامت القديم في الواجهة.
            'rashd' => $this->seedStorefront($auth['tenant_id'], 'rashd', 'زهور الرشد'),
            'taiba' => $this->seedStorefront($auth['tenant_id'], 'taiba', 'زهور طيبة'),
        ];
    }

    private function createVersion(string $token, Storefront $storefront, string $name): array
    {
        return $this->withToken($token)
            ->postJson($this->versionsPath($storefront->id), ['name' => $name])
            ->assertCreated()
            ->json('data');
    }

    private function storedVersion(string $id): StorefrontPresentationVersion
    {
        return StorefrontPresentationVersion::query()->withoutGlobalScopes()->findOrFail($id);
    }

    /** @test */
    public function the_store_list_returns_both_stores_of_the_session_tenant_in_name_order_and_nothing_else(): void
    {
        $tenant = $this->flowersTenant();
        $other = $this->registerTenant('other-flowers', 'owner@other-flowers.test');
        $this->seedStorefront($other['tenant_id'], 'foreign', 'متجر أجنبي');

        $stores = $this->withToken($tenant['token'])
            ->getJson('/api/commerce/workspace/storefronts')
            ->assertOk()
            ->json('data.stores');

        $this->assertSame(
            [$tenant['rashd']->id, $tenant['taiba']->id],
            array_column($stores, 'id'),
        );
    }

    /** @test */
    public function saving_a_theme_on_each_store_never_touches_the_other(): void
    {
        $tenant = $this->flowersTenant();
        $taiba = $this->createVersion($tenant['token'], $tenant['taiba'], 'طيبة');
        $rashd = $this->createVersion($tenant['token'], $tenant['rashd'], 'الرشد');

        $this->withToken($tenant['token'])
            ->putJson($this->versionPath($tenant['taiba']->id, $taiba['id']), [
                'config' => ['version' => 2, 'themePreset' => 'slate'],
                'revision' => $taiba['revision'],
            ])->assertOk()->assertJsonPath('data.config.themePreset', 'slate');

        $this->withToken($tenant['token'])
            ->putJson($this->versionPath($tenant['rashd']->id, $rashd['id']), [
                'config' => ['version' => 2, 'themePreset' => 'awj-bloom'],
                'revision' => $rashd['revision'],
            ])->assertOk()->assertJsonPath('data.config.themePreset', 'awj-bloom');

        $this->withToken($tenant['token'])
            ->getJson($this->versionPath($tenant['taiba']->id, $taiba['id']))
            ->assertOk()
            ->assertJsonPath('data.config.themePreset', 'slate')
            ->assertJsonPath('data.revision', $taiba['revision'] + 1);
        $this->withToken($tenant['token'])
            ->getJson($this->versionPath($tenant['rashd']->id, $rashd['id']))
            ->assertOk()
            ->assertJsonPath('data.config.themePreset', 'awj-bloom')
            ->assertJsonPath('data.revision', $rashd['revision'] + 1);

        $this->assertSame($tenant['taiba']->id, $this->storedVersion($taiba['id'])->storefront_id);
        $this->assertSame($tenant['rashd']->id, $this->storedVersion($rashd['id'])->storefront_id);

        // كل متجر يرى نسخه وحده.
        $this->assertSame([$taiba['id']], array_column(
            $this->withToken($tenant['token'])->getJson($this->versionsPath($tenant['taiba']->id))->json('data'),
            'id',
        ));
    }

    /** @test */
    public function a_version_of_one_store_cannot_be_written_through_another_store_of_the_same_tenant(): void
    {
        $tenant = $this->flowersTenant();
        $taiba = $this->createVersion($tenant['token'], $tenant['taiba'], 'طيبة');
        $before = $this->storedVersion($taiba['id'])->only(['name', 'revision', 'config', 'storefront_id']);
        $wrongStore = $tenant['rashd']->id;
        $client = $this->withToken($tenant['token']);

        $client->getJson($this->versionPath($wrongStore, $taiba['id']))->assertNotFound();
        $client->putJson($this->versionPath($wrongStore, $taiba['id']), [
            'config' => ['version' => 2, 'themePreset' => 'awj-bloom'],
            'revision' => $taiba['revision'],
        ])->assertNotFound();
        $client->patchJson($this->versionPath($wrongStore, $taiba['id']), [
            'name' => 'اختطاف',
            'revision' => $taiba['revision'],
        ])->assertNotFound();
        $client->postJson($this->versionPath($wrongStore, $taiba['id']).'/publish', [
            'revision' => $taiba['revision'],
            'expected_published_revision' => null,
            'expected_active_version_id' => null,
        ])->assertNotFound();
        $client->deleteJson($this->versionPath($wrongStore, $taiba['id']))->assertNotFound();
        // «تطبيق ثيم» = مسودة جديدة منسوخة من نسخة مصدر: مصدرٌ من متجر آخر مرفوض ولا يُنشئ شيئاً.
        $client->postJson($this->versionsPath($wrongStore), [
            'name' => 'ثيم',
            'source_version_id' => $taiba['id'],
        ])->assertNotFound();

        $this->assertSame($before, $this->storedVersion($taiba['id'])->only(['name', 'revision', 'config', 'storefront_id']));
        $this->assertSame(0, StorefrontPresentationVersion::query()->withoutGlobalScopes()
            ->where('storefront_id', $wrongStore)->count());
    }

    /** @test */
    public function another_tenant_can_neither_read_nor_write_a_store_or_its_versions(): void
    {
        $tenant = $this->flowersTenant();
        $taiba = $this->createVersion($tenant['token'], $tenant['taiba'], 'طيبة');
        $before = $this->storedVersion($taiba['id'])->only(['name', 'revision', 'config']);

        $intruder = $this->registerTenant('intruder', 'owner@intruder.test');
        $intruderStore = $this->seedStorefront($intruder['tenant_id'], 'own', 'متجر المتطفل');
        $client = $this->withToken($intruder['token']);

        // متجر المستأجر الآخر مباشرة.
        $client->getJson($this->versionsPath($tenant['taiba']->id))->assertNotFound();
        $client->postJson($this->versionsPath($tenant['taiba']->id), ['name' => 'x'])->assertNotFound();
        $client->getJson($this->versionPath($tenant['taiba']->id, $taiba['id']))->assertNotFound();
        $client->putJson($this->versionPath($tenant['taiba']->id, $taiba['id']), [
            'config' => ['version' => 2, 'themePreset' => 'awj-bloom'],
            'revision' => $taiba['revision'],
        ])->assertNotFound();
        $client->getJson('/api/commerce/workspace/storefronts/'.$tenant['taiba']->id.'/products')->assertNotFound();
        $client->getJson('/api/commerce/workspace/storefronts/'.$tenant['taiba']->id.'/vertical-setup')->assertNotFound();
        $client->getJson('/api/commerce/workspace/storefronts/'.$tenant['taiba']->id.'/gift-settings')->assertNotFound();

        // نسخة المستأجر الآخر عبر متجره هو.
        $client->getJson($this->versionPath($intruderStore->id, $taiba['id']))->assertNotFound();
        $client->postJson($this->versionsPath($intruderStore->id), [
            'name' => 'نسخ',
            'source_version_id' => $taiba['id'],
        ])->assertNotFound();

        $this->assertSame($before, $this->storedVersion($taiba['id'])->only(['name', 'revision', 'config']));
        $this->assertNotContains(
            $tenant['taiba']->id,
            array_column($client->getJson('/api/commerce/workspace/storefronts')->json('data.stores'), 'id'),
        );
    }

    /** @test */
    public function a_principal_without_commerce_manage_cannot_read_or_save_any_store_design(): void
    {
        $tenant = $this->flowersTenant();
        $taiba = $this->createVersion($tenant['token'], $tenant['taiba'], 'طيبة');
        $accountant = $this->tokenForRole($tenant['tenant_id'], 'accountant', 'accountant@flowers.test');
        $client = $this->withToken($accountant);

        $client->getJson($this->versionsPath($tenant['taiba']->id))->assertForbidden();
        $client->putJson($this->versionPath($tenant['taiba']->id, $taiba['id']), [
            'config' => ['version' => 2, 'themePreset' => 'awj-bloom'],
            'revision' => $taiba['revision'],
        ])->assertForbidden();
        $client->postJson($this->versionsPath($tenant['taiba']->id), ['name' => 'x'])->assertForbidden();

        $this->assertSame($taiba['revision'], $this->storedVersion($taiba['id'])->revision);
    }

    /** @test */
    public function there_is_no_store_less_write_path_that_could_fall_back_to_a_default_store(): void
    {
        $tenant = $this->flowersTenant();
        $taiba = $this->createVersion($tenant['token'], $tenant['taiba'], 'طيبة');
        $client = $this->withToken($tenant['token']);

        // لا مسار نسخ بلا `{id}`، و`{id}` المشوّه/الفارغ يُرفض من التوجيه — لا «متجر افتراضي» على الخادم.
        $client->postJson('/api/commerce/workspace/storefronts/presentation/versions', ['name' => 'x'])
            ->assertStatus(404);
        $client->putJson('/api/commerce/workspace/storefronts/not-a-uuid/presentation/versions/'.$taiba['id'], [
            'config' => ['version' => 2],
            'revision' => $taiba['revision'],
        ])->assertNotFound();
        $client->putJson('/api/commerce/workspace/storefronts/00000000-0000-4000-8000-000000000000/presentation/versions/'.$taiba['id'], [
            'config' => ['version' => 2],
            'revision' => $taiba['revision'],
        ])->assertNotFound();

        $this->assertSame($taiba['revision'], $this->storedVersion($taiba['id'])->revision);
    }
}
