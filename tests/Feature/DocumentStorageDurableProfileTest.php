<?php

namespace Tests\Feature;

use App\Models\PlatformIntegrationSetting;
use App\Services\DocumentCenter\DocumentStorageService;
use Illuminate\Contracts\Filesystem\Filesystem;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Storage;
use Mockery;
use RuntimeException;
use Tests\TestCase;

/**
 * AWJ-HORIZON-MEDIA-STORAGE S7 — (1) مستند كُتب على R2 يبقى مقروءاً بعد إغلاق قفل التشغيل، (2) الصفوف القديمة
 * (`platform`) تتبع القفل كما كانت، (3) زر «اختبار الاتصال» يفحص التكامل المحفوظ لا القرص المحلي.
 *
 * تشغيل: php artisan test --filter=DocumentStorageDurableProfileTest
 */
class DocumentStorageDurableProfileTest extends TestCase
{
    use RefreshDatabase;

    protected function tearDown(): void
    {
        Mockery::close();
        parent::tearDown();
    }

    private function integration(bool $enabled = true): void
    {
        PlatformIntegrationSetting::create([
            'integration_key' => 'document_storage', 'provider' => 'r2', 'enabled' => $enabled,
            'configuration' => [
                'endpoint' => 'https://0123456789abcdef.r2.cloudflarestorage.com', 'bucket' => 'awj-documents',
                'region' => 'auto', 'access_key_id' => 'AKIA-X', 'secret_access_key' => 'SECRET-X',
            ],
            'configured_at' => now(),
        ]);
    }

    /** @param array<string,string> $store */
    private function bucket(array &$store): void
    {
        $fs = Mockery::mock(Filesystem::class);
        $fs->shouldReceive('put')->andReturnUsing(function ($key, $contents) use (&$store) {
            $store[$key] = is_resource($contents) ? stream_get_contents($contents) : $contents;

            return true;
        });
        $fs->shouldReceive('exists')->andReturnUsing(function ($key) use (&$store) {
            return array_key_exists($key, $store);
        });
        $fs->shouldReceive('get')->andReturnUsing(function ($key) use (&$store) {
            return $store[$key] ?? null;
        });
        $fs->shouldReceive('readStream')->andReturnUsing(function ($key) use (&$store) {
            $h = fopen('php://memory', 'r+');
            fwrite($h, $store[$key] ?? '');
            rewind($h);

            return $h;
        });
        $fs->shouldReceive('delete')->andReturnUsing(function ($key) use (&$store) {
            unset($store[$key]);

            return true;
        });
        Storage::shouldReceive('build')->andReturn($fs);
    }

    private function open(): void
    {
        config()->set('document_center.storage.persistent_enabled', true);
    }

    private function close(): void
    {
        config()->set('document_center.storage.persistent_enabled', false);
        app()->forgetInstance(DocumentStorageService::class);
    }

    private function stream(string $body)
    {
        $h = fopen('php://memory', 'r+');
        fwrite($h, $body);
        rewind($h);

        return $h;
    }

    /** @test */
    public function the_write_profile_is_durable_only_when_the_lock_is_open_and_an_integration_is_active(): void
    {
        $storage = app(DocumentStorageService::class);
        $this->assertSame('platform', $storage->writeProfile(), 'lock closed, no integration');

        $this->integration();
        $this->assertSame('platform', $storage->writeProfile(), 'lock closed, integration saved');

        $this->open();
        $this->assertSame(DocumentStorageService::PROFILE_DURABLE, $storage->writeProfile());
    }

    /** @test */
    public function an_open_lock_without_an_active_integration_never_claims_the_durable_profile(): void
    {
        $this->open();
        $this->assertSame('platform', app(DocumentStorageService::class)->writeProfile());

        $this->integration(enabled: false);
        $this->assertSame('platform', app(DocumentStorageService::class)->writeProfile());
    }

    /** @test */
    public function a_document_written_to_r2_stays_readable_after_the_lock_is_closed(): void
    {
        $this->integration();
        $store = [];
        $this->bucket($store);
        $storage = app(DocumentStorageService::class);

        $this->open();
        $profile = $storage->writeProfile();
        $storage->put($profile, 'tenants/t/doc.pdf', $this->stream('PDF-BYTES'));
        $this->assertArrayHasKey('tenants/t/doc.pdf', $store);

        // التراجع: القفل يُغلق — الصف يحمل `platform-s3` فيبقى مقروءاً.
        $this->close();
        $storage = app(DocumentStorageService::class);
        $this->assertSame('local', $storage->effectiveDriver());
        $this->assertTrue($storage->exists($profile, 'tenants/t/doc.pdf'));
        $this->assertSame('PDF-BYTES', stream_get_contents($storage->readStream($profile, 'tenants/t/doc.pdf')));

        $storage->delete($profile, 'tenants/t/doc.pdf');
        $this->assertSame([], $store);
    }

    /** @test */
    public function a_durable_row_fails_loudly_when_the_integration_is_gone_instead_of_reading_local(): void
    {
        Storage::shouldReceive('build')->never();
        Storage::shouldReceive('disk')->never();

        $this->expectException(RuntimeException::class);
        $this->expectExceptionMessage('Document storage integration is unavailable.');
        app(DocumentStorageService::class)->exists(DocumentStorageService::PROFILE_DURABLE, 'tenants/t/doc.pdf');
    }

    /** @test */
    public function a_legacy_platform_row_still_follows_the_lock_exactly_as_before(): void
    {
        $this->integration();
        $store = ['tenants/t/legacy.pdf' => 'OLD'];
        $this->bucket($store);

        $this->open();
        $this->assertTrue(app(DocumentStorageService::class)->exists('platform', 'tenants/t/legacy.pdf'), 'lock open ⇒ S3');

        $this->close();
        Storage::fake('local');
        $this->assertFalse(app(DocumentStorageService::class)->exists('platform', 'tenants/t/legacy.pdf'), 'lock closed ⇒ local');
    }

    /** @test */
    public function an_unknown_profile_is_still_rejected(): void
    {
        $this->expectException(RuntimeException::class);
        $this->expectExceptionMessage('Unknown document storage profile.');
        app(DocumentStorageService::class)->exists('something-else', 'k');
    }

    /** @test */
    public function the_connection_test_checks_the_saved_integration_not_the_local_disk_while_the_lock_is_closed(): void
    {
        $this->integration();
        $store = [];
        $this->bucket($store);
        config()->set('document_center.storage.persistent_enabled', false);

        $this->assertTrue(app(DocumentStorageService::class)->healthCheck());
        $this->assertSame([], $store, 'the synthetic healthcheck object is removed');
    }

    /** @test */
    public function a_failing_saved_integration_makes_the_connection_test_fail_even_though_local_would_pass(): void
    {
        $this->integration();
        $fs = Mockery::mock(Filesystem::class);
        $fs->shouldReceive('put')->andThrow(new RuntimeException('r2 down'));
        $fs->shouldReceive('delete')->andReturn(true);
        $fs->shouldReceive('exists')->andReturn(false);
        Storage::shouldReceive('build')->andReturn($fs);
        config()->set('document_center.storage.persistent_enabled', false);

        $this->assertFalse(app(DocumentStorageService::class)->healthCheck());
    }

    /** @test */
    public function without_an_active_integration_the_connection_test_is_unchanged(): void
    {
        Storage::fake('local');
        config()->set('document_center.storage.persistent_enabled', false);

        $this->assertTrue(app(DocumentStorageService::class)->healthCheck());
    }
}
