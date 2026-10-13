<?php

namespace Tests\Feature;

use App\Models\PlatformAdministrator;
use App\Models\PlatformIntegrationSetting;
use App\Services\DocumentCenter\DocumentStorageService;
use Illuminate\Contracts\Filesystem\Filesystem;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Log\Events\MessageLogged;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\Storage;
use Mockery;
use RuntimeException;
use Tests\TestCase;

/**
 * H15-10 — `POST /platform/integrations/document_storage/test` says WHAT it tested (`target`) and where documents are
 * stored NOW (`operational_storage`); the two are different things. All storage here is a local fake or an in-memory
 * mock: no external provider is contacted, no real key is used.
 *
 * تشغيل: php artisan test --filter=PlatformStorageTestTargetTest
 */
class PlatformStorageTestTargetTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    private const SECRET = 'H1510-SECRET-ACCESS-KEY';

    private const KEY_ID = 'H1510-KEY-ID';

    protected function tearDown(): void
    {
        Mockery::close();
        parent::tearDown();
    }

    private function saved(bool $enabled): void
    {
        PlatformIntegrationSetting::create([
            'integration_key' => 'document_storage', 'provider' => 'r2', 'enabled' => $enabled,
            'configuration' => [
                'endpoint' => 'https://0123456789abcdef.r2.cloudflarestorage.com', 'bucket' => 'awj-documents',
                'region' => 'auto', 'access_key_id' => self::KEY_ID, 'secret_access_key' => self::SECRET,
            ],
            'configured_at' => now(),
        ]);
    }

    private function lock(bool $open): void
    {
        config()->set('document_center.storage.persistent_enabled', $open);
        app()->forgetInstance(DocumentStorageService::class);
    }

    /** A local fake for `disk()` and a guard that the external builder is never used. */
    private function localOnly(): Filesystem
    {
        $disk = Storage::fake('local');
        Storage::shouldReceive('disk')->andReturn($disk);
        Storage::shouldReceive('build')->never();

        return $disk;
    }

    /** @param array<string,string> $store */
    private function bucket(array &$store, bool $failing = false): void
    {
        $fs = Mockery::mock(Filesystem::class);
        if ($failing) {
            $fs->shouldReceive('put')->andThrow(new RuntimeException('provider down'));
            $fs->shouldReceive('exists')->andReturn(false);
            $fs->shouldReceive('get')->andReturn(null);
            $fs->shouldReceive('delete')->andReturn(true);
        } else {
            $fs->shouldReceive('put')->andReturnUsing(function ($key, $contents) use (&$store) {
                $store[$key] = $contents;

                return true;
            });
            $fs->shouldReceive('exists')->andReturnUsing(function ($key) use (&$store) {
                return array_key_exists($key, $store);
            });
            $fs->shouldReceive('get')->andReturnUsing(function ($key) use (&$store) {
                return $store[$key] ?? null;
            });
            $fs->shouldReceive('delete')->andReturnUsing(function ($key) use (&$store) {
                unset($store[$key]);

                return true;
            });
        }
        Storage::shouldReceive('build')->andReturn($fs);
    }

    /** @return array{0: PlatformAdministrator, 1: string} */
    private function platformToken(array $abilities): array
    {
        $administrator = PlatformAdministrator::query()->firstOrCreate(
            ['email' => 'storage-test@nebrax.test'],
            ['name' => 'مدير اختبار التخزين', 'password' => 'platform-password-123'],
        );

        return [$administrator, $administrator->createToken('platform-console', $abilities)->plainTextToken];
    }

    private function callTest(): \Illuminate\Testing\TestResponse
    {
        [, $token] = $this->platformToken(['platform:read', 'platform:manage']);

        return $this->withToken($token)->postJson('/api/platform/integrations/document_storage/test');
    }

    /** @test */
    public function a_disabled_integration_with_saved_settings_reports_the_local_fallback_and_never_touches_the_provider(): void
    {
        $this->saved(false);
        $this->lock(false);
        $disk = $this->localOnly();

        $response = $this->callTest()->assertOk()
            ->assertJsonPath('data.ok', true) // the local test really passed
            ->assertJsonPath('data.target', 'local_fallback')
            ->assertJsonPath('data.operational_storage', 'local');

        $message = (string) $response->json('data.message');
        $this->assertStringContainsString('المحلي', $message);
        $this->assertStringContainsString('لم يُختبر المزود الخارجي', $message);
        $this->assertStringNotContainsString('تم الاتصال بالتخزين الخاص', $message, 'a local pass is not a provider connection');
        $this->assertSame([], $disk->allFiles(), 'the temporary healthcheck file is removed');
    }

    /** @test */
    public function with_no_saved_settings_the_target_is_the_local_fallback(): void
    {
        $this->lock(false);
        $disk = $this->localOnly();

        $this->callTest()->assertOk()
            ->assertJsonPath('data.ok', true)
            ->assertJsonPath('data.target', 'local_fallback')
            ->assertJsonPath('data.operational_storage', 'local');
        $this->assertSame([], $disk->allFiles());
    }

    /** @test */
    public function a_failing_local_test_is_reported_as_a_failure_of_the_local_fallback(): void
    {
        $this->lock(false);
        $fs = Mockery::mock(Filesystem::class);
        $fs->shouldReceive('put')->andReturn(false);
        $fs->shouldReceive('delete')->andReturn(true);
        Storage::shouldReceive('disk')->andReturn($fs);
        Storage::shouldReceive('build')->never();

        $this->callTest()->assertOk()
            ->assertJsonPath('data.ok', false)
            ->assertJsonPath('data.target', 'local_fallback');
    }

    /** @test */
    public function an_enabled_integration_that_connects_reports_the_saved_provider_and_cleans_up(): void
    {
        $this->saved(true);
        $this->lock(false);
        $store = [];
        $this->bucket($store);

        $this->callTest()->assertOk()
            ->assertJsonPath('data.ok', true)
            ->assertJsonPath('data.target', 'saved_provider')
            ->assertJsonPath('data.message', 'تم الاتصال بالتخزين الخاص والكتابة والحذف بنجاح.');
        $this->assertSame([], $store, 'the synthetic object is removed from the provider');
    }

    /** @test */
    public function an_enabled_integration_that_fails_reports_the_saved_provider_with_ok_false(): void
    {
        $this->saved(true);
        $this->lock(false);
        $store = [];
        $this->bucket($store, true);

        $this->callTest()->assertOk()
            ->assertJsonPath('data.ok', false)
            ->assertJsonPath('data.target', 'saved_provider')
            ->assertJsonPath('data.message', 'تعذر التحقق من التخزين الخاص.');
    }

    /** @test */
    public function the_tested_target_is_not_the_operational_storage_and_follows_the_lock_separately(): void
    {
        $this->saved(true);
        $store = [];
        $this->bucket($store);

        $this->lock(false); // provider tested, documents still on the local disk
        $this->callTest()->assertOk()->assertJsonPath('data.target', 'saved_provider')->assertJsonPath('data.operational_storage', 'local');

        $this->lock(true); // lock opened: documents really go to the provider
        $this->callTest()->assertOk()->assertJsonPath('data.target', 'saved_provider')->assertJsonPath('data.operational_storage', 'external');
    }

    /** @test */
    public function a_disabled_integration_stays_a_local_test_even_with_the_lock_open(): void
    {
        $this->saved(false);
        $this->lock(true);
        $this->localOnly();

        $this->callTest()->assertOk()
            ->assertJsonPath('data.target', 'local_fallback')
            ->assertJsonPath('data.operational_storage', 'local');
    }

    /** @test */
    public function a_storage_configured_in_the_environment_is_neither_the_saved_provider_nor_the_local_fallback(): void
    {
        config()->set('document_center.storage', array_replace(config('document_center.storage'), [
            'persistent_enabled' => true, 'driver' => 's3', 'key' => 'ENV-KEY', 'secret' => 'ENV-SECRET',
            'bucket' => 'env-bucket', 'endpoint' => 'https://env.example.test',
        ]));
        app()->forgetInstance(DocumentStorageService::class);
        $store = [];
        $this->bucket($store);

        $this->callTest()->assertOk()->assertJsonPath('data.target', 'environment_storage')->assertJsonPath('data.ok', true);
    }

    /** @test */
    public function the_response_keeps_ok_and_message_adds_only_the_two_descriptive_fields_and_leaks_no_secret(): void
    {
        $this->saved(true);
        $this->lock(false);
        $store = [];
        $this->bucket($store);
        $logged = [];
        Event::listen(MessageLogged::class, function (MessageLogged $event) use (&$logged) {
            $logged[] = $event->message.json_encode($event->context);
        });

        $response = $this->callTest()->assertOk();

        $this->assertEqualsCanonicalizing(['ok', 'message', 'target', 'operational_storage'], array_keys($response->json('data')));
        $this->assertIsBool($response->json('data.ok'));
        $this->assertIsString($response->json('data.message'));
        foreach ([self::SECRET, self::KEY_ID] as $secret) {
            $this->assertStringNotContainsString($secret, $response->getContent());
            $this->assertStringNotContainsString($secret, implode("\n", $logged));
        }
    }

    /** @test */
    public function the_service_method_used_by_other_callers_still_returns_a_plain_boolean(): void
    {
        $this->lock(false);
        Storage::fake('local');

        $this->assertTrue(app(DocumentStorageService::class)->healthCheck());
    }

    /** @test */
    public function a_read_only_platform_token_still_cannot_run_the_test(): void
    {
        [, $token] = $this->platformToken(['platform:read']);

        $this->withToken($token)->postJson('/api/platform/integrations/document_storage/test')->assertForbidden();
    }
}
