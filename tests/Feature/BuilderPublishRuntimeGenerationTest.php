<?php

namespace Tests\Feature;

use App\Models\BuilderDraftExperience;
use App\Models\BuilderPublishedExperienceVersion;
use App\Services\AppBuilder\CapabilityManifest;
use App\Services\AppBuilder\RuntimeGenerations;
use App\Services\AppBuilder\SchemaVersion;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * AD-02 (S05b) — حارس النشر: التجربة تُنشر إن **رندرها أي جيل Runtime معروف**، وتُرفض (422) إن لم يرندرها أي جيل.
 * مع جيل واحد (الإنتاج اليوم) السلوك مطابق لما قبل الشريحة.
 *
 * تشغيل: php artisan test --filter=BuilderPublishRuntimeGenerationTest
 */
class BuilderPublishRuntimeGenerationTest extends TestCase
{
    use InteractsWithApi;
    use RefreshDatabase;

    private function twoGenerations(): void
    {
        $base = CapabilityManifest::current();
        $newer = new CapabilityManifest(
            runtimeVersion: new SchemaVersion(1, 1, 0),
            minSupportedSchemaVersion: $base->minSupportedSchemaVersion,
            maxSupportedSchemaVersion: new SchemaVersion(1, 1, 0),
            components: $base->components,
            actions: $base->actions,
            nativeCapabilities: $base->nativeCapabilities,
            dataResources: $base->dataResources,
            schemaFeatures: $base->schemaFeatures,
        );
        $this->app->instance(RuntimeGenerations::class, new RuntimeGenerations([$base, $newer]));
    }

    /** @return array{0: array<string, mixed>, 1: string} */
    private function appWithDraft(string $slug, string $minRuntime): array
    {
        $auth = $this->registerTenant($slug, "owner@{$slug}.test");
        $appId = $this->withToken($auth['token'])->postJson('/api/app-builder/apps', ['name' => 'تطبيق', 'creation_source' => 'scratch'])->json('data.id');
        $schema = BuilderDraftExperience::minimalSafeSchema();
        $schema['minRuntimeVersion'] = $minRuntime;
        $this->withToken($auth['token'])->putJson("/api/app-builder/apps/{$appId}/draft", $this->builderDraftBody($appId, $schema))->assertOk();

        return [$auth, $appId];
    }

    /** @test */
    public function a_draft_needing_a_newer_generation_is_rejected_when_only_the_current_generation_exists(): void
    {
        $this->app->instance(RuntimeGenerations::class, new RuntimeGenerations([CapabilityManifest::current()]));
        [$auth, $appId] = $this->appWithDraft('pub-gen-1', '1.1.0');

        $this->withToken($auth['token'])->postJson("/api/app-builder/apps/{$appId}/versions", [])->assertStatus(422);
        $this->assertSame(0, BuilderPublishedExperienceVersion::withoutGlobalScopes()->where('builder_app_id', $appId)->count());
    }

    /** @test */
    public function the_same_draft_publishes_once_some_known_generation_can_render_it(): void
    {
        $this->twoGenerations();
        [$auth, $appId] = $this->appWithDraft('pub-gen-2', '1.1.0');

        $this->withToken($auth['token'])->postJson("/api/app-builder/apps/{$appId}/versions", [])->assertCreated();
    }

    /** @test */
    public function a_draft_no_known_generation_can_render_is_still_rejected_with_several_generations(): void
    {
        $this->twoGenerations();
        [$auth, $appId] = $this->appWithDraft('pub-gen-3', '2.0.0');

        $this->withToken($auth['token'])->postJson("/api/app-builder/apps/{$appId}/versions", [])->assertStatus(422);
        $this->withToken($auth['token'])->postJson("/api/app-builder/apps/{$appId}/validate", [])->assertStatus(422);
    }

    /** @test */
    public function the_registry_reports_the_lowest_generation_that_can_render_a_schema(): void
    {
        $this->twoGenerations();
        $registry = app(RuntimeGenerations::class);
        $resolver = app(\App\Services\AppBuilder\CompatibilityResolver::class);

        $old = BuilderDraftExperience::minimalSafeSchema();
        $new = $old;
        $new['minRuntimeVersion'] = '1.1.0';
        $none = $old;
        $none['minRuntimeVersion'] = '3.0.0';

        $this->assertSame('1.0.0', (string) $registry->lowestRendering($old, $resolver)?->runtimeVersion);
        $this->assertSame('1.1.0', (string) $registry->lowestRendering($new, $resolver)?->runtimeVersion);
        $this->assertNull($registry->lowestRendering($none, $resolver));
    }
}
