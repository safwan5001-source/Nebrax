<?php

namespace Tests\Feature;

use App\Models\SalesChannel;
use App\Models\Storefront;
use App\Models\StorefrontDomain;
use App\Support\Commerce\StorefrontPresentationNormalizer;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * B8-1 — محتوى السياسات المترجم داخل `pages[]` (اختياري، لا مفتاح افتراضي، لا تسريب عام).
 *
 * تشغيل: php artisan test --filter=StorefrontPolicyContentTest
 */
class StorefrontPolicyContentTest extends TestCase
{
    use InteractsWithApi;
    use RefreshDatabase;

    private function path(string $id): string
    {
        return '/api/commerce/workspace/storefronts/'.$id.'/presentation';
    }

    /** @return array{storefront: Storefront} */
    private function seedStore(string $tenantId, string $hostname): array
    {
        app(TenantContext::class)->set($tenantId);
        $channel = SalesChannel::query()->where('slug', 'web')->first()
            ?? SalesChannel::create([
                'slug' => 'web', 'name' => 'ويب', 'type' => SalesChannel::TYPE_WEB, 'is_active' => true,
            ]);
        $storefront = Storefront::create([
            'slug' => 'main', 'name' => 'المتجر', 'sales_channel_id' => $channel->id,
            'is_active' => true, 'default_locale' => 'ar',
        ]);
        StorefrontDomain::create([
            'storefront_id' => $storefront->id, 'hostname' => $hostname,
            'type' => StorefrontDomain::TYPE_CUSTOM, 'is_primary' => true, 'is_active' => true,
            'verification_status' => StorefrontDomain::VERIFICATION_VERIFIED,
        ]);
        app(TenantContext::class)->forget();

        return compact('storefront');
    }

    /** @return array<string, mixed> */
    private function policyConfig(string $body): array
    {
        return ['pages' => [
            [
                'id' => 'page-privacy', 'slug' => 'privacy-policy', 'title' => 'الخصوصية', 'enabled' => true,
                'content' => ['ar' => ['title' => 'سياسة الخصوصية', 'body' => $body], 'en' => ['title' => 'Privacy', 'body' => 'EN-'.$body]],
            ],
            ['id' => 'page-about', 'slug' => 'about', 'title' => 'من نحن', 'enabled' => true, 'content' => ['ar' => ['title' => 'x', 'body' => 'y']]],
        ]];
    }

    /** @test */
    public function legacy_pages_and_defaults_gain_no_content_key(): void
    {
        $n = new StorefrontPresentationNormalizer;
        foreach ($n->defaultConfig()['pages'] as $page) {
            $this->assertArrayNotHasKey('content', $page);
        }
        $legacy = ['pages' => [['id' => 'p1', 'slug' => 'returns-policy', 'title' => 'الإرجاع', 'enabled' => true]]];
        $out = $n->normalize($legacy)['pages'];
        $this->assertSame([['id' => 'p1', 'slug' => 'returns-policy', 'title' => 'الإرجاع', 'enabled' => true]], $out);
        $this->assertSame($out, $n->normalize(['pages' => $out])['pages']);
    }

    /** @test */
    public function content_is_kept_only_on_policy_slugs_and_is_idempotent(): void
    {
        $n = new StorefrontPresentationNormalizer;
        $pages = $n->normalize($this->policyConfig('نص'))['pages'];

        $this->assertSame(
            ['ar' => ['title' => 'سياسة الخصوصية', 'body' => 'نص'], 'en' => ['title' => 'Privacy', 'body' => 'EN-نص']],
            $pages[0]['content'],
        );
        $this->assertSame('الخصوصية', $pages[0]['title']);
        $this->assertArrayNotHasKey('content', $pages[1]);
        $this->assertSame($pages, $n->normalize(['pages' => $pages])['pages']);
    }

    /** @test */
    public function content_is_filtered_and_capped(): void
    {
        $n = new StorefrontPresentationNormalizer;
        $raw = ['pages' => [[
            'id' => 'p', 'slug' => 'terms-of-service', 'title' => 't', 'enabled' => true,
            'content' => [
                'fr' => ['title' => 'x', 'body' => 'y'],
                'ar' => ['title' => str_repeat('ع', 200), 'body' => str_repeat('ب', 30000)],
                'en' => ['title' => ' ', 'body' => ''],
            ],
        ], [
            'id' => 'q', 'slug' => 'faq', 'title' => '', 'enabled' => false, 'content' => 'bad',
        ], [
            'id' => 'r', 'slug' => 'shipping-policy', 'title' => '', 'enabled' => false, 'content' => [['a']],
        ]]];
        $pages = $n->normalize($raw)['pages'];

        $this->assertSame(['ar'], array_keys($pages[0]['content']));
        $this->assertSame(80, mb_strlen($pages[0]['content']['ar']['title']));
        $this->assertSame(20000, mb_strlen($pages[0]['content']['ar']['body']));
        $this->assertArrayNotHasKey('content', $pages[1]);
        $this->assertArrayNotHasKey('content', $pages[2]);
    }

    /** @test */
    public function without_policy_content_strips_only_content(): void
    {
        $snap = (new StorefrontPresentationNormalizer)->normalize($this->policyConfig('سري'));
        $stripped = StorefrontPresentationNormalizer::withoutPolicyContent($snap);

        $this->assertArrayNotHasKey('content', $stripped['pages'][0]);
        $this->assertSame('الخصوصية', $stripped['pages'][0]['title']);
        $this->assertSame($snap['themePreset'], $stripped['themePreset']);
    }

    /** @test */
    public function bodies_round_trip_in_workspace_but_never_leak_publicly_and_isolation_holds(): void
    {
        $a = $this->registerTenant('pol-a', 'owner@pol-a.test');
        $b = $this->registerTenant('pol-b', 'owner@pol-b.test');
        $storeA = $this->seedStore($a['tenant_id'], 'pol-a.example.com');
        $storeB = $this->seedStore($b['tenant_id'], 'pol-b.example.com');
        $p = $this->path($storeA['storefront']->id);

        $this->withToken($a['token'])
            ->putJson($p, ['config' => $this->policyConfig('SECRET-A-BODY'), 'draft_revision' => 0])
            ->assertOk()
            ->assertJsonPath('data.draft.pages.0.content.ar.body', 'SECRET-A-BODY');
        $this->withToken($a['token'])->postJson($p.'/publish')->assertOk();

        $this->withToken($a['token'])->getJson($p)->assertOk()
            ->assertJsonPath('data.draft.pages.0.content.ar.body', 'SECRET-A-BODY');

        $public = $this->getJson('http://pol-a.example.com/store/v1/storefront')->assertOk();
        $this->assertSame('privacy-policy', $public->json('data.presentation.pages.0.slug'));
        $this->assertSame('الخصوصية', $public->json('data.presentation.pages.0.title'));
        $this->assertArrayNotHasKey('content', $public->json('data.presentation.pages.0'));
        $this->assertStringNotContainsString('SECRET-A-BODY', $public->getContent());

        $publicB = $this->getJson('http://pol-b.example.com/store/v1/storefront')->assertOk();
        $this->assertStringNotContainsString('SECRET-A-BODY', $publicB->getContent());

        $this->withToken($b['token'])->getJson($p)->assertNotFound();
        $this->withToken($b['token'])
            ->putJson($p, ['config' => $this->policyConfig('HIJACK'), 'draft_revision' => 0])
            ->assertNotFound();
        $this->assertNotNull($storeB['storefront']->id);
    }

    /** @test */
    public function roles_without_commerce_manage_cannot_read_or_write_bodies(): void
    {
        $a = $this->registerTenant('pol-rbac', 'owner@pol-rbac.test');
        $store = $this->seedStore($a['tenant_id'], 'pol-rbac.example.com');
        $p = $this->path($store['storefront']->id);
        $staff = $this->tokenForRole($a['tenant_id'], 'staff', 'staff@pol-rbac.test');

        $this->withToken($staff)->putJson($p, ['config' => $this->policyConfig('X'), 'draft_revision' => 0])->assertForbidden();
        $this->withToken($staff)->getJson($p)->assertForbidden();
    }
}
