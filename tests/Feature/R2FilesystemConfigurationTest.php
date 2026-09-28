<?php

namespace Tests\Feature;

use Tests\TestCase;

class R2FilesystemConfigurationTest extends TestCase
{
    /** @test */
    public function r2_disk_maps_only_from_the_r2_environment_contract(): void
    {
        $environment = [
            'R2_ACCESS_KEY_ID' => 'placeholder-access-key',
            'R2_SECRET_ACCESS_KEY' => 'placeholder-secret-key',
            'R2_BUCKET' => 'placeholder-bucket',
            'R2_ENDPOINT' => 'https://placeholder.r2.cloudflarestorage.com',
            'R2_REGION' => 'auto',
        ];
        $previous = [];

        foreach ($environment as $key => $value) {
            $previous[$key] = getenv($key);
            putenv("{$key}={$value}");
        }

        try {
            $disks = require base_path('config/filesystems.php');
            $r2 = $disks['disks']['r2'];

            $this->assertSame('s3', $r2['driver']);
            $this->assertSame($environment['R2_ACCESS_KEY_ID'], $r2['key']);
            $this->assertSame($environment['R2_SECRET_ACCESS_KEY'], $r2['secret']);
            $this->assertSame($environment['R2_BUCKET'], $r2['bucket']);
            $this->assertSame($environment['R2_ENDPOINT'], $r2['endpoint']);
            $this->assertSame($environment['R2_REGION'], $r2['region']);
            $this->assertArrayNotHasKey('visibility', $r2);
            $this->assertFalse($r2['use_path_style_endpoint']);
        } finally {
            foreach ($previous as $key => $value) {
                putenv($value === false ? $key : "{$key}={$value}");
            }
        }
    }

    /** @test */
    public function existing_storage_contract_and_media_selection_remain_unchanged(): void
    {
        $previous = getenv('FILESYSTEM_DISK');
        putenv('FILESYSTEM_DISK=local');

        try {
            $disks = require base_path('config/filesystems.php');
            $this->assertSame('local', $disks['default']);
            $this->assertSame('local', $disks['disks']['local']['driver']);
            $this->assertSame('public', $disks['disks']['public']['visibility']);
            $this->assertSame('s3', $disks['disks']['s3']['driver']);
            $this->assertArrayNotHasKey('document', $disks['disks']);

            $documentCenter = require base_path('config/document_center.php');
            $this->assertFalse($documentCenter['storage']['persistent_enabled']);
            $this->assertSame('local', $documentCenter['storage']['disk']);

            $mediaService = file_get_contents(base_path('app/Services/ProductMediaService.php'));
            $this->assertIsString($mediaService);
            $this->assertStringContainsString("'disk' => 'document'", $mediaService);
            $this->assertStringNotContainsString("Storage::disk('r2')", $mediaService);
        } finally {
            putenv($previous === false ? 'FILESYSTEM_DISK' : "FILESYSTEM_DISK={$previous}");
        }
    }
}
