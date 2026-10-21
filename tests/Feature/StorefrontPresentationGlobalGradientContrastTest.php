<?php

namespace Tests\Feature;

use App\Models\SalesChannel;
use App\Models\Storefront;
use App\Services\Commerce\StorefrontPresentationVersionService;
use App\Support\Commerce\ContrastEngine;
use App\Support\Commerce\GlobalBackgroundContrast;
use App\Support\Commerce\StorefrontBackgroundNormalizer;
use App\Support\Commerce\StorefrontPresentationNormalizer;
use App\Support\Commerce\StorefrontPresentationPublishValidator;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/**
 * P3-A-06 Checkpoint A — a global gradient publishes only when the contrast of the page foregrounds over its whole
 * luminance range is proven (`GlobalBackgroundContrast`). Replaces the blanket P3-A-05 gate
 * (`global_gradient_background_not_ready`), which is gone.
 *
 * Covered: the policy against the shared PHP/TS fixture, edge cases (interior dip, roles, light brand, direction), the
 * page-bound section text, scope (solid / section backgrounds untouched), malformed input, and every publish path —
 * legacy, version, schedule, scheduled execution — including that a rejection leaves the previous Published Snapshot,
 * the revisions and the schedule state exactly as they were.
 */
class StorefrontPresentationGlobalGradientContrastTest extends TestCase
{
    use GlobalBackgroundPublishPaths;
    use InteractsWithApi;
    use RefreshDatabase;

    /** Both ends light enough for every page foreground over the whole line. */
    private const SAFE = ['kind' => 'gradient', 'from' => ['hex' => '#f8f9fa'], 'to' => ['hex' => '#eff1f2'], 'direction' => 'to-bottom'];

    /** Dark under the dark page text: unreadable. */
    private const UNSAFE = ['kind' => 'gradient', 'from' => ['hex' => '#0b0b0b'], 'to' => ['hex' => '#1a1a1a'], 'direction' => 'to-bottom'];

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

    /** @return array<string,mixed> */
    private function document(array $extra = []): array
    {
        return (new StorefrontPresentationNormalizer)->normalize($extra + ['primaryColor' => '#12372a', 'backgroundColor' => '#f8f9fa']);
    }

    /** @return array<string,string> path ⇒ code */
    private function codes(array $normalized): array
    {
        return array_map(
            static fn (array $e): string => $e['code'],
            (new StorefrontPresentationPublishValidator)->errors($normalized),
        );
    }

    /** @return array<string,mixed> */
    private function fixture(): array
    {
        return json_decode((string) file_get_contents(base_path('tests/Fixtures/presentation/global-background-contrast.json')), true, 512, JSON_THROW_ON_ERROR);
    }

    // ───────────────────────── policy ─────────────────────────

    /** @test */
    public function the_policy_matches_the_shared_fixture_that_the_typescript_twin_also_runs(): void
    {
        $fixture = $this->fixture();
        $this->assertSame(GlobalBackgroundContrast::FOREGROUND_TEXT, $fixture['foregrounds']['text']);
        $this->assertSame(GlobalBackgroundContrast::FOREGROUND_MUTED, $fixture['foregrounds']['muted']);

        foreach ($fixture['cases'] as $case) {
            $doc = [
                'primaryColor' => $case['config']['primaryColor'],
                'accentColor' => $case['config']['accentColor'],
                'palette' => (array) $case['config']['palette'],
                'background' => $case['background'],
            ];
            $paint = GlobalBackgroundContrast::paint($doc);
            $this->assertSame($case['expect']['reason'], $paint['reason'], $case['name']);
            if ($case['expect']['failing'] === null) {
                $this->assertNull($paint['interval'], $case['name']);

                continue;
            }
            $this->assertSame($case['expect']['failing'], GlobalBackgroundContrast::failing(GlobalBackgroundContrast::foregrounds($doc), $paint['interval']), $case['name']);
            $this->assertEqualsWithDelta($case['expect']['min'], $paint['interval']['min'], 1e-6, $case['name']);
            $this->assertEqualsWithDelta($case['expect']['max'], $paint['interval']['max'], 1e-6, $case['name']);
        }
    }

    /** @test */
    public function an_interior_dip_is_caught_even_when_both_endpoints_pass(): void
    {
        $from = ContrastEngine::parseHex('#fce8d1');
        $to = ContrastEngine::parseHex('#a6faff');
        $muted = ContrastEngine::luminance(...ContrastEngine::parseHex(GlobalBackgroundContrast::FOREGROUND_MUTED));
        $needed = 4.5 * ($muted + 0.05) - 0.05;

        // judged on the two ends alone it would pass…
        $this->assertGreaterThan($needed, ContrastEngine::luminance(...$from));
        $this->assertGreaterThan($needed, ContrastEngine::luminance(...$to));
        // …but luminance is convex along the line, so the middle is darker than both ends
        $interval = ContrastEngine::gradientInterval($from, $to);
        $this->assertLessThan($needed, $interval['min']);

        $codes = $this->codes($this->document(['background' => ['kind' => 'gradient', 'from' => ['hex' => '#fce8d1'], 'to' => ['hex' => '#a6faff'], 'direction' => 'to-end']]));
        $this->assertSame(['background' => GlobalBackgroundContrast::CODE_GRADIENT_INSUFFICIENT], $codes);
    }

    /** @test */
    public function every_direction_gives_the_same_verdict_so_rtl_and_ltr_cannot_differ(): void
    {
        foreach (['safe' => [self::SAFE, []], 'unsafe' => [self::UNSAFE, ['background' => GlobalBackgroundContrast::CODE_GRADIENT_INSUFFICIENT]]] as $name => [$gradient, $expected]) {
            foreach (StorefrontBackgroundNormalizer::DIRECTIONS as $direction) {
                $this->assertSame($expected, $this->codes($this->document(['background' => ['direction' => $direction] + $gradient])), "{$name} {$direction}");
            }
        }
    }

    /** @test */
    public function colour_roles_resolve_against_the_approved_palette(): void
    {
        $roles = ['kind' => 'gradient', 'from' => ['role' => 'surface'], 'to' => ['role' => 'surfaceAlt'], 'direction' => 'to-end'];
        $this->assertSame([], $this->codes($this->document(['background' => $roles])));
        // the merchant's palette is what a role means: a dark surfaceAlt makes the same document unprovable
        $this->assertSame(
            ['background' => GlobalBackgroundContrast::CODE_GRADIENT_INSUFFICIENT],
            $this->codes($this->document(['background' => $roles, 'palette' => ['surfaceAlt' => '#223344']])),
        );
        // accent role resolves from accentColor
        $accent = ['kind' => 'gradient', 'from' => ['role' => 'accent'], 'to' => ['hex' => '#ffffff'], 'direction' => 'to-bottom'];
        $this->assertSame([], $this->codes($this->document(['background' => $accent, 'accentColor' => '#fff4cc'])));
    }

    /** @test */
    public function a_light_brand_colour_is_unprovable_as_page_link_text_even_on_a_light_gradient(): void
    {
        $doc = $this->document(['primaryColor' => '#ffd500', 'background' => self::SAFE]);
        $paint = GlobalBackgroundContrast::paint($doc);
        $this->assertSame(['brand'], GlobalBackgroundContrast::failing(GlobalBackgroundContrast::foregrounds($doc), $paint['interval']));
        $this->assertSame(['background' => GlobalBackgroundContrast::CODE_GRADIENT_INSUFFICIENT], $this->codes($doc));
    }

    /** @test */
    public function an_unresolvable_colour_is_not_provable_and_malformed_input_never_reaches_the_gate(): void
    {
        // Fail closed if a document ever reaches the policy with a colour it cannot resolve.
        $errors = GlobalBackgroundContrast::errors(['primaryColor' => '#12372a', 'background' => ['kind' => 'gradient', 'from' => ['hex' => 'nope'], 'to' => ['hex' => '#ffffff'], 'direction' => 'to-end']]);
        $this->assertSame(GlobalBackgroundContrast::CODE_GRADIENT_UNRESOLVED, $errors['background']['code']);

        // Through the real path the normaliser drops what is malformed (no arbitrary CSS, URL or direction survives).
        foreach ([
            ['kind' => 'gradient', 'from' => ['hex' => 'url(http://evil)'], 'to' => ['hex' => '#ffffff'], 'direction' => 'to-end'],
            ['kind' => 'gradient', 'from' => ['hex' => '#ffffff'], 'to' => ['hex' => '#eeeeee'], 'direction' => '45deg); background: url(//evil'],
            ['kind' => 'gradient', 'from' => ['role' => 'brand; x'], 'to' => ['hex' => '#ffffff'], 'direction' => 'to-end'],
            ['kind' => 'gradient', 'from' => 'red', 'to' => ['hex' => '#ffffff'], 'direction' => 'to-end'],
        ] as $malformed) {
            $this->assertArrayNotHasKey('background', $this->document(['background' => $malformed]));
        }
        $this->assertNotSame([], StorefrontBackgroundNormalizer::errors(['kind' => 'gradient', 'from' => ['hex' => 'red'], 'to' => ['hex' => '#fff'], 'direction' => 'to-end']));
    }

    // ───────────────────────── page-bound text & scope ─────────────────────────

    /** @return array<string,mixed> */
    private function documentWithSection(array $design, string $type = 'benefits', array $background = self::SAFE, bool $visible = true): array
    {
        return $this->document([
            'background' => $background,
            'homepage' => ['sections' => [['id' => 's1', 'type' => $type, 'visible' => $visible, 'design' => $design]]],
        ]);
    }

    /** @test */
    public function explicit_text_of_a_section_on_the_page_is_judged_against_the_real_paint(): void
    {
        $bad = ['text' => ['body' => ['hex' => '#ffffff'], 'link' => ['hex' => '#f0f0f0']]];
        // a dark fallback colour keeps the legacy rule quiet, so what is reported here is this policy's own verdict
        $doc = $this->document([
            'backgroundColor' => '#111827',
            'background' => self::SAFE,
            'homepage' => ['sections' => [['id' => 's', 'type' => 'benefits', 'visible' => true, 'design' => $bad]]],
        ]);
        $codes = $this->codes($doc);
        $this->assertSame(GlobalBackgroundContrast::CODE_SECTION_TEXT, $codes['homepage.sections[0].design.text.body'] ?? null);
        $this->assertSame(GlobalBackgroundContrast::CODE_SECTION_TEXT, $codes['homepage.sections[0].design.text.link'] ?? null);
        // and on a light fallback the legacy rule already reports the same fields: never silent
        $legacy = $this->codes($this->documentWithSection($bad));
        $this->assertArrayHasKey('homepage.sections[0].design.text.body', $legacy);

        // legible colours, a hidden section, and the automatic foreground all pass
        $this->assertSame([], $this->codes($this->documentWithSection(['text' => ['body' => ['hex' => '#111827']]])));
        $this->assertSame([], $this->codes($this->documentWithSection($bad, visible: false)));
        $this->assertSame([], $this->codes($this->documentWithSection([])));
    }

    /** @test */
    public function the_legacy_background_colour_no_longer_decides_page_text_over_a_gradient(): void
    {
        // White text with a DARK legacy fallback colour passes today's rule (judged on backgroundColor) — but the page paints
        // a light gradient, so it is unreadable. The real paint decides.
        $doc = $this->document([
            'backgroundColor' => '#111827',
            'background' => self::SAFE,
            'homepage' => ['sections' => [['id' => 's', 'type' => 'benefits', 'visible' => true, 'design' => ['text' => ['body' => ['hex' => '#ffffff']]]]]],
        ]);
        $this->assertSame([], \App\Support\Commerce\SectionDesignContrast::errors($doc), 'the legacy rule is satisfied by the dark fallback');
        $this->assertSame(
            GlobalBackgroundContrast::CODE_SECTION_TEXT,
            $this->codes($doc)['homepage.sections[0].design.text.body'] ?? null,
        );
    }

    /** @test */
    public function sections_with_their_own_surface_or_background_stay_independent(): void
    {
        $white = ['text' => ['body' => ['hex' => '#ffffff']]];
        // own background → judged by its own gate, not by the page
        $own = $this->documentWithSection(['background' => ['kind' => 'solid', 'color' => ['hex' => '#102030']]] + $white);
        $this->assertSame([], $this->codes($own));
        // surface-owning section types ignore the page
        foreach (['hero', 'appPromo', 'wholesale'] as $type) {
            $this->assertSame([], $this->codes($this->documentWithSection($white, $type)), $type);
        }
        // a section-level gradient is judged by SectionDesignContrast exactly as before
        $sectionGradient = ['background' => ['kind' => 'gradient', 'from' => ['hex' => '#0b0b0b'], 'to' => ['hex' => '#1a1a1a'], 'direction' => 'to-end']];
        $this->assertSame([], $this->codes($this->documentWithSection($sectionGradient, 'hero', self::SAFE)));
        $this->assertSame([], $this->codes($this->documentWithSection($sectionGradient, 'hero', background: [])), 'and with no global background at all');
    }

    /** @test */
    public function solid_backgrounds_keep_their_existing_behaviour(): void
    {
        $this->assertSame([], $this->codes($this->document()));
        // a dark legacy colour is not judged by this policy (unchanged, backward compatible)
        $this->assertSame([], $this->codes($this->document(['backgroundColor' => '#111827'])));
        $this->assertSame([], $this->codes($this->document(['background' => ['kind' => 'solid', 'color' => ['hex' => '#102030']]])));
        $this->assertSame([], $this->codes((new StorefrontPresentationNormalizer)->normalize([])));
    }

    // ───────────────────────── publish paths ─────────────────────────

    /** @test */
    public function legacy_publish_accepts_a_safe_gradient_and_rejects_an_unsafe_one_without_touching_the_snapshot(): void
    {
        $auth = $this->registerTenant('grad-legacy', 'owner@grad-legacy.test');
        $id = $this->seedWebStorefront($auth['tenant_id'])['storefront']->id;
        $token = $this->withToken($auth['token']);
        $path = $this->legacyPath($id);

        $token->putJson($path, ['config' => ['themePreset' => 'navy'], 'draft_revision' => 0])->assertOk();
        $token->postJson($path.'/publish', ['draft_revision' => 1])->assertOk();
        $before = $this->presentationHead($id);
        $previous = ['config' => $before->published_config, 'rev' => (int) $before->published_revision, 'at' => (string) $before->published_at];

        // the unsafe gradient is saved in the draft…
        $token->putJson($path, ['config' => ['themePreset' => 'navy', 'background' => self::UNSAFE], 'draft_revision' => 1])->assertOk();
        // …but cannot be published
        $rejected = $token->postJson($path.'/publish', ['draft_revision' => 2])->assertStatus(422);
        $this->assertSame(GlobalBackgroundContrast::CODE_GRADIENT_INSUFFICIENT, $rejected->json('error_codes.background'));
        $after = $this->presentationHead($id);
        $this->assertSame($previous['config'], $after->published_config);
        $this->assertSame($previous['rev'], (int) $after->published_revision);
        $this->assertSame($previous['at'], (string) $after->published_at);
        $this->assertSame(2, (int) $after->draft_revision, 'a rejected publish does not advance the draft');

        // the safe gradient publishes, and republishing it unchanged is idempotent
        $token->putJson($path, ['config' => ['themePreset' => 'navy', 'background' => self::SAFE], 'draft_revision' => 2])->assertOk();
        $ok = $token->postJson($path.'/publish', ['draft_revision' => 3])->assertOk();
        $publishedAt = $ok->json('data.published_at');
        $this->assertEquals(self::SAFE, $this->presentationHead($id)->published_config['background']);
        $again = $token->postJson($path.'/publish', ['draft_revision' => 3])->assertOk();
        $this->assertSame($publishedAt, $again->json('data.published_at'));
    }

    /** @test */
    public function immediate_version_publish_is_gated_and_a_rejection_changes_nothing(): void
    {
        $auth = $this->registerTenant('grad-version', 'owner@grad-version.test');
        $id = $this->seedWebStorefront($auth['tenant_id'])['storefront']->id;
        $token = $this->withToken($auth['token']);
        $previous = $this->publishNavy($token, $id);

        $b = $token->postJson($this->listPath($id), ['name' => 'ب'])->assertCreated();
        $bId = $b->json('data.id');
        $saved = $token->putJson($this->itemPath($id, $bId), ['config' => ['version' => 2, 'themePreset' => 'navy', 'background' => self::UNSAFE], 'revision' => 1])->assertOk();
        $this->assertSame('gradient', $saved->json('data.config.background.kind'), 'the unsafe gradient is kept in the draft');

        $body = ['revision' => 2, 'expected_published_revision' => 1, 'expected_active_version_id' => $previous['id']];
        $rejected = $token->postJson($this->itemPath($id, $bId).'/publish', $body)->assertStatus(422);
        $this->assertSame(GlobalBackgroundContrast::CODE_GRADIENT_INSUFFICIENT, $rejected->json('error_codes.background'));
        $this->assertSnapshotUntouched($id, $previous);
        $this->assertSame(2, (int) DB::table('storefront_presentation_versions')->where('id', $bId)->value('revision'), 'the version revision did not move');

        // a safe gradient in the same version now publishes and becomes the snapshot
        $token->putJson($this->itemPath($id, $bId), ['config' => ['version' => 2, 'themePreset' => 'navy', 'background' => self::SAFE], 'revision' => 2])->assertOk();
        $token->postJson($this->itemPath($id, $bId).'/publish', ['revision' => 3] + $body)->assertOk();
        $this->assertEquals(self::SAFE, $this->presentationHead($id)->published_config['background']);
        $this->assertSame($bId, $this->presentationHead($id)->active_version_id);
    }

    /** @test */
    public function scheduling_is_gated_and_a_rejection_queues_nothing(): void
    {
        $auth = $this->registerTenant('grad-schedule', 'owner@grad-schedule.test');
        $id = $this->seedWebStorefront($auth['tenant_id'])['storefront']->id;
        $token = $this->withToken($auth['token']);
        $previous = $this->publishNavy($token, $id);

        $b = $token->postJson($this->listPath($id), ['name' => 'ب'])->assertCreated();
        $bId = $b->json('data.id');
        $saved = $token->putJson($this->itemPath($id, $bId), ['config' => ['background' => self::UNSAFE], 'revision' => 1])->assertOk();
        $schedule = fn (array $saved) => [
            'revision' => $saved['revision'],
            'scheduled_for' => Carbon::now('UTC')->addHour()->toIso8601String(),
            'expected_schedule_token' => $saved['token'],
        ];

        $rejected = $token->putJson($this->itemPath($id, $bId).'/schedule', $schedule(['revision' => $saved->json('data.revision'), 'token' => $saved->json('data.schedule_token')]))->assertStatus(422);
        $this->assertSame(GlobalBackgroundContrast::CODE_GRADIENT_INSUFFICIENT, $rejected->json('error_codes.background'));
        $head = $this->presentationHead($id);
        $this->assertNull($head->scheduled_version_id);
        $this->assertSame($previous['epoch'], (int) $head->schedule_epoch);
        $this->assertSnapshotUntouched($id, $previous);

        // a safe gradient can be scheduled (scheduling alone never publishes)
        $saved = $token->putJson($this->itemPath($id, $bId), ['config' => ['background' => self::SAFE], 'revision' => 2])->assertOk();
        $token->putJson($this->itemPath($id, $bId).'/schedule', $schedule(['revision' => $saved->json('data.revision'), 'token' => $saved->json('data.schedule_token')]))->assertOk();
        $this->assertSame($bId, $this->presentationHead($id)->scheduled_version_id);
        $this->assertSnapshotUntouched($id, $previous);
    }

    /** @test */
    public function a_due_scheduled_publish_is_gated_at_execution_and_keeps_the_snapshot_and_the_schedule(): void
    {
        $auth = $this->registerTenant('grad-due', 'owner@grad-due.test');
        $id = $this->seedWebStorefront($auth['tenant_id'])['storefront']->id;
        $token = $this->withToken($auth['token']);
        $previous = $this->publishNavy($token, $id);
        $service = app(StorefrontPresentationVersionService::class);

        // unsafe: e.g. scheduled before the policy existed, or edited around it
        $b = $token->postJson($this->listPath($id), ['name' => 'ب'])->assertCreated();
        $bId = $b->json('data.id');
        $token->putJson($this->itemPath($id, $bId), ['config' => ['background' => self::UNSAFE], 'revision' => 1])->assertOk();
        $this->makeDue($id, $bId);

        $this->assertSame(StorefrontPresentationVersionService::OUTCOME_VALIDATION_REJECTED, $service->executeScheduledPublish($id, $bId, 1));
        $this->assertSnapshotUntouched($id, $previous);
        $this->assertSame($bId, $this->presentationHead($id)->scheduled_version_id, 'the schedule is not advanced or cleared by a rejection');
        $this->assertSame(1, (int) DB::table('storefront_presentation_versions')->where('id', $bId)->value('schedule_generation'));

        // safe: the same path publishes it
        $c = $token->postJson($this->listPath($id), ['name' => 'ج'])->assertCreated();
        $cId = $c->json('data.id');
        $token->putJson($this->itemPath($id, $cId), ['config' => ['background' => self::SAFE], 'revision' => 1])->assertOk();
        $this->makeDue($id, $cId);

        $this->assertSame(StorefrontPresentationVersionService::OUTCOME_PUBLISHED, $service->executeScheduledPublish($id, $cId, 1));
        $head = $this->presentationHead($id);
        $this->assertEquals(self::SAFE, $head->published_config['background']);
        $this->assertSame($cId, $head->active_version_id);
        $this->assertSame(2, (int) $head->published_revision);
        $this->assertNull($head->scheduled_version_id);
    }

    /** @test */
    public function an_already_published_snapshot_is_never_revalidated_and_a_later_safe_publish_replaces_it(): void
    {
        $auth = $this->registerTenant('grad-compat', 'owner@grad-compat.test');
        $id = $this->seedWebStorefront($auth['tenant_id'])['storefront']->id;
        $token = $this->withToken($auth['token']);
        $previous = $this->publishNavy($token, $id);

        // A snapshot published before this policy existed (e.g. a dark gradient) stays exactly as stored…
        $legacy = $this->presentationHead($id)->published_config + ['background' => self::UNSAFE];
        DB::table('storefront_presentations')->where('storefront_id', $id)->update(['published_config' => json_encode($legacy)]);
        $this->assertEquals(self::UNSAFE, $this->presentationHead($id)->published_config['background']);

        // …and is replaced by an ordinary safe publish (the read path never re-judged it).
        $b = $token->postJson($this->listPath($id), ['name' => 'ب'])->assertCreated();
        $bId = $b->json('data.id');
        $token->putJson($this->itemPath($id, $bId), ['config' => ['version' => 2, 'themePreset' => 'sand', 'backgroundColor' => '#ffeedd'], 'revision' => 1])->assertOk();
        $token->postJson($this->itemPath($id, $bId).'/publish', ['revision' => 2, 'expected_published_revision' => 1, 'expected_active_version_id' => $previous['id']])->assertOk();
        $published = $this->presentationHead($id)->published_config;
        $this->assertSame('#ffeedd', $published['backgroundColor']);
        $this->assertArrayNotHasKey('background', $published);
    }
}
