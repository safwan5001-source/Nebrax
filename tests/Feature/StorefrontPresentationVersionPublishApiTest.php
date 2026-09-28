<?php

namespace Tests\Feature;

use App\Models\SalesChannel;
use App\Models\Storefront;
use App\Support\Commerce\StorefrontPresentationNormalizer;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

class StorefrontPresentationVersionPublishApiTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    private function listPath(string $id): string
    {
        return '/api/commerce/workspace/storefronts/'.$id.'/presentation/versions';
    }

    private function itemPath(string $id, string $versionId): string
    {
        return $this->listPath($id).'/'.$versionId;
    }

    private function publishPath(string $id, string $versionId): string
    {
        return $this->itemPath($id, $versionId).'/publish';
    }

    private function body(int $revision, ?int $publishedRevision, ?string $activeVersionId): array
    {
        return [
            'revision' => $revision,
            'expected_published_revision' => $publishedRevision,
            'expected_active_version_id' => $activeVersionId,
        ];
    }

    private function seedStorefront(string $tenantId): Storefront
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
            'slug' => 'main',
            'name' => 'المتجر الرئيسي',
            'sales_channel_id' => $channel->id,
            'is_active' => true,
        ]);

        app(TenantContext::class)->forget();

        return $storefront;
    }

    /** @test */
    public function publish_promotes_exact_version_and_updates_compatibility_head(): void
    {
        $auth = $this->registerTenant('ver-publish', 'owner@ver-publish.test');
        $storefront = $this->seedStorefront($auth['tenant_id']);
        $token = $this->withToken($auth['token']);

        $created = $token->postJson($this->listPath($storefront->id), ['name' => 'مرشح'])
            ->assertCreated();
        $versionId = $created->json('data.id');

        $saved = $token->putJson($this->itemPath($storefront->id, $versionId), [
            'config' => ['version' => 2, 'themePreset' => 'slate'],
            'revision' => 1,
        ])->assertOk();

        $res = $token->postJson(
            $this->publishPath($storefront->id, $versionId),
            $this->body((int) $saved->json('data.revision'), null, null),
        )->assertOk();

        $this->assertSame('published', $res->json('data.state'));
        $this->assertSame('slate', $res->json('data.config.themePreset'));

        $head = DB::table('storefront_presentations')->where('storefront_id', $storefront->id)->first();
        $this->assertSame($versionId, $head->active_version_id);
        $this->assertSame(1, (int) $head->published_revision);
        $this->assertSame('slate', json_decode($head->published_config, true)['themePreset']);
        $this->assertSame(0, (int) $head->draft_revision);

        $legacy = $token->getJson('/api/commerce/workspace/storefronts/'.$storefront->id.'/presentation')
            ->assertOk();
        $this->assertSame('slate', $legacy->json('data.published.themePreset'));
    }

    /** @test */
    public function stale_version_or_publication_head_returns_409_without_replacing_live(): void
    {
        $auth = $this->registerTenant('ver-publish-stale', 'owner@ver-publish-stale.test');
        $storefront = $this->seedStorefront($auth['tenant_id']);
        $token = $this->withToken($auth['token']);

        $first = $token->postJson($this->listPath($storefront->id), ['name' => 'الأول'])->assertCreated();
        $firstId = $first->json('data.id');
        $token->postJson($this->publishPath($storefront->id, $firstId), $this->body(1, null, null))->assertOk();

        $second = $token->postJson($this->listPath($storefront->id), ['name' => 'الثاني'])->assertCreated();
        $secondId = $second->json('data.id');

        $token->postJson($this->publishPath($storefront->id, $secondId), $this->body(0, 1, $firstId))
            ->assertStatus(409);
        $token->postJson($this->publishPath($storefront->id, $secondId), $this->body(1, null, null))
            ->assertStatus(409);

        $head = DB::table('storefront_presentations')->where('storefront_id', $storefront->id)->first();
        $this->assertSame($firstId, $head->active_version_id);
        $this->assertSame(1, (int) $head->published_revision);
    }

    /** @test */
    public function foreign_version_publish_is_a_non_leaking_404(): void
    {
        $authA = $this->registerTenant('ver-publish-a', 'owner@ver-publish-a.test');
        $storeA = $this->seedStorefront($authA['tenant_id']);
        $versionA = $this->withToken($authA['token'])
            ->postJson($this->listPath($storeA->id), ['name' => 'أ'])
            ->assertCreated();

        $authB = $this->registerTenant('ver-publish-b', 'owner@ver-publish-b.test');
        $storeB = $this->seedStorefront($authB['tenant_id']);

        $this->withToken($authB['token'])
            ->postJson(
                $this->publishPath($storeB->id, $versionA->json('data.id')),
                $this->body(1, null, null),
            )
            ->assertNotFound();
    }

}
