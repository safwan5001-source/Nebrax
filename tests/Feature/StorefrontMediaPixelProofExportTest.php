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
 * CUST-HV V6b-5 — مُصدِّر دليل البكسل الحقيقي: يمرّر صوراً فوتوغرافية الطابع (تدرجات + ضجيج + حواف قاسية + نقاط
 * ساطعة) عبر **خط الرفع الحقيقي** (سلّم المتغيّرات WebP/JPEG، دليل `region_luminance`، مشتقّ اقتصاص حقيقي) ثم يكتب
 * الملفات المُقدَّمة فعلاً + الحدود المُوسَّعة + حكم بوّابة النشر لكل إعداد إلى مجلّد، ليقرأه سكربت Chromium
 * (`scripts/store/v6b5-pixel-proof.mjs`) فيقيس البكسلات المرسومة فعلياً ويقارنها بما ادّعته البوّابة.
 *
 * **خامل افتراضياً**: لا يفعل شيئاً ما لم يُضبط `STOREFRONT_PIXEL_PROOF_DIR` (لا يلمس CI العادي).
 *
 * تشغيل: STOREFRONT_PIXEL_PROOF_DIR=/tmp/v6b5 php artisan test --filter=StorefrontMediaPixelProofExportTest
 */
class StorefrontMediaPixelProofExportTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;
    use StorefrontMediaTestSupport;

    private const BASE = '/api/commerce/workspace/storefront-media';

    protected function tearDown(): void
    {
        Mockery::close();
        parent::tearDown();
    }

    /** @return array{int,int,int} */
    private static function rgb(int $r, int $g, int $b): array
    {
        return [max(0, min(255, $r)), max(0, min(255, $g)), max(0, min(255, $b))];
    }

    /** لقطة "فوتوغرافية": تدرّج رأسي + ضجيج حبيبي + عناصر قاسية الحواف. */
    private function photo(string $kind, int $w = 1600, int $h = 900): string
    {
        mt_srand(crc32($kind));
        $im = imagecreatetruecolor($w, $h);
        $c = static fn (array $rgb) => imagecolorallocate($im, ...$rgb);

        $grad = static function (array $top, array $bottom) use ($im, $w, $h): void {
            for ($y = 0; $y < $h; $y++) {
                $t = $y / max(1, $h - 1);
                $col = imagecolorallocate($im, (int) round($top[0] + ($bottom[0] - $top[0]) * $t), (int) round($top[1] + ($bottom[1] - $top[1]) * $t), (int) round($top[2] + ($bottom[2] - $top[2]) * $t));
                imageline($im, 0, $y, $w, $y, $col);
            }
        };

        switch ($kind) {
            case 'dusk':
                $grad([8, 12, 36], [70, 44, 96]);
                imagefilledpolygon($im, [0, $h, 0, (int) ($h * .78), (int) ($w * .25), (int) ($h * .7), (int) ($w * .5), (int) ($h * .8), (int) ($w * .78), (int) ($h * .68), $w, (int) ($h * .75), $w, $h], $c([3, 3, 6]));
                for ($i = 0; $i < 260; $i++) { // نجوم صغيرة ساطعة (حواف قاسية 2px)
                    $x = mt_rand(0, $w - 3);
                    $y = mt_rand(0, (int) ($h * .6));
                    $v = mt_rand(215, 255);
                    imagefilledrectangle($im, $x, $y, $x + 1, $y + 1, $c([$v, $v, $v - 10]));
                }
                break;
            case 'snow':
                $grad([222, 228, 238], [250, 250, 252]);
                for ($i = 0; $i < 9; $i++) { // أشجار داكنة
                    $x = mt_rand(40, $w - 40);
                    $s = mt_rand(60, 160);
                    imagefilledpolygon($im, [$x, (int) ($h * .55) - $s, $x - $s / 3, (int) ($h * .9), $x + $s / 3, (int) ($h * .9)], $c([28, 40, 34]));
                }
                break;
            case 'street':
                imagefilledrectangle($im, 0, 0, $w, $h, $c([118, 112, 104]));
                for ($i = 0; $i < 520; $i++) { // طوب/نوافذ: حواف قاسية بدرجات متباعدة
                    $x = mt_rand(0, $w - 40);
                    $y = mt_rand(0, $h - 30);
                    $v = mt_rand(70, 170);
                    imagefilledrectangle($im, $x, $y, $x + mt_rand(14, 60), $y + mt_rand(8, 28), $c(self::rgb($v, $v - 6, $v - 14)));
                }
                for ($i = 0; $i < 18; $i++) { // نوافذ مضيئة وأبواب داكنة
                    $x = mt_rand(0, $w - 60);
                    $y = mt_rand(0, $h - 80);
                    imagefilledrectangle($im, $x, $y, $x + 38, $y + 56, $i % 2 ? $c([246, 226, 160]) : $c([14, 12, 12]));
                }
                break;
            case 'split':
                imagefilledrectangle($im, 0, 0, intdiv($w, 2) - 1, $h, $c([8, 8, 10]));
                imagefilledrectangle($im, intdiv($w, 2), 0, $w, $h, $c([250, 250, 246]));
                break;
            case 'portrait':
                $grad([60, 30, 24], [16, 10, 14]);
                imagefilledellipse($im, (int) ($w * .6), (int) ($h * .2), (int) ($w * .5), (int) ($w * .5), $c([255, 238, 196]));
                break;
        }

        imagefilter($im, IMG_FILTER_GAUSSIAN_BLUR); // يليّن الحواف قليلاً كعدسة
        for ($i = 0; $i < intdiv($w * $h, 9); $i++) { // حبيبات (ضجيج فيلم)
            $x = mt_rand(0, $w - 1);
            $y = mt_rand(0, $h - 1);
            $rgb = imagecolorsforindex($im, imagecolorat($im, $x, $y));
            $n = mt_rand(-7, 7);
            imagesetpixel($im, $x, $y, $c(self::rgb($rgb['red'] + $n, $rgb['green'] + $n, $rgb['blue'] + $n)));
        }

        ob_start();
        imagejpeg($im, null, 90);

        return (string) ob_get_clean();
    }

    private function uploadPhoto(string $token, string $kind, int $w = 1600, int $h = 900): string
    {
        $json = $this->withToken($token)
            ->post(self::BASE, ['files' => [$this->upload($this->photo($kind, $w, $h), "{$kind}.jpg")]], ['Accept' => 'application/json'])
            ->json();
        $this->assertSame('created', $json['data'][0]['status'], json_encode($json));

        return $json['data'][0]['media']['id'];
    }

    /** @return list<array<string,mixed>> */
    private function exportFiles(string $dir, string $tenantId, string $mediaId, ?string $usageKeyOfDerivative = null): array
    {
        @mkdir("{$dir}/files/{$mediaId}", 0777, true);
        $out = [];
        if ($usageKeyOfDerivative === null) {
            foreach (StorefrontMedia::query()->findOrFail($mediaId)->variantList() as $v) {
                if (($v['kind'] ?? null) !== 'w') {
                    continue;
                }
                $key = "tenant/{$tenantId}/storefront-media/{$mediaId}/{$v['file']}";
                $this->assertArrayHasKey($key, $this->r2Objects, $key);
                file_put_contents("{$dir}/files/{$mediaId}/{$v['file']}", $this->r2Objects[$key]['body']);
                $out[] = ['width' => $v['width'], 'height' => $v['height'], 'format' => $v['format'], 'path' => "files/{$mediaId}/{$v['file']}"];
            }

            return $out;
        }
        foreach (StorefrontMediaDerivative::query()->where('media_id', $mediaId)->where('usage_key', $usageKeyOfDerivative)->where('state', 'ready')->get() as $row) {
            $key = "tenant/{$tenantId}/storefront-media/{$mediaId}/{$row->storage_key}";
            $this->assertArrayHasKey($key, $this->r2Objects, $key);
            file_put_contents("{$dir}/files/{$mediaId}/{$row->storage_key}", $this->r2Objects[$key]['body']);
            $out[] = ['width' => $row->rendered_width, 'height' => $row->rendered_height, 'format' => $row->format, 'path' => "files/{$mediaId}/{$row->storage_key}"];
        }

        return $out;
    }

    /** @param array<string,mixed> $background */
    private function verdict(array $background): array
    {
        $doc = (new StorefrontPresentationNormalizer)->normalize([
            'primaryColor' => '#12372a',
            'homepage' => ['sections' => [['id' => 'hero', 'type' => 'hero', 'visible' => true, 'design' => ['background' => $background]]]],
        ]);
        $codes = array_map(static fn (array $e): string => $e['code'], (new StorefrontPresentationPublishValidator)->errors($doc));

        return ['provable' => $codes === [], 'codes' => $codes, 'normalized' => $doc['homepage']['sections'][0]['design']['background'] ?? null];
    }

    /** @test */
    public function export_real_pipeline_evidence_for_the_browser_pixel_proof(): void
    {
        $dir = getenv('STOREFRONT_PIXEL_PROOF_DIR') ?: '';
        if ($dir === '') {
            $this->markTestSkipped('set STOREFRONT_PIXEL_PROOF_DIR to export the V6b-5 pixel-proof fixtures');
        }
        @mkdir($dir, 0777, true);

        $this->fakeStorefrontMediaR2();
        $auth = $this->registerTenant('px-proof', 'owner@px-proof.test');
        $this->seedMediaStorefront($auth['tenant_id']);
        $tenantId = $auth['tenant_id'];

        $ids = [];
        foreach (['dusk', 'snow', 'street', 'split'] as $kind) {
            $ids[$kind] = $this->uploadPhoto($auth['token'], $kind);
        }
        $ids['portrait'] = $this->uploadPhoto($auth['token'], 'portrait', 900, 1600);
        // أصلٌ بلا دليل (رُفع قبل V6b-1 مثلاً): الصورة سليمة لكن لا دليل ⇒ غير مُثبَت دائماً.
        $ids['nodata'] = $this->uploadPhoto($auth['token'], 'snow', 1500, 844);
        StorefrontMedia::query()->whereKey($ids['nodata'])->update(['region_luminance' => null]);

        // مشتقّ اقتصاص حقيقي (يسار 40٪ من "split" = الجزء الداكن فقط؛ ومن "dusk" شريحة وسطى).
        $crops = [
            'split-left' => ['mediaId' => $ids['split'], 'crop' => ['x' => 0, 'y' => 0, 'w' => 0.4, 'h' => 1, 'aspect' => '1:1', 'zoom' => 1]],
            'dusk-mid' => ['mediaId' => $ids['dusk'], 'crop' => ['x' => 0.25, 'y' => 0.1, 'w' => 0.5, 'h' => 0.5, 'aspect' => '16:9', 'zoom' => 1]],
        ];
        foreach ($crops as $ref) {
            $this->withToken($auth['token'])->postJson(self::BASE.'/'.$ref['mediaId'].'/derivatives', ['transform' => ['crop' => $ref['crop']]])->assertOk();
        }

        app(TenantContext::class)->set($tenantId);
        $evidence = app(StorefrontMediaContrastEvidence::class);

        $overlays = [
            'none' => null,
            'black-40' => ['color' => ['hex' => '#000000'], 'alpha' => 40],
            'black-70' => ['color' => ['hex' => '#000000'], 'alpha' => 70],
            'white-60' => ['color' => ['hex' => '#ffffff'], 'alpha' => 60],
            'role-50' => ['alpha' => 50],
        ];

        $media = [];
        $cases = [];
        $files = fn (string $id): array => $media[$id] ??= $this->exportFiles($dir, $tenantId, $id);
        $usageFiles = [];

        foreach (['dusk', 'snow', 'street', 'split'] as $kind) {
            $ref = ['mediaId' => $ids[$kind]];
            foreach ($overlays as $oname => $overlay) {
                $bg = ['kind' => 'media', 'media' => $ref] + ($overlay ? ['overlay' => $overlay] : []);
                $cases[] = ['id' => "{$kind}/{$oname}", 'kind' => $kind, 'overlay' => $oname, 'background' => $bg, 'bounds' => ['media' => $evidence->boundsFor($ref), 'mobile' => null], 'files' => ['media' => $files($ids[$kind]), 'mobile' => null]] + $this->verdict($bg);
            }
        }
        // مع صورة هاتف (portrait) — تُحكَم الصورتان معاً.
        foreach (['dusk', 'split'] as $kind) {
            $bg = ['kind' => 'media', 'media' => ['mediaId' => $ids[$kind]], 'mobile' => ['mediaId' => $ids['portrait']], 'overlay' => ['color' => ['hex' => '#000000'], 'alpha' => 70]];
            $cases[] = ['id' => "{$kind}+portrait/black-70", 'kind' => $kind, 'overlay' => 'black-70', 'background' => $bg, 'bounds' => ['media' => $evidence->boundsFor($bg['media']), 'mobile' => $evidence->boundsFor($bg['mobile'])], 'files' => ['media' => $files($ids[$kind]), 'mobile' => $files($ids['portrait'])]] + $this->verdict($bg);
        }
        // لا دليل: وحيدةً، ثم كصورة هاتف بجوار صورة افتراضية مُثبَتة (الصورتان تُحكَمان معاً ⇒ غير مُثبَت).
        $bg = ['kind' => 'media', 'media' => ['mediaId' => $ids['nodata']], 'overlay' => $overlays['black-70']];
        $cases[] = ['id' => 'nodata/black-70', 'kind' => 'nodata', 'overlay' => 'black-70', 'background' => $bg, 'bounds' => ['media' => $evidence->boundsFor($bg['media']), 'mobile' => null], 'files' => ['media' => $files($ids['nodata']), 'mobile' => null]] + $this->verdict($bg);
        $bg = ['kind' => 'media', 'media' => ['mediaId' => $ids['dusk']], 'mobile' => ['mediaId' => $ids['nodata']], 'overlay' => $overlays['black-70']];
        $cases[] = ['id' => 'dusk+nodata/black-70', 'kind' => 'dusk', 'overlay' => 'black-70', 'background' => $bg, 'bounds' => ['media' => $evidence->boundsFor($bg['media']), 'mobile' => $evidence->boundsFor($bg['mobile'])], 'files' => ['media' => $files($ids['dusk']), 'mobile' => $files($ids['nodata'])]] + $this->verdict($bg);
        // إطار مؤطَّر: الملفات المرسومة هي ملفات المشتقّ، والدليل من المشتقّ.
        foreach ($crops as $cname => $ref) {
            $usage = StorefrontMediaDerivative::query()->where('media_id', $ref['mediaId'])->value('usage_key');
            foreach (['none' => null, 'black-70' => $overlays['black-70']] as $oname => $overlay) {
                $bg = ['kind' => 'media', 'media' => $ref] + ($overlay ? ['overlay' => $overlay] : []);
                $cases[] = ['id' => "{$cname}/{$oname}", 'kind' => $cname, 'overlay' => $oname, 'background' => $bg, 'bounds' => ['media' => $evidence->boundsFor($ref), 'mobile' => null], 'files' => ['media' => $usageFiles[$cname] ??= $this->exportFiles($dir, $tenantId, $ref['mediaId'], $usage), 'mobile' => null]] + $this->verdict($bg);
            }
        }

        file_put_contents("{$dir}/manifest.json", json_encode(['cases' => $cases], JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES));
        app(TenantContext::class)->forget();

        $this->assertNotEmpty($cases);
        $provable = array_filter($cases, static fn (array $c): bool => $c['provable']);
        $this->assertNotEmpty($provable, 'some configurations must be provable');
        $this->assertLessThan(count($cases), count($provable), 'some configurations must be rejected (the proof needs both sides)');
    }
}
