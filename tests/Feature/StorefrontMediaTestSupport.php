<?php

namespace Tests\Feature;

use App\Models\SalesChannel;
use App\Models\Storefront;
use App\Models\StorefrontPresentationVersion;
use App\Services\R2StorageService;
use App\Tenancy\TenantContext;
use Aws\Result;
use Aws\S3\S3ClientInterface;
use GuzzleHttp\Psr7\Utils;
use Illuminate\Http\UploadedFile;
use Mockery;
use Mockery\MockInterface;
use RuntimeException;

/**
 * CUST-HV V2a — أدوات اختبار وسائط المُخصِّص: R2 في الذاكرة (يلتقط كل
 * كتابة/حذف بمفتاحها الكامل)، وصور JPEG/PNG/WebP حقيقية بوسم اتجاه EXIF
 * اختياري، ونسخ مظهر تحمل مراجع `mediaId`.
 */
trait StorefrontMediaTestSupport
{
    /** @var array<string, array{body:string,type:?string}> */
    protected array $r2Objects = [];

    /** @var list<string> */
    protected array $r2Calls = [];

    /** عدد كتابات `putObject` القادمة التي تُرفض (لمحاكاة انقطاع التخزين). */
    protected int $r2FailNextPuts = 0;

    /** @var (\Closure(array<string,mixed>, int): void)|null يُستدعى قبل كل كتابة (1-مؤشَّرة)؛ يرمي ليحاكي فشلاً. */
    protected ?\Closure $r2PutHook = null;

    protected int $r2PutCount = 0;

    /** يرفض كل `deleteObject` (لمحاكاة انقطاع التخزين أثناء التطهير). */
    protected bool $r2FailDeletes = false;

    protected function fakeStorefrontMediaR2(bool $enabled = true): MockInterface
    {
        config()->set('filesystems.disks.r2', [
            'key' => 'placeholder-key',
            'secret' => 'placeholder-secret',
            'bucket' => 'awj-storefront-media-test',
            'endpoint' => 'https://placeholder.r2.cloudflarestorage.com',
            'region' => 'auto',
            'use_path_style_endpoint' => false,
        ]);
        config()->set('storefront_media.r2.enabled', $enabled);

        $this->r2Objects = [];
        $this->r2Calls = [];
        $this->r2PutHook = null;
        $this->r2PutCount = 0;

        $client = Mockery::mock(S3ClientInterface::class);
        $client->shouldReceive('putObject')->andReturnUsing(function (array $args): Result {
            $this->r2Calls[] = 'put:'.$args['Key'];
            $this->r2PutCount++;
            if ($this->r2PutHook !== null) {
                ($this->r2PutHook)($args, $this->r2PutCount);
            }
            if ($this->r2FailNextPuts > 0) {
                $this->r2FailNextPuts--;
                throw new RuntimeException('simulated R2 outage');
            }
            $body = $args['Body'];
            $this->r2Objects[$args['Key']] = [
                'body' => is_resource($body) ? (string) stream_get_contents($body) : (string) $body,
                'type' => $args['ContentType'] ?? null,
                'args' => $args,
            ];

            return new Result([]);
        });
        $client->shouldReceive('getObject')->andReturnUsing(function (array $args): Result {
            $this->r2Calls[] = 'get:'.$args['Key'];
            if (! isset($this->r2Objects[$args['Key']])) {
                throw new RuntimeException('NoSuchKey');
            }

            return new Result(['Body' => Utils::streamFor($this->r2Objects[$args['Key']]['body'])]);
        });
        $client->shouldReceive('deleteObject')->andReturnUsing(function (array $args): Result {
            $this->r2Calls[] = 'delete:'.$args['Key'];
            if ($this->r2FailDeletes) {
                throw new RuntimeException('simulated R2 outage');
            }
            unset($this->r2Objects[$args['Key']]);

            return new Result([]);
        });
        // لا ACL ولا قوائم أبداً (نفس سقف R2StorageService).
        $client->shouldNotReceive('putObjectAcl');
        $client->shouldNotReceive('listObjects');
        $client->shouldNotReceive('listObjectsV2');

        $this->app->instance(R2StorageService::class, new R2StorageService(app(TenantContext::class), $client));

        return $client;
    }

    /** @return list<string> مفاتيح R2 تحت وسيطٍ بعينه (بلا الملف الأصلي إن طُلب). */
    protected function r2KeysFor(string $tenantId, string $mediaId): array
    {
        $prefix = "tenant/{$tenantId}/storefront-media/{$mediaId}/";

        return array_values(array_filter(array_keys($this->r2Objects), static fn (string $k): bool => str_starts_with($k, $prefix)));
    }

    /** @param array{left?:array{int,int,int},right?:array{int,int,int}} $colours */
    protected function jpegBytes(int $width, int $height, ?int $orientation = null, array $colours = []): string
    {
        $left = $colours['left'] ?? [220, 30, 30];
        $right = $colours['right'] ?? [30, 30, 220];

        $image = imagecreatetruecolor($width, $height);
        imagefilledrectangle($image, 0, 0, intdiv($width, 2) - 1, $height - 1, imagecolorallocate($image, ...$left));
        imagefilledrectangle($image, intdiv($width, 2), 0, $width - 1, $height - 1, imagecolorallocate($image, ...$right));

        ob_start();
        imagejpeg($image, null, 92);
        $jpeg = (string) ob_get_clean();

        return $orientation === null ? $jpeg : $this->withExifOrientation($jpeg, $orientation);
    }

    protected function withExifOrientation(string $jpeg, int $orientation, bool $bigEndian = false): string
    {
        $short = $bigEndian ? 'n' : 'v';
        $long = $bigEndian ? 'N' : 'V';
        $tiff = ($bigEndian ? 'MM' : 'II')
            .pack($short, 42).pack($long, 8)
            .pack($short, 1)
            .pack($short, 0x0112).pack($short, 3).pack($long, 1).pack($short, $orientation).pack($short, 0)
            .pack($long, 0);
        $payload = "Exif\0\0".$tiff;
        $segment = "\xFF\xE1".pack('n', strlen($payload) + 2).$payload;

        return substr($jpeg, 0, 2).$segment.substr($jpeg, 2);
    }

    protected function pngBytes(int $width, int $height, bool $alpha = false): string
    {
        $image = imagecreatetruecolor($width, $height);
        if ($alpha) {
            imagealphablending($image, false);
            imagesavealpha($image, true);
            imagefill($image, 0, 0, imagecolorallocatealpha($image, 0, 0, 0, 127));
            imagefilledrectangle($image, 0, 0, intdiv($width, 2), $height, imagecolorallocatealpha($image, 200, 40, 40, 0));
        } else {
            imagefill($image, 0, 0, imagecolorallocate($image, 40, 160, 80));
        }

        ob_start();
        imagepng($image);

        return (string) ob_get_clean();
    }

    protected function webpBytes(int $width, int $height): string
    {
        $image = imagecreatetruecolor($width, $height);
        imagefill($image, 0, 0, imagecolorallocate($image, 20, 120, 200));
        ob_start();
        imagewebp($image, null, 80);

        return (string) ob_get_clean();
    }

    protected function upload(string $bytes, string $name = 'photo.jpg'): UploadedFile
    {
        $path = tempnam(sys_get_temp_dir(), 'sfmt');
        file_put_contents($path, $bytes);

        return new UploadedFile($path, $name, null, null, true);
    }

    /** @return array{channel: SalesChannel, storefront: Storefront} */
    protected function seedMediaStorefront(string $tenantId, string $slug = 'main'): array
    {
        app(TenantContext::class)->set($tenantId);

        $channel = SalesChannel::query()->where('slug', 'web')->first()
            ?? SalesChannel::create(['slug' => 'web', 'name' => 'ويب', 'type' => SalesChannel::TYPE_WEB, 'is_active' => true]);

        $storefront = Storefront::create([
            'slug' => $slug,
            'name' => 'المتجر الرئيسي',
            'sales_channel_id' => $channel->id,
            'is_active' => true,
        ]);

        app(TenantContext::class)->forget();

        return compact('channel', 'storefront');
    }

    /** @param array<string,mixed> $config */
    protected function seedVersionWithConfig(string $tenantId, string $storefrontId, array $config, string $name = 'نسخة'): StorefrontPresentationVersion
    {
        app(TenantContext::class)->set($tenantId);
        $version = StorefrontPresentationVersion::create([
            'storefront_id' => $storefrontId,
            'name' => $name,
            'schema_version' => 3,
            'config' => $config,
        ]);
        app(TenantContext::class)->forget();

        return $version;
    }

    /** @return array<string,mixed> وثيقة تحمل `MediaRef` في موضعٍ متداخل. */
    protected function configReferencing(string $mediaId): array
    {
        return ['homepage' => ['sections' => [
            ['id' => 'hero-1', 'design' => ['background' => ['media' => ['mediaId' => $mediaId, 'fit' => 'cover']]]],
        ]]];
    }
}
