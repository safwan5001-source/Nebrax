<?php

namespace Tests\Feature;

use App\Models\StorefrontMedia;
use App\Models\StorefrontMediaDerivative;
use App\Services\Commerce\StorefrontMediaContrastEvidence;
use App\Support\Commerce\StorefrontPresentationNormalizer;
use App\Support\Commerce\StorefrontPresentationPublishValidator;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Mockery;
use Tests\TestCase;

/**
 * CUST-HV V6b-2 — خلفية الصورة تُنشَر فقط حين يُثبَت تباين النصّ فوق **بكسلات الصورة المقيسة**
 * (V0 §3.2.1/§4.5): دليلٌ غائب/قيد المعالجة/فاشل/شفّاف ⇒ `contrast_unprovable` على الخلفية.
 *
 * تشغيل: php artisan test --filter=StorefrontMediaBackgroundContrastTest
 */
class StorefrontMediaBackgroundContrastTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;
    use StorefrontMediaTestSupport;

    private const BASE = '/api/commerce/workspace/storefront-media';

    private const BG = 'homepage.sections[0].design.background';

    private int $uploads = 0;

    protected function tearDown(): void
    {
        Mockery::close();
        parent::tearDown();
    }

    /** @param array{left?:array{int,int,int},right?:array{int,int,int}} $colours */
    private function uploadMedia(array $auth, array $colours): array
    {
        $json = $this->withToken($auth['token'])
            ->post(self::BASE, ['files' => [$this->upload($this->jpegBytes(1600 + $this->uploads++, 900, null, $colours))]], ['Accept' => 'application/json'])
            ->json();
        $this->assertSame('created', $json['data'][0]['status'], json_encode($json));

        return $json['data'][0]['media'];
    }

    /** @return array{auth:array<string,mixed>,dark:string,wide:string} */
    private function tenantWithPictures(string $slug): array
    {
        $this->fakeStorefrontMediaR2();
        $auth = $this->registerTenant($slug, "owner@{$slug}.test");
        $this->seedMediaStorefront($auth['tenant_id']);

        return [
            'auth' => $auth,
            'dark' => $this->uploadMedia($auth, ['left' => [10, 12, 14], 'right' => [40, 44, 60]])['id'],
            'wide' => $this->uploadMedia($auth, ['left' => [0, 0, 0], 'right' => [255, 255, 255]])['id'],
        ];
    }

    /**
     * @param  array<string,mixed>  $background
     * @return array<string,mixed>
     */
    private function document(array $background, string $type = 'hero', bool $visible = true): array
    {
        return (new StorefrontPresentationNormalizer)->normalize([
            'primaryColor' => '#12372a',
            'homepage' => ['sections' => [['id' => $type, 'type' => $type, 'visible' => $visible, 'design' => ['background' => $background]]]],
        ]);
    }

    /** @return array<string,string> مسار → رمز */
    private function codes(array $document): array
    {
        return array_map(
            static fn (array $e): string => $e['code'],
            (new StorefrontPresentationPublishValidator)->errors($document),
        );
    }

    /** @test */
    public function a_dark_picture_proves_the_automatic_foreground_and_publishes(): void
    {
        $t = $this->tenantWithPictures('mbc-dark');
        app(TenantContext::class)->set($t['auth']['tenant_id']);

        $this->assertSame([], $this->codes($this->document(['kind' => 'media', 'media' => ['mediaId' => $t['dark']]])));
        app(TenantContext::class)->forget();
    }

    /** @test */
    public function a_black_to_white_picture_is_unprovable_until_an_overlay_darkens_it(): void
    {
        $t = $this->tenantWithPictures('mbc-wide');
        app(TenantContext::class)->set($t['auth']['tenant_id']);

        $this->assertSame(
            [self::BG => 'contrast_unprovable'],
            $this->codes($this->document(['kind' => 'media', 'media' => ['mediaId' => $t['wide']]])),
        );
        $this->assertSame(
            [self::BG => 'contrast_unprovable'],
            $this->codes($this->document(['kind' => 'media', 'media' => ['mediaId' => $t['wide']], 'overlay' => ['alpha' => 20]])),
            'a weak overlay does not prove it',
        );
        $this->assertSame(
            [],
            $this->codes($this->document(['kind' => 'media', 'media' => ['mediaId' => $t['wide']], 'overlay' => ['color' => ['hex' => '#000000'], 'alpha' => 70]])),
        );
        app(TenantContext::class)->forget();
    }

    /** @test */
    public function the_phone_picture_is_judged_with_the_default_one(): void
    {
        $t = $this->tenantWithPictures('mbc-mobile');
        app(TenantContext::class)->set($t['auth']['tenant_id']);

        $this->assertSame(
            [self::BG => 'contrast_unprovable'],
            $this->codes($this->document(['kind' => 'media', 'media' => ['mediaId' => $t['dark']], 'mobile' => ['mediaId' => $t['wide']]])),
            'a dark desktop picture does not cover a wide-range phone one',
        );
        app(TenantContext::class)->forget();
    }

    /** @test */
    public function missing_old_malformed_or_translucent_evidence_is_never_taken_as_proof(): void
    {
        $t = $this->tenantWithPictures('mbc-evidence');
        app(TenantContext::class)->set($t['auth']['tenant_id']);
        $doc = $this->document(['kind' => 'media', 'media' => ['mediaId' => $t['dark']]]);
        $this->assertSame([], $this->codes($doc));

        $asset = StorefrontMedia::query()->findOrFail($t['dark']);
        $good = $asset->region_luminance;

        foreach ([
            'absent' => null,
            'an older shape (no version)' => ['avg' => 20],
            'a future version' => [...$good, 'v' => 2],
            'translucent' => [...$good, 'alpha' => true],
            'inverted bounds' => [...$good, 'min' => [200, 200, 200], 'max' => [10, 10, 10]],
            'short channels' => [...$good, 'min' => [0, 0]],
            'out of range' => [...$good, 'max' => [300, 0, 0]],
        ] as $label => $evidence) {
            $asset->forceFill(['region_luminance' => $evidence])->save();
            $this->assertSame([self::BG => 'contrast_unprovable'], $this->codes($doc), $label);
        }

        $asset->forceFill(['region_luminance' => $good])->save();
        $this->assertSame([], $this->codes($doc), 'restored');
        app(TenantContext::class)->forget();
    }

    /** @test */
    public function a_stored_margin_narrower_than_the_code_never_narrows_the_proof(): void
    {
        $t = $this->tenantWithPictures('mbc-margin');
        app(TenantContext::class)->set($t['auth']['tenant_id']);
        $doc = $this->document(['kind' => 'media', 'media' => ['mediaId' => $t['wide']], 'overlay' => ['color' => ['hex' => '#000000'], 'alpha' => 70]]);
        $asset = StorefrontMedia::query()->findOrFail($t['wide']);

        $bounds = app(StorefrontMediaContrastEvidence::class)->boundsFor(['mediaId' => $t['wide']]);
        $this->assertSame([0, 0, 0], $bounds['min'], 'clamped');
        $this->assertSame([255, 255, 255], $bounds['max'], 'clamped');

        $asset->forceFill(['region_luminance' => [...$asset->region_luminance, 'slack' => ['abs' => 0, 'ringing' => 0]]])->save();
        $this->assertSame($bounds, app(StorefrontMediaContrastEvidence::class)->boundsFor(['mediaId' => $t['wide']]));
        $this->assertSame([], $this->codes($doc));
        app(TenantContext::class)->forget();
    }

    /** @test */
    public function an_unknown_deleted_or_unready_asset_is_unprovable(): void
    {
        $t = $this->tenantWithPictures('mbc-state');
        app(TenantContext::class)->set($t['auth']['tenant_id']);
        $evidence = new StorefrontMediaContrastEvidence;

        $this->assertNull($evidence->boundsFor(['mediaId' => '9a9a9a9a-1111-4222-8333-444455556666']));
        $this->assertNull($evidence->boundsFor([]));

        StorefrontMedia::query()->whereKey($t['dark'])->update(['variants_state' => StorefrontMedia::VARIANTS_PENDING]);
        $this->assertNull((new StorefrontMediaContrastEvidence)->boundsFor(['mediaId' => $t['dark']]));

        StorefrontMedia::query()->whereKey($t['dark'])->update(['variants_state' => StorefrontMedia::VARIANTS_READY, 'state' => StorefrontMedia::STATE_DELETED]);
        $this->assertNull((new StorefrontMediaContrastEvidence)->boundsFor(['mediaId' => $t['dark']]));
        app(TenantContext::class)->forget();
    }

    /** @test */
    public function a_transformed_picture_is_proven_by_its_own_derivative_evidence_not_the_original(): void
    {
        $t = $this->tenantWithPictures('mbc-derivative');
        app(TenantContext::class)->set($t['auth']['tenant_id']);
        $transform = ['crop' => ['x' => 0, 'y' => 0, 'w' => 0.4, 'h' => 1, 'aspect' => '1:1', 'zoom' => 1]];
        $ref = ['mediaId' => $t['wide'], 'crop' => $transform['crop']];
        $doc = $this->document(['kind' => 'media', 'media' => $ref]);

        // مشتقّ غائب: بوّابة الوسائط ترفض، والتباين غير مُثبَت — لا توليد من مسار النشر.
        $codes = $this->codes($doc);
        $this->assertSame('derivative_not_ready', $codes['homepage.sections.0.design.background.media.crop']);
        $this->assertSame('contrast_unprovable', $codes[self::BG]);
        $this->assertSame(0, StorefrontMediaDerivative::query()->count());
        app(TenantContext::class)->forget();

        $this->withToken($t['auth']['token'])->postJson(self::BASE.'/'.$t['wide'].'/derivatives', ['transform' => $transform])->assertOk();

        app(TenantContext::class)->set($t['auth']['tenant_id']);
        $rows = StorefrontMediaDerivative::query()->get();
        $this->assertGreaterThan(0, $rows->count());
        foreach ($rows as $row) {
            $this->assertSame('transform', $row->region_luminance['basis']);
        }
        $this->assertArrayNotHasKey(self::BG, $this->codes($doc), 'the left half of a black|white picture is black — provable on its own derivative');

        // أحد صفوف المشتقّ بلا دليل ⇒ غير مُثبَت.
        $rows->first()->forceFill(['region_luminance' => null])->save();
        $this->assertSame('contrast_unprovable', $this->codes($doc)[self::BG]);
        app(TenantContext::class)->forget();
    }

    /** @test */
    public function a_hidden_section_never_blocks_and_other_types_cannot_carry_a_picture(): void
    {
        $t = $this->tenantWithPictures('mbc-hidden');
        app(TenantContext::class)->set($t['auth']['tenant_id']);

        $this->assertSame([], $this->codes($this->document(['kind' => 'media', 'media' => ['mediaId' => $t['wide']]], 'hero', false)));

        $benefits = $this->document(['kind' => 'media', 'media' => ['mediaId' => $t['wide']]], 'benefits');
        $this->assertArrayNotHasKey('design', $benefits['homepage']['sections'][0], 'dropped by the normalizer, so nothing to prove');
        app(TenantContext::class)->forget();
    }
}
