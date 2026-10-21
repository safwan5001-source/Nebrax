<?php

namespace Tests\Feature;

use App\Models\SalesChannel;
use App\Models\Storefront;
use App\Models\StorefrontPresentation;
use App\Services\Commerce\StorefrontPresentationVersionService;
use App\Support\Commerce\SectionDesignContrast;
use App\Support\Commerce\StorefrontPresentationNormalizer;
use App\Support\Commerce\StorefrontPresentationPublishValidator;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/**
 * P3-A-05 follow-up — a *global* gradient background is authorable and previewable in drafts, but the contrast
 * gate does not judge text over it, so publishing it stays blocked until P3-A-06.
 *
 * The first test proves the gap. The rest pin the temporary gate on every publish path (legacy, version,
 * schedule, scheduled execution), that a rejection leaves the previous Published Snapshot untouched, and that
 * it does not reach solid backgrounds, section gradients or the (separate) image gate.
 */
class StorefrontPresentationGlobalGradientGateTest extends TestCase
{
    use InteractsWithApi;
    use RefreshDatabase;

    private const GRADIENT = [
        'kind' => 'gradient',
        'from' => ['hex' => '#0b0b0b'],
        'to' => ['hex' => '#1a1a1a'],
        'direction' => 'to-bottom',
    ];

    private function legacyPath(string $id): string
    {
        return '/api/commerce/workspace/storefronts/'.$id.'/presentation';
    }

    private function listPath(string $id): string
    {
        return $this->legacyPath($id).'/versions';
    }

    private function itemPath(string $id, string $versionId): string
    {
        return $this->listPath($id).'/'.$versionId;
    }

    /** @return array{storefront: Storefront} */
    private function seedWebStorefront(string $tenantId): array
    {
        app(TenantContext::class)->set($tenantId);
        $channel = SalesChannel::query()->where('slug', 'web')->first()
            ?? SalesChannel::create(['slug' => 'web', 'name' => 'ويب', 'type' => SalesChannel::TYPE_WEB, 'is_active' => true]);
        $storefront = Storefront::create([
            'slug' => 'main',
            'name' => 'المتجر الرئيسي',
            'sales_channel_id' => $channel->id,
            'is_active' => true,
        ]);
        app(TenantContext::class)->forget();

        return compact('storefront');
    }

    private function presentationHead(string $storefrontId): ?StorefrontPresentation
    {
        return StorefrontPresentation::withoutGlobalScopes()->where('storefront_id', $storefrontId)->first();
    }

    /**
     * A section of a type judged against the page colour, with dark explicit text (passes on a light page).
     *
     * @return array<string, mixed>
     */
    private function document(array $extra = []): array
    {
        return (new StorefrontPresentationNormalizer)->normalize($extra + [
            'primaryColor' => '#12372a',
            'backgroundColor' => '#f8f9fa',
            'homepage' => ['sections' => [[
                'id' => 'benefits',
                'type' => 'benefits',
                'visible' => true,
                'design' => ['text' => ['body' => ['hex' => '#111827']]],
            ]]],
        ]);
    }

    private function gate(array $normalized): array
    {
        return (new StorefrontPresentationPublishValidator)->errors($normalized);
    }

    /** Publishes a navy snapshot as version A and returns its identity. */
    private function publishNavy($token, string $storefrontId): array
    {
        $a = $token->postJson($this->listPath($storefrontId), ['name' => 'أ'])->assertCreated();
        $aId = $a->json('data.id');
        $token->putJson($this->itemPath($storefrontId, $aId), [
            'config' => ['version' => 2, 'themePreset' => 'navy'],
            'revision' => 1,
        ])->assertOk();
        $token->postJson($this->itemPath($storefrontId, $aId).'/publish', [
            'revision' => 2,
            'expected_published_revision' => null,
            'expected_active_version_id' => null,
        ])->assertOk();

        return ['id' => $aId, 'config' => $this->presentationHead($storefrontId)->published_config];
    }

    private function assertSnapshotUntouched(string $storefrontId, array $previous): void
    {
        $head = $this->presentationHead($storefrontId);
        $this->assertSame($previous['id'], $head->active_version_id);
        $this->assertSame(1, (int) $head->published_revision);
        $this->assertSame($previous['config'], $head->published_config);
        $this->assertSame('navy', $head->published_config['themePreset']);
        $this->assertArrayNotHasKey('background', $head->published_config);
    }

    /** @test */
    public function the_contrast_gate_judges_text_over_a_solid_page_colour_but_not_over_a_global_gradient(): void
    {
        // Dark text on a dark *solid* page is caught…
        $darkSolid = $this->document(['backgroundColor' => '#111827']);
        $this->assertNotSame([], SectionDesignContrast::errors($darkSolid), 'the gate does catch this on a solid');

        // …but the same unreadable page painted as a dark *gradient* is not: sections are judged against
        // `backgroundColor` (still the light fallback), never against the document-level `background`.
        $darkGradient = $this->document(['background' => self::GRADIENT]);
        $this->assertSame('gradient', $darkGradient['background']['kind']);
        $this->assertSame('#f8f9fa', $darkGradient['backgroundColor']);
        $this->assertSame([], SectionDesignContrast::errors($darkGradient), 'GAP: the gradient is never judged');
        // Tripwire: when P3-A-06 teaches the contrast gate to judge global gradients, this assertion must flip
        // and the temporary `global_gradient_background_not_ready` gate must be removed in the same change.
    }

    /** @test */
    public function the_temporary_gate_blocks_only_a_global_gradient_and_leaves_every_other_background_alone(): void
    {
        $blocked = $this->gate($this->document(['background' => self::GRADIENT]));
        $this->assertSame(['background'], array_keys($blocked));
        $this->assertSame('global_gradient_background_not_ready', $blocked['background']['code']);

        // legacy solid colour, an authored solid object, and no background at all
        $this->assertSame([], $this->gate($this->document()));
        $this->assertSame([], $this->gate($this->document(['background' => ['kind' => 'solid', 'color' => ['hex' => '#102030']]])));
        $this->assertSame([], $this->gate((new StorefrontPresentationNormalizer)->normalize([])));

        // a *section* gradient is a different contract, judged by its own gate, and is not touched
        $section = (new StorefrontPresentationNormalizer)->normalize([
            'primaryColor' => '#12372a',
            'homepage' => ['sections' => [[
                'id' => 'hero',
                'type' => 'hero',
                'visible' => true,
                'design' => ['background' => self::GRADIENT],
            ]]],
        ]);
        $this->assertSame('gradient', $section['homepage']['sections'][0]['design']['background']['kind']);
        $this->assertArrayNotHasKey('background', $this->gate($section));
        $this->assertSame([], $this->gate($section));

        // the image gate keeps its own code and message
        $media = $this->gate($this->document(['background' => [
            'kind' => 'media',
            'media' => ['mediaId' => '0b8f6c2e-3d3a-4a53-9c7e-8f1a2b3c4d5e'],
        ]]));
        $this->assertSame('global_media_background_not_ready', $media['background']['code']);
    }

    /** @test */
    public function a_gradient_draft_is_saved_and_kept_but_the_legacy_publish_is_rejected_and_the_snapshot_survives(): void
    {
        $auth = $this->registerTenant('grad-legacy', 'owner@grad-legacy.test');
        $seeded = $this->seedWebStorefront($auth['tenant_id']);
        $token = $this->withToken($auth['token']);
        $path = $this->legacyPath($seeded['storefront']->id);

        $token->putJson($path, ['config' => ['themePreset' => 'navy'], 'draft_revision' => 0])->assertOk();
        $token->postJson($path.'/publish', ['draft_revision' => 1])->assertOk();
        $previous = ['id' => $this->presentationHead($seeded['storefront']->id)->active_version_id, 'config' => $this->presentationHead($seeded['storefront']->id)->published_config];

        // saving the gradient in the draft is allowed and round-trips
        $token->putJson($path, [
            'config' => ['themePreset' => 'navy', 'backgroundColor' => '#f8f9fa', 'background' => self::GRADIENT],
            'draft_revision' => 1,
        ])->assertOk();
        app(TenantContext::class)->set($auth['tenant_id']);
        $this->assertEquals(self::GRADIENT, $this->presentationHead($seeded['storefront']->id)->draft_config['background']);
        app(TenantContext::class)->forget();

        $rejected = $token->postJson($path.'/publish', ['draft_revision' => 2])->assertStatus(422);
        $this->assertSame('global_gradient_background_not_ready', $rejected->json('error_codes.background'));

        $head = $this->presentationHead($seeded['storefront']->id);
        $this->assertSame($previous['config'], $head->published_config);
        $this->assertArrayNotHasKey('background', $head->published_config);
        $this->assertSame(1, (int) $head->published_revision);
    }

    /** @test */
    public function a_gradient_version_is_saved_but_immediate_publish_is_rejected_then_a_solid_replacement_publishes(): void
    {
        $auth = $this->registerTenant('grad-version', 'owner@grad-version.test');
        $seeded = $this->seedWebStorefront($auth['tenant_id']);
        $token = $this->withToken($auth['token']);
        $id = $seeded['storefront']->id;
        $previous = $this->publishNavy($token, $id);

        $b = $token->postJson($this->listPath($id), ['name' => 'ب'])->assertCreated();
        $bId = $b->json('data.id');
        $saved = $token->putJson($this->itemPath($id, $bId), [
            'config' => ['version' => 2, 'themePreset' => 'navy', 'background' => self::GRADIENT],
            'revision' => 1,
        ])->assertOk();
        $this->assertSame('gradient', $saved->json('data.config.background.kind'));

        $body = ['revision' => 2, 'expected_published_revision' => 1, 'expected_active_version_id' => $previous['id']];
        $rejected = $token->postJson($this->itemPath($id, $bId).'/publish', $body)->assertStatus(422);
        $this->assertSame('global_gradient_background_not_ready', $rejected->json('error_codes.background'));
        $this->assertSnapshotUntouched($id, $previous);

        // Switching to Solid in the editor removes the object (the document is replaced as a whole): it publishes.
        $token->putJson($this->itemPath($id, $bId), [
            'config' => ['version' => 2, 'themePreset' => 'sand', 'backgroundColor' => '#ffeedd'],
            'revision' => 2,
        ])->assertOk();
        $token->postJson($this->itemPath($id, $bId).'/publish', ['revision' => 3] + $body)->assertOk();
        $published = $this->presentationHead($id)->published_config;
        $this->assertSame('#ffeedd', $published['backgroundColor']);
        $this->assertArrayNotHasKey('background', $published);
    }

    /** @test */
    public function a_gradient_version_cannot_be_scheduled_and_nothing_is_queued(): void
    {
        $auth = $this->registerTenant('grad-schedule', 'owner@grad-schedule.test');
        $seeded = $this->seedWebStorefront($auth['tenant_id']);
        $token = $this->withToken($auth['token']);
        $id = $seeded['storefront']->id;
        $previous = $this->publishNavy($token, $id);

        $b = $token->postJson($this->listPath($id), ['name' => 'ب'])->assertCreated();
        $bId = $b->json('data.id');
        $saved = $token->putJson($this->itemPath($id, $bId), [
            'config' => ['background' => self::GRADIENT],
            'revision' => 1,
        ])->assertOk();

        $rejected = $token->putJson($this->itemPath($id, $bId).'/schedule', [
            'revision' => $saved->json('data.revision'),
            'scheduled_for' => Carbon::now('UTC')->addHour()->toIso8601String(),
            'expected_schedule_token' => $saved->json('data.schedule_token'),
        ])->assertStatus(422);
        $this->assertSame('global_gradient_background_not_ready', $rejected->json('error_codes.background'));

        $this->assertNull($this->presentationHead($id)->scheduled_version_id);
        $this->assertSnapshotUntouched($id, $previous);
    }

    /** @test */
    public function a_due_scheduled_gradient_is_rejected_at_execution_and_the_published_snapshot_survives(): void
    {
        $auth = $this->registerTenant('grad-due', 'owner@grad-due.test');
        $seeded = $this->seedWebStorefront($auth['tenant_id']);
        $token = $this->withToken($auth['token']);
        $id = $seeded['storefront']->id;
        $previous = $this->publishNavy($token, $id);

        $b = $token->postJson($this->listPath($id), ['name' => 'ب'])->assertCreated();
        $bId = $b->json('data.id');
        $token->putJson($this->itemPath($id, $bId), ['config' => ['background' => self::GRADIENT], 'revision' => 1])->assertOk();

        // Only the scheduler's persisted hand-off is simulated (as the image-gate job test does): this proves the
        // execution boundary cannot be bypassed by a version that was scheduled before the gate existed.
        DB::table('storefront_presentation_versions')->where('id', $bId)->update([
            'scheduled_for' => Carbon::now('UTC')->subMinute(),
            'schedule_generation' => 1,
        ]);
        $this->presentationHead($id)->forceFill(['scheduled_version_id' => $bId])->save();

        $outcome = app(StorefrontPresentationVersionService::class)->executeScheduledPublish($id, $bId, 1);

        $this->assertSame(StorefrontPresentationVersionService::OUTCOME_VALIDATION_REJECTED, $outcome);
        $this->assertSnapshotUntouched($id, $previous);
        $this->assertSame($bId, $this->presentationHead($id)->scheduled_version_id);
    }

    /** @test */
    public function solid_colour_versions_publish_immediately_and_by_schedule_as_before(): void
    {
        $auth = $this->registerTenant('grad-solid-ok', 'owner@grad-solid-ok.test');
        $seeded = $this->seedWebStorefront($auth['tenant_id']);
        $token = $this->withToken($auth['token']);
        $id = $seeded['storefront']->id;
        $previous = $this->publishNavy($token, $id);

        $b = $token->postJson($this->listPath($id), ['name' => 'ب'])->assertCreated();
        $bId = $b->json('data.id');
        $saved = $token->putJson($this->itemPath($id, $bId), [
            'config' => ['themePreset' => 'sand', 'backgroundColor' => '#ffeedd'],
            'revision' => 1,
        ])->assertOk();

        $token->putJson($this->itemPath($id, $bId).'/schedule', [
            'revision' => $saved->json('data.revision'),
            'scheduled_for' => Carbon::now('UTC')->addHour()->toIso8601String(),
            'expected_schedule_token' => $saved->json('data.schedule_token'),
        ])->assertOk();
        $this->assertSame($bId, $this->presentationHead($id)->scheduled_version_id);
        $this->assertSame($previous['config'], $this->presentationHead($id)->published_config); // scheduling alone never publishes
    }
}
