<?php

namespace Tests\Feature;

use App\Models\PlatformIntegrationSetting;
use App\Services\DocumentCenter\DocumentStorageService;
use Illuminate\Contracts\Filesystem\Filesystem;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Storage;
use Mockery;
use Tests\TestCase;

/**
 * AWJ-HORIZON-MEDIA-STORAGE S6 — التحقق من إعداد R2 لمركز المستندات **قبل** فتح القفل
 * `DOCUMENT_DURABLE_STORAGE_ENABLED`، بلا تغيير في سلوك التشغيل العادي.
 *
 * تشغيل: php artisan test --filter=DocumentsStorageVerifyTest
 */
class DocumentsStorageVerifyTest extends TestCase
{
    use RefreshDatabase;

    private function integration(bool $enabled = true, array $overrides = []): void
    {
        PlatformIntegrationSetting::create([
            'integration_key' => 'document_storage',
            'provider' => 'r2',
            'enabled' => $enabled,
            'configuration' => array_merge([
                'endpoint' => 'https://0123456789abcdef.r2.cloudflarestorage.com',
                'bucket' => 'awj-test-bucket',
                'region' => 'auto',
                'access_key_id' => 'AKIA-SECRET-KEY-ID',
                'secret_access_key' => 'SUPER-SECRET-VALUE',
                'use_path_style_endpoint' => true,
            ], $overrides),
            'configured_at' => now(),
        ]);
    }

    /** @param array<string, mixed> $behaviour */
    private function fakeBucket(array &$store, array &$captured, array $behaviour = []): void
    {
        $fs = Mockery::mock(Filesystem::class);
        $fs->shouldReceive('put')->andReturnUsing(function ($key, $contents, $options = []) use (&$store, &$captured, $behaviour) {
            $captured['options'][] = $options;
            if (($behaviour['put'] ?? null) === 'throw') {
                throw new \RuntimeException('boom: SUPER-SECRET-VALUE');
            }
            $store[$key] = $contents;

            return true;
        });
        $fs->shouldReceive('exists')->andReturnUsing(function ($key) use (&$store) {
            return array_key_exists($key, $store);
        });
        $fs->shouldReceive('get')->andReturnUsing(function ($key) use (&$store, $behaviour) {
            return ($behaviour['corrupt'] ?? false) ? 'tampered' : ($store[$key] ?? null);
        });
        $fs->shouldReceive('delete')->andReturnUsing(function ($key) use (&$store) {
            unset($store[$key]);

            return true;
        });
        Storage::shouldReceive('build')->andReturnUsing(function (array $config) use (&$captured, $fs) {
            $captured['config'] = $config;

            return $fs;
        });
    }

    /** @test */
    public function it_proves_the_saved_configuration_while_the_runtime_lock_stays_closed(): void
    {
        $this->integration();
        config()->set('document_center.storage.persistent_enabled', false);
        $store = [];
        $captured = [];
        $this->fakeBucket($store, $captured);

        $report = app(DocumentStorageService::class)->verifyPlatformConfiguration();

        $this->assertTrue($report['ok']);
        $this->assertSame(['integration_enabled', 'configuration_valid', 'write', 'exists', 'content_intact', 'deleted'], array_keys($report['steps']));
        $this->assertSame([], $store, 'the synthetic object must be removed');
        $this->assertSame('s3', $captured['config']['driver']);
        $this->assertArrayNotHasKey('visibility', $captured['config'], 'R2 must not receive an ACL');
        $this->assertSame([[]], $captured['options']);
        $this->assertSame('0123456789abcdef.r2.cloudflarestorage.com', $report['endpoint_host']);

        // التشغيل العادي لم يتغيّر: القفل مغلق ⇒ القرص المحلي.
        $this->assertFalse(app(DocumentStorageService::class)->persistentEnabled());
        $this->assertSame('local', app(DocumentStorageService::class)->effectiveDriver());
    }

    /** @test */
    public function it_only_touches_the_healthchecks_prefix_never_tenant_data(): void
    {
        $this->integration();
        $store = [];
        $captured = [];
        $keys = [];
        $fs = Mockery::mock(Filesystem::class);
        $fs->shouldReceive('put')->andReturnUsing(function ($key, $contents) use (&$store, &$keys) {
            $keys[] = $key;
            $store[$key] = $contents;

            return true;
        });
        $fs->shouldReceive('exists')->andReturnUsing(function ($key) use (&$store, &$keys) {
            $keys[] = $key;

            return isset($store[$key]);
        });
        $fs->shouldReceive('get')->andReturnUsing(function ($key) use (&$store, &$keys) {
            $keys[] = $key;

            return $store[$key];
        });
        $fs->shouldReceive('delete')->andReturnUsing(function ($key) use (&$store, &$keys) {
            $keys[] = $key;
            unset($store[$key]);

            return true;
        });
        Storage::shouldReceive('build')->andReturn($fs);

        app(DocumentStorageService::class)->verifyPlatformConfiguration();

        $this->assertNotEmpty($keys);
        foreach ($keys as $key) {
            $this->assertStringStartsWith('healthchecks/verify-', $key);
        }
    }

    /** @test */
    public function a_missing_or_disabled_integration_fails_without_touching_storage(): void
    {
        Storage::shouldReceive('build')->never();

        $this->assertFalse(app(DocumentStorageService::class)->verifyPlatformConfiguration()['ok']);

        $this->integration(enabled: false);
        $report = app(DocumentStorageService::class)->verifyPlatformConfiguration();
        $this->assertFalse($report['ok']);
        $this->assertFalse($report['steps']['integration_enabled']);
    }

    /** @test */
    public function an_incomplete_configuration_names_the_missing_field_but_never_a_secret(): void
    {
        $this->integration(overrides: ['bucket' => '']);
        Storage::shouldReceive('build')->never();

        $report = app(DocumentStorageService::class)->verifyPlatformConfiguration();

        $this->assertFalse($report['ok']);
        $this->assertSame('Document storage setting is missing: bucket.', $report['steps']['configuration_valid']);
        $this->assertStringNotContainsString('SUPER-SECRET', json_encode($report));
    }

    /** @test */
    public function a_storage_failure_reports_the_exception_class_only_and_still_cleans_up(): void
    {
        $this->integration();
        $store = [];
        $captured = [];
        $this->fakeBucket($store, $captured, ['put' => 'throw']);

        $report = app(DocumentStorageService::class)->verifyPlatformConfiguration();

        $this->assertFalse($report['ok']);
        $this->assertSame('FAIL: RuntimeException', $report['steps']['write']);
        $this->assertStringNotContainsString('SUPER-SECRET', json_encode($report));
        $this->assertSame([], $store);
    }

    /** @test */
    public function corrupted_read_back_content_fails_the_verification(): void
    {
        $this->integration();
        $store = [];
        $captured = [];
        $this->fakeBucket($store, $captured, ['corrupt' => true]);

        $report = app(DocumentStorageService::class)->verifyPlatformConfiguration();

        $this->assertFalse($report['ok']);
        $this->assertFalse($report['steps']['content_intact']);
    }

    /** @test */
    public function the_artisan_command_prints_status_only_and_returns_the_verdict(): void
    {
        $this->integration();
        $store = [];
        $captured = [];
        $this->fakeBucket($store, $captured);

        $this->artisan('awj:documents-storage-verify')
            ->expectsOutputToContain('flag DOCUMENT_DURABLE_STORAGE_ENABLED: OFF')
            ->expectsOutputToContain('runtime driver now: local')
            ->expectsOutputToContain('content_intact: PASS')
            ->expectsOutputToContain('PASS: R2')
            ->doesntExpectOutputToContain('SUPER-SECRET')
            ->doesntExpectOutputToContain('AKIA-SECRET')
            ->assertExitCode(0);
    }

    /** @test */
    public function the_command_fails_loudly_when_the_integration_is_not_enabled(): void
    {
        $this->artisan('awj:documents-storage-verify')
            ->expectsOutputToContain('integration_enabled: FAIL')
            ->expectsOutputToContain('لا تفتح القفل')
            ->assertExitCode(1);
    }
}
