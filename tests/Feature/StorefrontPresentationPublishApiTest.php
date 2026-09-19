<?php

namespace Tests\Feature;

use App\Models\SalesChannel;
use App\Models\Storefront;
use App\Models\StorefrontDomain;
use App\Models\StorefrontPresentation;
use App\Services\Commerce\PresentationDocumentTooLargeException;
use App\Support\Commerce\StorefrontPresentationNormalizer;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * STORE-BACKEND-1 — نشر ذري ومكرّر وحفظ فاشل لا يمسّ المنشورة.
 *
 * تشغيل: php artisan test --filter=StorefrontPresentationPublishApiTest
 */
class StorefrontPresentationPublishApiTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    private function path(string $id): string
    {
        return '/api/commerce/workspace/storefronts/'.$id.'/presentation';
    }

    /**
     * @return array{channel: SalesChannel, storefront: Storefront, domain: ?StorefrontDomain}
     */
    private function seedWebStorefront(string $tenantId, array $overrides = []): array
    {
        app(TenantContext::class)->set($tenantId);

        $channel = SalesChannel::query()->where('slug', $overrides['channel_slug'] ?? 'web')->first()
            ?? SalesChannel::create([
                'slug' => $overrides['channel_slug'] ?? 'web',
                'name' => 'ويب',
                'type' => SalesChannel::TYPE_WEB,
                'is_active' => true,
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
    public function publish_copies_the_normalized_draft_atomically(): void
    {
        $auth = $this->registerTenant('pres-pub', 'owner@pres-pub.test');
        $seeded = $this->seedWebStorefront($auth['tenant_id']);

        $this->withToken($auth['token'])
            ->putJson($this->path($seeded['storefront']->id), [
                'config' => ['themePreset' => 'burgundy', 'homepage' => ['heroHeadline' => 'منشور']],
                'draft_revision' => 0,
            ])
            ->assertOk();

        $res = $this->withToken($auth['token'])
            ->postJson($this->path($seeded['storefront']->id).'/publish', ['draft_revision' => 1])
            ->assertOk();

        $this->assertSame(1, $res->json('data.draft_revision'));
        $this->assertSame(1, $res->json('data.published_revision'));
        $this->assertSame('burgundy', $res->json('data.published.themePreset'));
        $this->assertSame('منشور', $res->json('data.published.homepage.heroHeadline'));
        $this->assertNotNull($res->json('data.published_at'));
        $this->assertSame($res->json('data.draft.homepage.heroHeadline'), $res->json('data.published.homepage.heroHeadline'));
    }

    /** @test */
    public function publish_without_a_saved_draft_is_422(): void
    {
        $auth = $this->registerTenant('pres-pub-empty', 'owner@pres-pub-empty.test');
        $seeded = $this->seedWebStorefront($auth['tenant_id']);

        $this->withToken($auth['token'])
            ->postJson($this->path($seeded['storefront']->id).'/publish')
            ->assertStatus(422);
    }

    /** @test */
    public function a_stale_publish_revision_is_409(): void
    {
        $auth = $this->registerTenant('pres-pub-409', 'owner@pres-pub-409.test');
        $seeded = $this->seedWebStorefront($auth['tenant_id']);

        $this->withToken($auth['token'])
            ->putJson($this->path($seeded['storefront']->id), [
                'config' => ['homepage' => ['heroHeadline' => 'أ']],
                'draft_revision' => 0,
            ])
            ->assertOk();

        $this->withToken($auth['token'])
            ->putJson($this->path($seeded['storefront']->id), [
                'config' => ['homepage' => ['heroHeadline' => 'ب']],
                'draft_revision' => 1,
            ])
            ->assertOk();

        $this->withToken($auth['token'])
            ->postJson($this->path($seeded['storefront']->id).'/publish', ['draft_revision' => 1])
            ->assertStatus(409);
    }

    /** @test */
    public function repeated_publish_is_idempotent_and_does_not_rewrite_published_at(): void
    {
        $auth = $this->registerTenant('pres-pub-idemp', 'owner@pres-pub-idemp.test');
        $seeded = $this->seedWebStorefront($auth['tenant_id']);

        $this->withToken($auth['token'])
            ->putJson($this->path($seeded['storefront']->id), [
                'config' => ['homepage' => ['heroHeadline' => 'ثابت']],
                'draft_revision' => 0,
            ])
            ->assertOk();

        $first = $this->withToken($auth['token'])
            ->postJson($this->path($seeded['storefront']->id).'/publish', ['draft_revision' => 1])
            ->assertOk();

        $publishedAt = $first->json('data.published_at');

        $second = $this->withToken($auth['token'])
            ->postJson($this->path($seeded['storefront']->id).'/publish', ['draft_revision' => 1])
            ->assertOk();

        $this->assertSame($publishedAt, $second->json('data.published_at'));
        $this->assertSame(1, $second->json('data.published_revision'));
        $this->assertSame('ثابت', $second->json('data.published.homepage.heroHeadline'));
    }

    /** @test */
    public function a_failed_publish_leaves_the_previous_published_snapshot_unchanged(): void
    {
        $auth = $this->registerTenant('pres-pub-fail', 'owner@pres-pub-fail.test');
        $seeded = $this->seedWebStorefront($auth['tenant_id']);

        $this->withToken($auth['token'])
            ->putJson($this->path($seeded['storefront']->id), [
                'config' => ['homepage' => ['heroHeadline' => 'اللقطة السابقة']],
                'draft_revision' => 0,
            ])
            ->assertOk();

        $this->withToken($auth['token'])
            ->postJson($this->path($seeded['storefront']->id).'/publish', ['draft_revision' => 1])
            ->assertOk();

        $this->withToken($auth['token'])
            ->putJson($this->path($seeded['storefront']->id), [
                'config' => ['homepage' => ['heroHeadline' => 'مسودة جديدة']],
                'draft_revision' => 1,
            ])
            ->assertOk();

        app(TenantContext::class)->set($auth['tenant_id']);
        $before = StorefrontPresentation::query()->where('storefront_id', $seeded['storefront']->id)->first();
        $publishedJson = json_encode($before->published_config);
        $publishedAt = (string) $before->published_at;
        app(TenantContext::class)->forget();

        $this->app->instance(
            StorefrontPresentationNormalizer::class,
            new class extends StorefrontPresentationNormalizer
            {
                public function normalize(mixed $input, ?int $storedSchemaVersion = null): array
                {
                    throw new PresentationDocumentTooLargeException;
                }
            },
        );
        $this->app->forgetInstance(\App\Services\Commerce\StorefrontPresentationService::class);

        $this->withToken($auth['token'])
            ->postJson($this->path($seeded['storefront']->id).'/publish', ['draft_revision' => 2])
            ->assertStatus(422);

        app(TenantContext::class)->set($auth['tenant_id']);
        $after = StorefrontPresentation::query()->where('storefront_id', $seeded['storefront']->id)->first();
        $this->assertSame($publishedJson, json_encode($after->published_config));
        $this->assertSame($publishedAt, (string) $after->published_at);
        $this->assertSame('اللقطة السابقة', $after->published_config['homepage']['heroHeadline']);
        $this->assertSame('مسودة جديدة', $after->draft_config['homepage']['heroHeadline']);
        app(TenantContext::class)->forget();
    }

    /** @test */
    public function unknown_publish_envelope_keys_are_rejected(): void
    {
        $auth = $this->registerTenant('pres-pub-env', 'owner@pres-pub-env.test');
        $seeded = $this->seedWebStorefront($auth['tenant_id']);

        $this->withToken($auth['token'])
            ->postJson($this->path($seeded['storefront']->id).'/publish', [
                'draft_revision' => 1,
                'is_verified' => true,
            ])
            ->assertStatus(422);
    }

    /** @test */
    public function cross_tenant_publish_is_a_safe_404(): void
    {
        $a = $this->registerTenant('pres-pub-a', 'owner@pres-pub-a.test');
        $b = $this->registerTenant('pres-pub-b', 'owner@pres-pub-b.test');
        $seededB = $this->seedWebStorefront($b['tenant_id']);

        $this->withToken($a['token'])
            ->postJson($this->path($seededB['storefront']->id).'/publish')
            ->assertNotFound()
            ->assertJsonPath('message', 'المتجر غير موجود.');
    }
}
