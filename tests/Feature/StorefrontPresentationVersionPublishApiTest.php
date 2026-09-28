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


    /** @test */
    public function scheduled_target_is_rejected_until_schedule_is_canceled(): void
    {
        $auth = $this->registerTenant('ver-publish-scheduled', 'owner@ver-publish-scheduled.test');
        $storefront = $this->seedStorefront($auth['tenant_id']);
        $token = $this->withToken($auth['token']);

        $created = $token->postJson($this->listPath($storefront->id), ['name' => 'مجدولة'])
            ->assertCreated();
        $versionId = $created->json('data.id');

        DB::table('storefront_presentation_versions')
            ->where('id', $versionId)
            ->update(['scheduled_for' => now()->addHour()]);
        DB::table('storefront_presentations')
            ->where('storefront_id', $storefront->id)
            ->update(['scheduled_version_id' => $versionId]);

        $token->postJson(
            $this->publishPath($storefront->id, $versionId),
            $this->body(1, null, null),
        )->assertStatus(409);

        $this->assertNull(
            DB::table('storefront_presentations')
                ->where('storefront_id', $storefront->id)
                ->value('active_version_id')
        );
    }

    /** @test */
    public function forward_schema_target_fails_closed_without_replacing_live(): void
    {
        $auth = $this->registerTenant('ver-publish-forward', 'owner@ver-publish-forward.test');
        $storefront = $this->seedStorefront($auth['tenant_id']);
        $token = $this->withToken($auth['token']);

        $live = $token->postJson($this->listPath($storefront->id), ['name' => 'حي'])->assertCreated();
        $liveId = $live->json('data.id');
        $token->postJson($this->publishPath($storefront->id, $liveId), $this->body(1, null, null))->assertOk();

        $candidate = $token->postJson($this->listPath($storefront->id), ['name' => 'مستقبلية'])->assertCreated();
        $candidateId = $candidate->json('data.id');

        DB::table('storefront_presentation_versions')
            ->where('id', $candidateId)
            ->update(['schema_version' => StorefrontPresentationNormalizer::VERSION + 1]);

        $token->postJson(
            $this->publishPath($storefront->id, $candidateId),
            $this->body(1, 1, $liveId),
        )->assertStatus(409);

        $head = DB::table('storefront_presentations')->where('storefront_id', $storefront->id)->first();
        $this->assertSame($liveId, $head->active_version_id);
        $this->assertSame(1, (int) $head->published_revision);
    }

    /** @test */
    public function idempotent_republish_does_not_advance_publication_head(): void
    {
        $auth = $this->registerTenant('ver-publish-idempotent', 'owner@ver-publish-idempotent.test');
        $storefront = $this->seedStorefront($auth['tenant_id']);
        $token = $this->withToken($auth['token']);

        $created = $token->postJson($this->listPath($storefront->id), ['name' => 'حي'])->assertCreated();
        $versionId = $created->json('data.id');

        $token->postJson($this->publishPath($storefront->id, $versionId), $this->body(1, null, null))->assertOk();
        $before = DB::table('storefront_presentations')->where('storefront_id', $storefront->id)->first();

        $token->postJson(
            $this->publishPath($storefront->id, $versionId),
            $this->body(1, 1, $versionId),
        )->assertOk();

        $after = DB::table('storefront_presentations')->where('storefront_id', $storefront->id)->first();
        $this->assertSame((int) $before->published_revision, (int) $after->published_revision);
        $this->assertSame((string) $before->published_at, (string) $after->published_at);
    }

    /** @test */
    public function publish_rejects_unknown_fields(): void
    {
        $auth = $this->registerTenant('ver-publish-envelope', 'owner@ver-publish-envelope.test');
        $storefront = $this->seedStorefront($auth['tenant_id']);
        $token = $this->withToken($auth['token']);

        $created = $token->postJson($this->listPath($storefront->id), ['name' => 'نسخة'])->assertCreated();

        $body = $this->body(1, null, null);
        $body['tenant_id'] = $auth['tenant_id'];

        $token->postJson(
            $this->publishPath($storefront->id, $created->json('data.id')),
            $body,
        )->assertStatus(422);
    }


    /** @test */
    public function publishing_a_new_version_retains_the_previous_live_version_row(): void
    {
        $auth = $this->registerTenant('ver-publish-retain', 'owner@ver-publish-retain.test');
        $storefront = $this->seedStorefront($auth['tenant_id']);
        $token = $this->withToken($auth['token']);

        $first = $token->postJson($this->listPath($storefront->id), ['name' => 'الأول'])->assertCreated();
        $firstId = $first->json('data.id');
        $token->postJson($this->publishPath($storefront->id, $firstId), $this->body(1, null, null))->assertOk();

        $second = $token->postJson($this->listPath($storefront->id), ['name' => 'الثاني'])->assertCreated();
        $secondId = $second->json('data.id');

        $token->postJson(
            $this->publishPath($storefront->id, $secondId),
            $this->body(1, 1, $firstId),
        )->assertOk();

        $this->assertDatabaseHas('storefront_presentation_versions', ['id' => $firstId]);
        $this->assertDatabaseHas('storefront_presentation_versions', ['id' => $secondId]);
        $this->assertSame(
            $secondId,
            DB::table('storefront_presentations')
                ->where('storefront_id', $storefront->id)
                ->value('active_version_id')
        );
    }

    /** @test */
    public function self_service_cannot_publish_a_version(): void
    {
        $auth = $this->registerTenant('ver-publish-self', 'owner@ver-publish-self.test');
        $storefront = $this->seedStorefront($auth['tenant_id']);
        $created = $this->withToken($auth['token'])
            ->postJson($this->listPath($storefront->id), ['name' => 'نسخة'])
            ->assertCreated();

        $selfToken = $this->tokenForRole(
            $auth['tenant_id'],
            'self_service',
            'self@ver-publish-self.test',
        );

        $this->withToken($selfToken)
            ->postJson(
                $this->publishPath($storefront->id, $created->json('data.id')),
                $this->body(1, null, null),
            )
            ->assertForbidden();
    }

}
