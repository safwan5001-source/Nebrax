<?php

namespace Tests\Feature;

use App\Services\DocumentCenter\DocumentStorageService;
use Illuminate\Contracts\Filesystem\Filesystem;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Storage;
use Mockery;
use Tests\TestCase;

/**
 * AWJ-HORIZON-MEDIA-STORAGE S2 — Flysystem-S3 يُترجم `visibility` إلى `x-amz-acl`، وCloudflare R2
 * تُصنّفها غير مدعومة في PutObject. على endpoint من R2 لا نرسلها؛ سائر السائقين كما كانوا.
 *
 * تشغيل: php artisan test --filter=DocumentStorageR2CompatTest
 */
class DocumentStorageR2CompatTest extends TestCase
{
    use RefreshDatabase;

    private function durableS3(string $endpoint): void
    {
        config()->set('document_center.storage', array_merge(config('document_center.storage'), [
            'persistent_enabled' => true, 'driver' => 's3', 'key' => 'k', 'secret' => 's',
            'bucket' => 'b', 'endpoint' => $endpoint, 'region' => 'auto',
        ]));
    }

    /** @return array{0:array<string,mixed>,1:array<string,mixed>} [buildConfig, putOptions] */
    private function capture(): array
    {
        $captured = ['config' => null, 'options' => null];
        $fs = Mockery::mock(Filesystem::class);
        $fs->shouldReceive('put')->once()->andReturnUsing(function ($key, $contents, $options = []) use (&$captured) {
            $captured['options'] = $options;

            return true;
        });
        Storage::shouldReceive('build')->once()->andReturnUsing(function (array $config) use (&$captured, $fs) {
            $captured['config'] = $config;

            return $fs;
        });

        $stream = fopen('php://memory', 'r+');
        fwrite($stream, 'x');
        rewind($stream);
        app(DocumentStorageService::class)->put('platform', 'tenants/t/doc.pdf', $stream);
        fclose($stream);

        return [$captured['config'], $captured['options']];
    }

    /** @test */
    public function an_r2_endpoint_never_sends_visibility_or_acl(): void
    {
        $this->durableS3('https://0123456789abcdef.r2.cloudflarestorage.com');
        [$config, $options] = $this->capture();

        $this->assertArrayNotHasKey('visibility', $config);
        $this->assertSame([], $options);
    }

    /** @test */
    public function an_eu_jurisdiction_r2_endpoint_is_also_recognised(): void
    {
        $this->durableS3('https://0123456789abcdef.eu.r2.cloudflarestorage.com');
        [$config, $options] = $this->capture();

        $this->assertArrayNotHasKey('visibility', $config);
        $this->assertSame([], $options);
    }

    /** @test */
    public function a_non_r2_s3_endpoint_keeps_private_visibility_exactly_as_before(): void
    {
        $this->durableS3('https://s3.me-south-1.amazonaws.com');
        [$config, $options] = $this->capture();

        $this->assertSame('private', $config['visibility']);
        $this->assertSame(['visibility' => 'private'], $options);
    }

    /** @test */
    public function a_lookalike_host_is_not_treated_as_r2(): void
    {
        $this->durableS3('https://r2.cloudflarestorage.com.evil.example');
        [$config] = $this->capture();

        $this->assertSame('private', $config['visibility']);
    }

    /** @test */
    public function the_default_local_profile_still_writes_with_private_visibility(): void
    {
        Storage::fake('local');
        config()->set('document_center.storage.persistent_enabled', false);

        $stream = fopen('php://memory', 'r+');
        fwrite($stream, 'x');
        rewind($stream);
        $storage = app(DocumentStorageService::class);
        $storage->put('platform', 'tenants/t/local.pdf', $stream);
        fclose($stream);

        Storage::disk('local')->assertExists('tenants/t/local.pdf');
        $this->assertTrue($storage->exists('platform', 'tenants/t/local.pdf'));
    }
}
