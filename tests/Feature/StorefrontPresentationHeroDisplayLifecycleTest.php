<?php

namespace Tests\Feature;

use App\Models\SalesChannel;
use App\Models\Storefront;
use App\Models\StorefrontDomain;
use App\Models\StorefrontPresentation;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * AWJ-HERO-DISPLAY — دورة الحياة الكاملة على الخادم الحقيقي (HTTP + قاعدة البيانات، بلا محاكاة): حفظ مسودة بخيارات عرض البطل ← إعادة القراءة
 * (= إعادة تحميل المحرر) ← النشر ← القراءة العامة التي يستهلكها المتجر. هذا هو الجزء «يستمر بعد الحفظ والنشر وإعادة التحميل» من المتطلب؛ الجزء
 * المرئي (تحرير ← معاينة) في `web/e2e/awj-hero-display.spec.ts`، والعرض المنشور في اختبارات `HeroSection`.
 *
 * تشغيل: php artisan test --filter=StorefrontPresentationHeroDisplayLifecycleTest
 */
class StorefrontPresentationHeroDisplayLifecycleTest extends TestCase
{
    use InteractsWithApi;
    use RefreshDatabase;

    private function workspacePath(string $id): string
    {
        return '/api/commerce/workspace/storefronts/'.$id.'/presentation';
    }

    /** @return array{storefront: Storefront} */
    private function seedPublicStore(string $tenantId, string $hostname): array
    {
        app(TenantContext::class)->set($tenantId);
        $channel = SalesChannel::query()->where('slug', 'web')->first()
            ?? SalesChannel::create(['slug' => 'web', 'name' => 'ويب', 'type' => SalesChannel::TYPE_WEB, 'is_active' => true]);
        $storefront = Storefront::create(['slug' => 'main', 'name' => 'المتجر', 'sales_channel_id' => $channel->id, 'is_active' => true, 'default_locale' => 'ar']);
        StorefrontDomain::create([
            'storefront_id' => $storefront->id,
            'hostname' => $hostname,
            'type' => StorefrontDomain::TYPE_CUSTOM,
            'is_primary' => true,
            'is_active' => true,
            'verification_status' => StorefrontDomain::VERIFICATION_VERIFIED,
        ]);
        app(TenantContext::class)->forget();

        return compact('storefront');
    }

    /** @param array<string,mixed> $content @return array<string,mixed> */
    private function config(array $content): array
    {
        return ['version' => 3, 'homepage' => ['sections' => [['id' => 'hero', 'type' => 'hero', 'visible' => true, 'content' => $content]]]];
    }

    /** @param list<array<string,mixed>> $sections */
    private function heroOf(array $sections): ?array
    {
        return collect($sections)->firstWhere('id', 'hero')['content'] ?? null;
    }

    /** @test */
    public function display_options_survive_save_reload_publish_and_the_public_read(): void
    {
        $auth = $this->registerTenant('hero-display-live', 'owner@hero-display-live.test');
        $seed = $this->seedPublicStore($auth['tenant_id'], 'hero-display.example.com');
        $token = $this->withToken($auth['token']);
        $path = $this->workspacePath($seed['storefront']->id);
        $edited = ['headline' => 'Hero', 'showTitle' => false, 'showSubheadline' => false, 'showCtas' => false, 'imageHref' => ' /collections/new '];

        // save
        $token->putJson($path, ['config' => $this->config($edited), 'draft_revision' => 0])->assertOk();

        // "reload": a fresh read of the draft returns the merchant's choices, normalised (link trimmed), in canonical key order
        $reloaded = $token->getJson($path)->assertOk();
        $this->assertSame(
            ['headline' => 'Hero', 'showTitle' => false, 'showSubheadline' => false, 'showCtas' => false, 'imageHref' => '/collections/new'],
            $this->heroOf($reloaded->json('data.draft.homepage.sections')),
        );

        // not public until published
        $this->getJson('http://hero-display.example.com/store/v1/storefront')->assertOk()->assertJsonPath('data.presentation', null);

        // publish, then the public runtime (what the storefront renders from) carries the same content
        $token->postJson($path.'/publish', ['draft_revision' => $reloaded->json('data.draft_revision')])->assertOk();
        $public = $this->getJson('http://hero-display.example.com/store/v1/storefront')->assertOk();
        $this->assertSame(
            ['headline' => 'Hero', 'showTitle' => false, 'showSubheadline' => false, 'showCtas' => false, 'imageHref' => '/collections/new'],
            $this->heroOf($public->json('data.presentation.homepage.sections')),
        );

        // the stored snapshot (what a restart / another worker reads) is the same
        $head = StorefrontPresentation::withoutGlobalScopes()->where('storefront_id', $seed['storefront']->id)->firstOrFail();
        $this->assertFalse($this->heroOf($head->published_config['homepage']['sections'])['showTitle']);
    }

    /** @test */
    public function switching_a_part_back_on_removes_the_key_and_an_unsafe_picture_link_is_never_stored(): void
    {
        $auth = $this->registerTenant('hero-display-toggle', 'owner@hero-display-toggle.test');
        $seed = $this->seedPublicStore($auth['tenant_id'], 'hero-toggle.example.com');
        $token = $this->withToken($auth['token']);
        $path = $this->workspacePath($seed['storefront']->id);

        $token->putJson($path, ['config' => $this->config(['headline' => 'H', 'showTitle' => false, 'imageHref' => 'javascript:alert(1)']), 'draft_revision' => 0])->assertOk();
        $this->assertSame(['headline' => 'H', 'showTitle' => false], $this->heroOf($token->getJson($path)->json('data.draft.homepage.sections')));

        // turning it back on is "absent", not `true`
        $token->putJson($path, ['config' => $this->config(['headline' => 'H', 'showTitle' => true]), 'draft_revision' => 1])->assertOk();
        $this->assertSame(['headline' => 'H'], $this->heroOf($token->getJson($path)->json('data.draft.homepage.sections')));
    }

    /** @test */
    public function a_hero_that_never_used_the_options_stores_and_publishes_exactly_what_it_did_before(): void
    {
        $auth = $this->registerTenant('hero-display-legacy', 'owner@hero-display-legacy.test');
        $seed = $this->seedPublicStore($auth['tenant_id'], 'hero-legacy.example.com');
        $token = $this->withToken($auth['token']);
        $path = $this->workspacePath($seed['storefront']->id);
        $legacy = ['headline' => 'Old', 'subheadline' => 'Line', 'ctas' => [['label' => 'Go', 'href' => '/go']]];

        $token->putJson($path, ['config' => $this->config($legacy), 'draft_revision' => 0])->assertOk();
        $read = $token->getJson($path)->assertOk();
        $this->assertSame($legacy, $this->heroOf($read->json('data.draft.homepage.sections')), 'no display key is added to a document that never set one');

        $token->postJson($path.'/publish', ['draft_revision' => $read->json('data.draft_revision')])->assertOk();
        $public = $this->getJson('http://hero-legacy.example.com/store/v1/storefront')->assertOk();
        $hero = $this->heroOf($public->json('data.presentation.homepage.sections'));
        $this->assertSame($legacy, $hero);
        foreach (['showTitle', 'showSubheadline', 'showCtas', 'imageHref'] as $key) {
            $this->assertArrayNotHasKey($key, $hero);
        }
    }
}
