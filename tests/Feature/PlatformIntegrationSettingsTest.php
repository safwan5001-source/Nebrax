<?php

namespace Tests\Feature;

use App\Models\PlatformAdministrator;
use App\Models\PlatformIntegrationAuditEvent;
use App\Models\PlatformIntegrationSetting;
use App\Services\PlatformIntegrationResolver;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

class PlatformIntegrationSettingsTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    /** @test */
    public function a_platform_manager_can_store_encrypted_storage_secrets_without_receiving_them_back(): void
    {
        [$administrator, $token] = $this->platformToken(['platform:read', 'platform:manage']);

        $this->withToken($token)->putJson('/api/platform/integrations/document_storage', [
            'enabled' => true,
            'provider' => 'r2',
            'endpoint' => 'https://account.r2.cloudflarestorage.com',
            'bucket' => 'nebrax-private-documents',
            'region' => 'auto',
            'access_key_id' => 'R2-ACCESS-12345678',
            'secret_access_key' => 'R2-SUPER-SECRET-87654321',
            'use_path_style_endpoint' => true,
            'current_password' => 'platform-password-123',
        ])->assertOk()
            ->assertJsonPath('data.integrations.0.key', 'document_storage')
            ->assertJsonPath('data.integrations.0.configuration.has_access_key_id', true)
            ->assertJsonPath('data.integrations.0.configuration.has_secret_access_key', true)
            ->assertJsonMissing(['R2-SUPER-SECRET-87654321', 'R2-ACCESS-12345678']);

        $raw = (string) DB::table('platform_integration_settings')
            ->where('integration_key', 'document_storage')
            ->value('configuration');
        $this->assertStringNotContainsString('R2-SUPER-SECRET-87654321', $raw);
        $this->assertStringNotContainsString('R2-ACCESS-12345678', $raw);

        $setting = PlatformIntegrationSetting::where('integration_key', 'document_storage')->firstOrFail();
        $this->assertSame('R2-SUPER-SECRET-87654321', $setting->configuration['secret_access_key']);
        $this->assertSame($administrator->id, $setting->updated_by);

        $event = PlatformIntegrationAuditEvent::firstOrFail();
        $this->assertContains('secret_access_key', $event->changed_keys);
        $this->assertStringNotContainsString('SECRET', json_encode($event->toArray(), JSON_THROW_ON_ERROR));
    }

    /** @test */
    public function omitting_an_existing_secret_preserves_it_but_first_activation_requires_it(): void
    {
        [, $token] = $this->platformToken(['platform:read', 'platform:manage']);
        $base = [
            'enabled' => true,
            'provider' => 'r2',
            'endpoint' => 'https://account.r2.cloudflarestorage.com',
            'bucket' => 'private',
            'region' => 'auto',
            'use_path_style_endpoint' => true,
            'current_password' => 'platform-password-123',
        ];

        $this->withToken($token)->putJson('/api/platform/integrations/document_storage', $base)
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['access_key_id']);

        $this->withToken($token)->putJson('/api/platform/integrations/document_storage', $base + [
            'access_key_id' => 'access-1234',
            'secret_access_key' => 'secret-5678',
        ])->assertOk();

        $this->withToken($token)->putJson('/api/platform/integrations/document_storage', array_replace($base, [
            'bucket' => 'private-next',
        ]))->assertOk();

        $configuration = PlatformIntegrationSetting::where('integration_key', 'document_storage')
            ->firstOrFail()->configuration;
        $this->assertSame('secret-5678', $configuration['secret_access_key']);
        $this->assertSame('private-next', $configuration['bucket']);
    }

    /** @test */
    public function platform_read_tokens_and_tenant_users_cannot_change_integrations(): void
    {
        [, $readToken] = $this->platformToken(['platform:read']);
        $payload = [
            'enabled' => true,
            'provider' => 'redis',
            'max_attempts' => 3,
            'timeout_seconds' => 90,
            'backoff_seconds' => [30, 120],
            'current_password' => 'platform-password-123',
        ];

        $this->withToken($readToken)->getJson('/api/platform/integrations')->assertOk();
        $this->withToken($readToken)->putJson('/api/platform/integrations/document_processing', $payload)
            ->assertForbidden();

        $tenant = $this->registerTenant('platform-integrations-denied', 'owner@denied.test');
        $this->withToken($tenant['token'])->getJson('/api/platform/integrations')->assertForbidden();
        $this->withToken($tenant['token'])->putJson('/api/platform/integrations/document_processing', $payload)
            ->assertForbidden();
    }

    /** @test */
    public function processing_policy_is_validated_and_resolved_from_the_encrypted_platform_setting(): void
    {
        [, $token] = $this->platformToken(['platform:read', 'platform:manage']);

        $this->withToken($token)->putJson('/api/platform/integrations/document_processing', [
            'enabled' => true,
            'provider' => 'redis',
            'max_attempts' => 4,
            'timeout_seconds' => 75,
            'backoff_seconds' => [15, 60, 180],
            'current_password' => 'platform-password-123',
        ])->assertOk();

        $this->assertSame([
            'max_attempts' => 4,
            'timeout_seconds' => 75,
            'backoff_seconds' => [15, 60, 180],
        ], app(PlatformIntegrationResolver::class)->processingPolicy());

        $this->withToken($token)->putJson('/api/platform/integrations/document_processing', [
            'enabled' => true,
            'provider' => 'redis',
            'max_attempts' => 9,
            'timeout_seconds' => 75,
            'backoff_seconds' => [15],
            'current_password' => 'platform-password-123',
        ])->assertUnprocessable();
    }

    /** @test */
    public function changing_an_integration_requires_the_current_platform_administrator_password(): void
    {
        [, $token] = $this->platformToken(['platform:read', 'platform:manage']);

        $this->withToken($token)->putJson('/api/platform/integrations/document_processing', [
            'enabled' => true,
            'provider' => 'redis',
            'max_attempts' => 3,
            'timeout_seconds' => 90,
            'backoff_seconds' => [30, 120],
            'current_password' => 'incorrect-password',
        ])->assertUnprocessable()
            ->assertJsonValidationErrors(['current_password']);

        $this->assertDatabaseCount('platform_integration_settings', 0);
        $this->assertDatabaseCount('platform_integration_audit_events', 0);
    }

    /** @return array{PlatformAdministrator,string} */
    private function platformToken(array $abilities): array
    {
        $administrator = PlatformAdministrator::create([
            'name' => 'مدير تكاملات المنصة',
            'email' => 'integrations@nebrax.test',
            'password' => 'platform-password-123',
        ]);

        return [
            $administrator,
            $administrator->createToken('platform-console', $abilities)->plainTextToken,
        ];
    }
}
