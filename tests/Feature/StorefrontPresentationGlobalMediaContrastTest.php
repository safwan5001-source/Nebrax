<?php

namespace Tests\Feature;

use App\Models\StorefrontMedia;
use App\Models\StorefrontMediaDerivative;
use App\Services\Commerce\StorefrontMediaContrastEvidence;
use App\Services\Commerce\StorefrontPublishedMediaResolver;
use App\Support\Commerce\GlobalBackgroundContrast;
use App\Support\Commerce\StorefrontPresentationNormalizer;
use App\Support\Commerce\StorefrontPresentationPublishValidator;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * P3-A-06 Checkpoint B — a global picture publishes only when the page foregrounds are proven readable over the **worst-case
 * visible pixels** of every picture that can be shown (desktop and phone), under the overlay, and over the fallback colour.
 * The proof uses the existing tenant-scoped pixel evidence (`StorefrontMediaContrastEvidence`); a missing, stale, translucent
 * or unmeasured (animated) picture is unproven and refused. Replaces `global_media_background_not_ready`, which is gone.
 *
 * Real uploaded assets (measured evidence), the same rule on all four publish paths, and nothing moves on a rejection.
 */
class StorefrontPresentationGlobalMediaContrastTest extends TestCase
{
    use AnimatedMediaFixtures;
    use GlobalBackgroundPublishPaths;
    use InteractsWithApi;
    use RefreshDatabase;
    use StorefrontMediaTestSupport;

    private const BASE = '/api/commerce/workspace/storefront-media';

    private int $uploads = 0;

    private function uploadMedia(array $auth, array $colours, ?string $bytes = null, string $name = 'photo.jpg'): string
    {
        $json = $this->withToken($auth['token'])
            ->post(self::BASE, ['files' => [$this->upload($bytes ?? $this->jpegBytes(1600 + $this->uploads++, 900, null, $colours), $name)]], ['Accept' => 'application/json'])
            ->json();
        $this->assertSame('created', $json['data'][0]['status'], json_encode($json));

        return $json['data'][0]['media']['id'];
    }

    /**
     * @return array{auth:array<string,mixed>, light:string, mid:string, dark:string, versionStore:string, legacyStore:string}
     */
    private function tenantWithPictures(string $slug): array
    {
        $this->fakeStorefrontMediaR2();
        $auth = $this->registerTenant($slug, "owner@{$slug}.test");

        return [
            'auth' => $auth,
            'light' => $this->uploadMedia($auth, ['left' => [250, 250, 250], 'right' => [255, 255, 255]]),
            'mid' => $this->uploadMedia($auth, ['left' => [150, 150, 150], 'right' => [230, 230, 230]]),
            'dark' => $this->uploadMedia($auth, ['left' => [10, 12, 14], 'right' => [40, 44, 60]]),
            'versionStore' => $this->seedMediaStorefront($auth['tenant_id'], 'main')['storefront']->id,
            'legacyStore' => $this->seedMediaStorefront($auth['tenant_id'], 'legacy')['storefront']->id,
        ];
    }

    /** @return array<string,mixed> */
    private function picture(string $id, array $extra = []): array
    {
        return ['kind' => 'media', 'media' => ['mediaId' => $id]] + $extra;
    }

    private const SURFACE_90 = ['color' => ['role' => 'surface'], 'alpha' => 90];

    /** @return array<string,mixed> */
    private function document(array $background, array $extra = []): array
    {
        return (new StorefrontPresentationNormalizer)->normalize($extra + ['primaryColor' => '#12372a', 'backgroundColor' => '#f8f9fa', 'background' => $background]);
    }

    /** @return array<string,string> path ⇒ code */
    private function codes(array $normalized): array
    {
        return array_map(
            static fn (array $e): string => $e['code'],
            (new StorefrontPresentationPublishValidator)->errors($normalized),
        );
    }

    private function asTenant(array $t, \Closure $fn): mixed
    {
        app(TenantContext::class)->set($t['auth']['tenant_id']);
        try {
            return $fn();
        } finally {
            app(TenantContext::class)->forget();
        }
    }

    // ───────────────────────── the four publish paths ─────────────────────────

    /** @test */
    public function a_provable_picture_publishes_on_every_path_and_only_the_normalised_reference_is_persisted(): void
    {
        $t = $this->tenantWithPictures('gm-ok');
        $token = $this->withToken($t['auth']['token']);
        $config = [
            'primaryColor' => '#12372a',
            'backgroundColor' => '#f8f9fa',
            'background' => [
                'kind' => 'media',
                // arbitrary URLs, CSS and signed links are not part of the contract: they must never survive
                'media' => ['mediaId' => $t['light'], 'url' => 'https://evil.example/x.jpg', 'style' => 'background:url(x)', 'src' => 'https://r2.example/x?X-Amz-Signature=abc', 'focal' => ['x' => 50, 'y' => 50]],
                'mobile' => ['mediaId' => $t['light']],
                'overlay' => ['color' => ['role' => 'surface'], 'alpha' => 10],
            ],
        ];

        $published = $this->assertAcceptedOnEveryPath($token, $t['versionStore'], $t['legacyStore'], $config);

        $expected = [
            'kind' => 'media',
            'media' => ['mediaId' => $t['light'], 'decorative' => true],
            'mobile' => ['mediaId' => $t['light'], 'decorative' => true],
            'overlay' => ['color' => ['role' => 'surface'], 'alpha' => 10],
        ];
        foreach ($published as $path => $background) {
            $this->assertEquals($expected, $background, $path);
            $this->assertDoesNotMatchRegularExpression('/https?:|url\(|style|X-Amz|signature|\.jpg/i', json_encode($background), $path);
        }
    }

    /** @test */
    public function an_unprovable_picture_is_refused_on_every_path_and_nothing_moves(): void
    {
        $t = $this->tenantWithPictures('gm-bad');
        $token = $this->withToken($t['auth']['token']);

        // a mid-tone photo with no overlay: the darkest pixels are not proven readable under the dark page text
        $this->assertRejectedOnEveryPath(
            $token,
            $t['versionStore'],
            $t['legacyStore'],
            ['primaryColor' => '#12372a', 'backgroundColor' => '#f8f9fa', 'background' => $this->picture($t['mid'])],
            GlobalBackgroundContrast::CODE_MEDIA_INSUFFICIENT,
        );
    }

    // ───────────────────────── contrast policy ─────────────────────────

    /** @test */
    public function the_overlay_decides_and_only_a_light_one_can_prove_the_dark_page_text(): void
    {
        $t = $this->tenantWithPictures('gm-overlay');
        $this->asTenant($t, function () use ($t) {
            $insufficient = ['background' => GlobalBackgroundContrast::CODE_MEDIA_INSUFFICIENT];

            $this->assertSame([], $this->codes($this->document($this->picture($t['light']))), 'a very light picture needs no overlay');
            $this->assertSame($insufficient, $this->codes($this->document($this->picture($t['mid']))));
            $this->assertSame($insufficient, $this->codes($this->document($this->picture($t['mid'], ['overlay' => ['color' => ['role' => 'surface'], 'alpha' => 40]]))), 'a weak overlay does not prove it');
            $this->assertSame([], $this->codes($this->document($this->picture($t['mid'], ['overlay' => self::SURFACE_90]))));
            $this->assertSame([], $this->codes($this->document($this->picture($t['mid'], ['overlay' => ['color' => ['hex' => '#ffffff'], 'alpha' => 90]]))), 'a hex overlay is judged the same as the role');

            // a dark overlay can only make the dark page text harder to read — it never proves it, at any strength
            foreach ([20, 70, 90] as $alpha) {
                $this->assertSame($insufficient, $this->codes($this->document($this->picture($t['light'], ['overlay' => ['color' => ['role' => 'overlay'], 'alpha' => $alpha]]))), "dark overlay {$alpha}");
            }
            // a missing overlay colour defaults to the (dark) overlay role, never to something lighter
            $this->assertSame($insufficient, $this->codes($this->document($this->picture($t['light'], ['overlay' => ['alpha' => 90]]))));

            // a dark photo cannot be rescued even by the strongest approved light overlay: the proof is the worst pixel
            $this->assertSame($insufficient, $this->codes($this->document($this->picture($t['dark'], ['overlay' => self::SURFACE_90]))));
        });
    }

    /** @test */
    public function the_desktop_and_phone_pictures_are_proven_together(): void
    {
        $t = $this->tenantWithPictures('gm-phone');
        $this->asTenant($t, function () use ($t) {
            $this->assertSame([], $this->codes($this->document($this->picture($t['light'], ['mobile' => ['mediaId' => $t['light']]]))));
            // a provable desktop picture does not cover a phone picture that is not
            $this->assertSame(
                ['background' => GlobalBackgroundContrast::CODE_MEDIA_INSUFFICIENT],
                $this->codes($this->document($this->picture($t['light'], ['mobile' => ['mediaId' => $t['dark']]]))),
            );
            // …and a strong light overlay covers both
            $this->assertSame([], $this->codes($this->document($this->picture($t['light'], ['mobile' => ['mediaId' => $t['mid']], 'overlay' => self::SURFACE_90]))));
        });
    }

    /** @test */
    public function the_fallback_colour_under_the_picture_is_part_of_the_proof(): void
    {
        $t = $this->tenantWithPictures('gm-fallback');
        $this->asTenant($t, function () use ($t) {
            // while the picture loads, or if it never does, the page shows backgroundColor: a dark one is unreadable
            $this->assertSame(
                ['background' => GlobalBackgroundContrast::CODE_MEDIA_INSUFFICIENT],
                $this->codes($this->document($this->picture($t['light']), ['backgroundColor' => '#111827'])),
            );
            $this->assertSame([], $this->codes($this->document($this->picture($t['light']), ['backgroundColor' => '#ffffff'])));
        });
    }

    // ───────────────────────── evidence, derivatives, ownership ─────────────────────────

    /** @test */
    public function a_framed_picture_is_proven_by_its_own_derivative_evidence_and_never_generated_by_publishing(): void
    {
        $t = $this->tenantWithPictures('gm-frame');
        $framed = ['mediaId' => $t['light'], 'focal' => ['x' => 100, 'y' => 0]];

        $this->asTenant($t, function () use ($framed) {
            $codes = $this->codes($this->document(['kind' => 'media', 'media' => $framed]));
            $this->assertSame(GlobalBackgroundContrast::CODE_MEDIA_UNPROVEN, $codes['background']);
            $this->assertSame('derivative_not_ready', $codes['background.media.crop'] ?? null, 'the media gate refuses it on its own path');
            $this->assertSame(0, StorefrontMediaDerivative::query()->count(), 'publishing never generates');
        });

        $this->withToken($t['auth']['token'])->postJson(self::BASE.'/'.$t['light'].'/derivatives', ['transform' => ['focal' => $framed['focal']]])->assertOk();

        $this->asTenant($t, function () use ($t, $framed) {
            $this->assertSame([], $this->codes($this->document(['kind' => 'media', 'media' => $framed])), 'proven on the generated derivative');

            // the phone picture's missing derivative blocks the pair
            $codes = $this->codes($this->document(['kind' => 'media', 'media' => $framed, 'mobile' => ['mediaId' => $t['light'], 'focal' => ['x' => 0, 'y' => 100]]]));
            $this->assertSame(GlobalBackgroundContrast::CODE_MEDIA_UNPROVEN, $codes['background']);

            // a derivative row without evidence is not proof
            StorefrontMediaDerivative::query()->first()->forceFill(['region_luminance' => null])->save();
            $this->assertSame(GlobalBackgroundContrast::CODE_MEDIA_UNPROVEN, $this->codes($this->document(['kind' => 'media', 'media' => $framed]))['background']);
        });
    }

    /** @test */
    public function missing_stale_or_translucent_evidence_and_unready_assets_are_never_taken_as_proof(): void
    {
        $t = $this->tenantWithPictures('gm-evidence');
        $this->asTenant($t, function () use ($t) {
            $doc = $this->document($this->picture($t['light']));
            $this->assertSame([], $this->codes($doc));
            $asset = StorefrontMedia::query()->findOrFail($t['light']);
            $good = $asset->region_luminance;

            foreach ([
                'absent' => null,
                'an older shape' => ['avg' => 240],
                'a future version' => [...$good, 'v' => 2],
                'translucent' => [...$good, 'alpha' => true],
                'inverted bounds' => [...$good, 'min' => [250, 250, 250], 'max' => [10, 10, 10]],
                'short channels' => [...$good, 'min' => [250, 250]],
            ] as $label => $evidence) {
                $asset->forceFill(['region_luminance' => $evidence])->save();
                $this->assertSame(GlobalBackgroundContrast::CODE_MEDIA_UNPROVEN, $this->codes($doc)['background'] ?? null, $label);
            }
            $asset->forceFill(['region_luminance' => $good])->save();
            $this->assertSame([], $this->codes($doc), 'restored');

            // an asset that is not ready, or was deleted, proves nothing (and the media gate refuses it on its own path)
            StorefrontMedia::query()->whereKey($t['light'])->update(['variants_state' => StorefrontMedia::VARIANTS_PENDING]);
            $codes = $this->codes($doc);
            $this->assertSame(GlobalBackgroundContrast::CODE_MEDIA_UNPROVEN, $codes['background']);
            $this->assertSame('media_not_ready', $codes['background.media.mediaId']);
            StorefrontMedia::query()->whereKey($t['light'])->update(['variants_state' => StorefrontMedia::VARIANTS_READY, 'state' => StorefrontMedia::STATE_DELETED]);
            $codes = $this->codes($doc);
            $this->assertSame(GlobalBackgroundContrast::CODE_MEDIA_UNPROVEN, $codes['background']);
            $this->assertSame('media_missing', $codes['background.media.mediaId']);
        });
    }

    /** @test */
    public function a_translucent_picture_is_unprovable_because_what_is_behind_it_is_unknown(): void
    {
        $t = $this->tenantWithPictures('gm-alpha');
        $png = $this->uploadMedia($t['auth'], [], $this->pngBytes(1200, 800, true), 'glass.png');
        $this->asTenant($t, function () use ($png) {
            $this->assertSame(GlobalBackgroundContrast::CODE_MEDIA_UNPROVEN, $this->codes($this->document($this->picture($png, ['overlay' => self::SURFACE_90])))['background'] ?? null);
        });
    }

    /** @test */
    public function another_tenants_picture_is_invisible_to_the_policy_the_gate_and_the_publish_paths(): void
    {
        $a = $this->tenantWithPictures('gm-iso-a');
        $b = $this->tenantWithPictures('gm-iso-b');

        $this->asTenant($a, function () use ($b) {
            // B's asset id, referenced from A's document: the evidence and the gate both see nothing
            $this->assertNull(app(StorefrontMediaContrastEvidence::class)->boundsFor(['mediaId' => $b['light']]));
            $codes = $this->codes($this->document($this->picture($b['light'])));
            $this->assertSame(GlobalBackgroundContrast::CODE_MEDIA_UNPROVEN, $codes['background']);
            $this->assertSame('media_missing', $codes['background.media.mediaId']);
            // even with B's evidence provable and the strongest overlay, A can never use it
            $this->assertNotSame([], $this->codes($this->document($this->picture($b['light'], ['overlay' => self::SURFACE_90]))));
        });

        // and every path refuses A's document that points at B's picture
        $this->assertRejectedOnEveryPath(
            $this->withToken($a['auth']['token']),
            $a['versionStore'],
            $a['legacyStore'],
            ['primaryColor' => '#12372a', 'backgroundColor' => '#f8f9fa', 'background' => $this->picture($b['light'])],
            GlobalBackgroundContrast::CODE_MEDIA_UNPROVEN,
        );

        // B's own use of its picture is unaffected
        $this->asTenant($b, function () use ($b) {
            $this->assertSame([], $this->codes($this->document($this->picture($b['light']))));
        });
    }

    // ───────────────────────── animation (still-only) ─────────────────────────

    /** @test */
    public function an_animated_asset_is_not_a_global_background_whatever_the_overlay(): void
    {
        $t = $this->tenantWithPictures('gm-anim');
        $gif = $this->uploadMedia($t['auth'], [], $this->animatedGifBytes(), 'loop.gif');
        $this->asTenant($t, function () use ($t, $gif) {
            foreach ([null, self::SURFACE_90] as $overlay) {
                $bg = $this->picture($gif, $overlay === null ? [] : ['overlay' => $overlay]);
                $this->assertSame(['background' => GlobalBackgroundContrast::CODE_MEDIA_ANIMATED], $this->codes($this->document($bg)));
            }
            // an animated phone picture beside a still desktop one is refused too
            $this->assertSame(
                ['background' => GlobalBackgroundContrast::CODE_MEDIA_ANIMATED],
                $this->codes($this->document($this->picture($t['light'], ['mobile' => ['mediaId' => $gif]]))),
            );
        });
    }

    /** @test */
    public function the_published_resolver_never_exposes_an_animation_for_the_global_background_but_still_does_for_sections(): void
    {
        $t = $this->tenantWithPictures('gm-resolver');
        $gif = $this->uploadMedia($t['auth'], [], $this->animatedGifBytes(), 'loop.gif');
        $published = [
            'background' => ['kind' => 'media', 'media' => ['mediaId' => $gif, 'decorative' => true], 'mobile' => ['mediaId' => $gif, 'decorative' => true]],
            'homepage' => ['sections' => [['id' => 'hero', 'type' => 'hero', 'visible' => true, 'design' => ['background' => ['kind' => 'media', 'media' => ['mediaId' => $gif, 'decorative' => true]]]]]],
        ];

        $resolved = $this->asTenant($t, fn () => app(StorefrontPublishedMediaResolver::class)->resolve($published));

        foreach (['background.media', 'background.mobile'] as $path) {
            $this->assertArrayHasKey($path, $resolved);
            $this->assertArrayNotHasKey('animation', $resolved[$path], $path.': still-only');
            $this->assertNotSame([], $resolved[$path]['sources']);
        }
        $this->assertArrayHasKey('animation', $resolved['homepage.sections.0.design.background.media'], 'section backgrounds keep their animation');
    }

    // ───────────────────────── input constraints & scope ─────────────────────────

    /** @test */
    public function overlay_and_focal_values_are_constrained_by_the_normaliser_and_the_save_gate(): void
    {
        $t = $this->tenantWithPictures('gm-input');
        $token = $this->withToken($t['auth']['token']);
        $legacy = $this->legacyPath($t['legacyStore']);

        // not an approved strength / not an object / out of range: refused at save, never reaching publish
        foreach ([95, 7, 0, -5, '35', 35.5, null] as $alpha) {
            $res = $token->putJson($legacy, ['config' => ['background' => $this->picture($t['light'], ['overlay' => ['color' => ['role' => 'surface'], 'alpha' => $alpha]])], 'draft_revision' => 0]);
            $res->assertStatus(422);
        }

        // out-of-range focal values never survive normalisation (the reference loses the invalid focal, nothing else)
        $doc = $this->document($this->picture($t['light']) + ['mobile' => ['mediaId' => $t['light'], 'focal' => ['x' => 101, 'y' => -1]]]);
        $this->assertArrayNotHasKey('focal', $doc['background']['mobile']);
        $doc = $this->document(['kind' => 'media', 'media' => ['mediaId' => $t['light'], 'focal' => ['x' => 20, 'y' => 80]]]);
        $this->assertSame(['x' => 20, 'y' => 80], $doc['background']['media']['focal']);

        // a malformed picture object is dropped entirely (nothing to publish, nothing to judge)
        foreach ([['kind' => 'media', 'media' => 'https://evil.example/x.jpg'], ['kind' => 'media', 'media' => ['mediaId' => 'not-a-uuid']], ['kind' => 'media']] as $malformed) {
            $this->assertArrayNotHasKey('background', $this->document($malformed));
        }
    }

    /** @test */
    public function solid_backgrounds_and_section_pictures_are_unaffected(): void
    {
        $t = $this->tenantWithPictures('gm-scope');
        $this->asTenant($t, function () use ($t) {
            $sectionPicture = ['homepage' => ['sections' => [['id' => 'hero', 'type' => 'hero', 'visible' => true, 'design' => ['background' => ['kind' => 'media', 'media' => ['mediaId' => $t['dark']]]]]]]];

            // a dark section picture proves its own automatic foreground (existing rule) with no global background…
            $this->assertSame([], $this->codes((new StorefrontPresentationNormalizer)->normalize(['primaryColor' => '#12372a'] + $sectionPicture)));
            // …and is independent of a global solid or a provable global picture
            $this->assertSame([], $this->codes($this->document(['kind' => 'solid', 'color' => ['hex' => '#102030']], $sectionPicture)));
            $this->assertSame([], $this->codes($this->document($this->picture($t['light']), $sectionPicture)));
            // legacy solid colours (even dark) keep their existing behaviour
            $this->assertSame([], $this->codes((new StorefrontPresentationNormalizer)->normalize(['backgroundColor' => '#111827'])));
        });
    }
}
