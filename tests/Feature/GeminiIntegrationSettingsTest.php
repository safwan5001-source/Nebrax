<?php

namespace Tests\Feature;

use App\Models\PlatformAdministrator;
use App\Models\PlatformIntegrationSetting;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\Client\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

class GeminiIntegrationSettingsTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    private const GEMINI_SECRET = 'gemini-test-secret-abcd';

    /** @test */
    public function google_gemini_settings_survive_reload_without_exposing_the_api_key(): void
    {
        [, $token] = $this->platformToken(['platform:read', 'platform:manage']);
        $payload = $this->documentAiPayload([
            'enabled' => true,
            'model' => 'gemini-2.5-flash',
            'api_key' => self::GEMINI_SECRET,
            'allow_document_sending' => true,
        ]);

        $this->withToken($token)->putJson('/api/platform/integrations/document_ai', $payload)
            ->assertOk();

        $reload = $this->withToken($token)->getJson('/api/platform/integrations')->assertOk();
        $gemini = $this->geminiFrom($reload->json());

        $this->assertTrue($gemini['enabled']);
        $this->assertSame('gemini-2.5-flash', $gemini['model']);
        $this->assertTrue($gemini['allow_document_sending']);
        $this->assertTrue($gemini['has_api_key']);
        $this->assertSame('••••••••abcd', $gemini['api_key_masked']);
        $reload->assertJsonMissing([self::GEMINI_SECRET]);
        $this->assertArrayNotHasKey('api_key', $gemini);

        $raw = (string) DB::table('platform_integration_settings')->where('integration_key', 'document_ai')->value('configuration');
        $this->assertStringNotContainsString(self::GEMINI_SECRET, $raw);

        $stored = PlatformIntegrationSetting::where('integration_key', 'document_ai')->firstOrFail();
        $this->assertSame(self::GEMINI_SECRET, $stored->configuration['providers']['google_gemini']['api_key']);
    }

    /** @test */
    public function omitting_the_gemini_api_key_retains_the_stored_secret(): void
    {
        [, $token] = $this->platformToken(['platform:read', 'platform:manage']);
        $this->withToken($token)->putJson('/api/platform/integrations/document_ai', $this->documentAiPayload([
            'enabled' => true,
            'model' => 'gemini-2.5-flash',
            'api_key' => self::GEMINI_SECRET,
            'allow_document_sending' => true,
        ]))->assertOk();

        $next = $this->documentAiPayload([
            'enabled' => true,
            'model' => 'gemini-2.5-flash',
            'allow_document_sending' => true,
        ]);
        unset($next['providers']['google_gemini']['api_key']);

        $this->withToken($token)->putJson('/api/platform/integrations/document_ai', $next)->assertOk();

        $stored = PlatformIntegrationSetting::where('integration_key', 'document_ai')->firstOrFail();
        $this->assertSame(self::GEMINI_SECRET, $stored->configuration['providers']['google_gemini']['api_key']);
        $this->assertSame('gemini-2.5-flash', $stored->configuration['providers']['google_gemini']['model']);
    }

    /** @test */
    public function explicit_clear_removes_only_the_gemini_api_key(): void
    {
        [, $token] = $this->platformToken(['platform:read', 'platform:manage']);
        $this->withToken($token)->putJson('/api/platform/integrations/document_ai', $this->documentAiPayload([
            'enabled' => true,
            'model' => 'gemini-2.5-flash',
            'api_key' => self::GEMINI_SECRET,
            'allow_document_sending' => true,
        ], 'OPENAI-KEEP-SECRET', 'ANTHROPIC-KEEP-SECRET'))->assertOk();

        $payload = $this->documentAiPayload([
            'enabled' => true,
            'model' => 'gemini-2.5-flash',
            'clear_api_key' => true,
            'allow_document_sending' => true,
        ], 'OPENAI-KEEP-SECRET', 'ANTHROPIC-KEEP-SECRET');

        $response = $this->withToken($token)->putJson('/api/platform/integrations/document_ai', $payload)->assertOk();
        $gemini = $this->geminiFrom($response->json());
        $this->assertArrayNotHasKey('has_api_key', $gemini);
        $response->assertJsonMissing([self::GEMINI_SECRET, 'OPENAI-KEEP-SECRET', 'ANTHROPIC-KEEP-SECRET']);

        $stored = PlatformIntegrationSetting::where('integration_key', 'document_ai')->firstOrFail();
        $this->assertSame('', $stored->configuration['providers']['google_gemini']['api_key']);
        $this->assertSame('OPENAI-KEEP-SECRET', $stored->configuration['providers']['openai']['api_key']);
        $this->assertSame('ANTHROPIC-KEEP-SECRET', $stored->configuration['providers']['anthropic']['api_key']);
        $this->assertTrue($stored->configuration['providers']['google_gemini']['enabled']);
        $this->assertSame('gemini-2.5-flash', $stored->configuration['providers']['google_gemini']['model']);
    }

    /** @test */
    public function connection_test_uses_persisted_gemini_configuration_and_ignores_unsaved_body_fields(): void
    {
        config()->set('document_center.ai.provider_network_enabled', true);
        [, $token] = $this->platformToken(['platform:read', 'platform:manage']);
        $this->withToken($token)->putJson('/api/platform/integrations/document_ai', $this->documentAiPayload([
            'enabled' => true,
            'model' => 'gemini-2.5-flash',
            'api_key' => self::GEMINI_SECRET,
            'allow_document_sending' => true,
        ]))->assertOk();

        Http::fake([
            'generativelanguage.googleapis.com/*' => Http::response([
                'candidates' => [['content' => ['parts' => [['text' => 'OK']]]]],
            ]),
        ]);

        $this->withToken($token)->postJson('/api/platform/integrations/document_ai/test', [
            'provider' => 'google_gemini',
            'model' => 'gemini-unsaved-should-not-be-used',
            'api_key' => 'unsaved-gemini-key-must-not-be-sent',
            'enabled' => false,
        ])->assertOk()->assertJsonPath('data.ok', true);

        $expectedUrl = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';
        Http::assertSent(function (Request $request) use ($expectedUrl): bool {
            return $request->url() === $expectedUrl
                && $request->hasHeader('x-goog-api-key', self::GEMINI_SECRET)
                && ! str_contains($request->url(), self::GEMINI_SECRET)
                && ! str_contains($request->url(), 'unsaved-gemini-key-must-not-be-sent')
                && parse_url($request->url(), PHP_URL_QUERY) === null;
        });
        Http::assertNotSent(function (Request $request): bool {
            return str_contains($request->url(), 'gemini-unsaved-should-not-be-used')
                || $request->hasHeader('x-goog-api-key', 'unsaved-gemini-key-must-not-be-sent');
        });

        $reload = $this->withToken($token)->getJson('/api/platform/integrations')->assertOk();
        $gemini = $this->geminiFrom($reload->json());
        $this->assertTrue($gemini['enabled']);
        $this->assertSame('gemini-2.5-flash', $gemini['model']);
        $this->assertTrue($gemini['allow_document_sending']);
        $this->assertTrue($gemini['has_api_key']);
        $this->assertSame('passed', $gemini['last_test_status']);
        $reload->assertJsonMissing([self::GEMINI_SECRET, 'unsaved-gemini-key-must-not-be-sent']);
    }

    /** @test */
    public function a_failed_gemini_connection_test_does_not_erase_saved_configuration(): void
    {
        config()->set('document_center.ai.provider_network_enabled', true);
        [, $token] = $this->platformToken(['platform:read', 'platform:manage']);
        $this->withToken($token)->putJson('/api/platform/integrations/document_ai', $this->documentAiPayload([
            'enabled' => true,
            'model' => 'gemini-2.5-flash',
            'api_key' => self::GEMINI_SECRET,
            'allow_document_sending' => true,
            'connection_timeout_seconds' => 20,
            'max_attempts' => 3,
        ]))->assertOk();

        Http::fake([
            'generativelanguage.googleapis.com/*' => Http::response(['error' => ['message' => 'denied']], 401),
        ]);

        $this->withToken($token)->postJson('/api/platform/integrations/document_ai/test', [
            'provider' => 'google_gemini',
        ])->assertOk()->assertJsonPath('data.ok', false);

        $stored = PlatformIntegrationSetting::where('integration_key', 'document_ai')->firstOrFail();
        $gemini = $stored->configuration['providers']['google_gemini'];
        $this->assertTrue($gemini['enabled']);
        $this->assertSame('gemini-2.5-flash', $gemini['model']);
        $this->assertTrue($gemini['allow_document_sending']);
        $this->assertSame(self::GEMINI_SECRET, $gemini['api_key']);
        $this->assertSame(20, $gemini['connection_timeout_seconds']);
        $this->assertSame(3, $gemini['max_attempts']);
        $this->assertSame('failed', $gemini['last_test_status']);

        $reload = $this->withToken($token)->getJson('/api/platform/integrations')->assertOk();
        $public = $this->geminiFrom($reload->json());
        $this->assertTrue($public['enabled']);
        $this->assertSame('gemini-2.5-flash', $public['model']);
        $this->assertTrue($public['has_api_key']);
        $this->assertSame('failed', $public['last_test_status']);
        $reload->assertJsonMissing([self::GEMINI_SECRET]);
    }

    /** @test */
    public function tenant_users_and_read_only_platform_tokens_cannot_change_or_test_gemini(): void
    {
        [, $readToken] = $this->platformToken(['platform:read']);
        $payload = $this->documentAiPayload([
            'enabled' => true,
            'model' => 'gemini-2.5-flash',
            'api_key' => self::GEMINI_SECRET,
            'allow_document_sending' => true,
        ]);

        $this->withToken($readToken)->getJson('/api/platform/integrations')->assertOk();
        $this->withToken($readToken)->putJson('/api/platform/integrations/document_ai', $payload)->assertForbidden();
        $this->withToken($readToken)->postJson('/api/platform/integrations/document_ai/test', [
            'provider' => 'google_gemini',
        ])->assertForbidden();

        $tenant = $this->registerTenant('gemini-integrations-denied', 'owner@gemini-denied.test');
        $this->withToken($tenant['token'])->getJson('/api/platform/integrations')->assertForbidden();
        $this->withToken($tenant['token'])->putJson('/api/platform/integrations/document_ai', $payload)->assertForbidden();
        $this->withToken($tenant['token'])->postJson('/api/platform/integrations/document_ai/test', [
            'provider' => 'google_gemini',
        ])->assertForbidden();

        $this->assertDatabaseCount('platform_integration_settings', 0);
    }

    /** @return array<string, mixed> */
    private function geminiFrom(array $body): array
    {
        foreach ($body['data']['integrations'] as $item) {
            if ($item['key'] === 'document_ai') {
                return $item['configuration']['providers']['google_gemini'];
            }
        }

        $this->fail('document_ai integration was missing from the overview.');
    }

    /** @param  array<string, mixed>  $gemini
     * @return array<string, mixed>
     */
    private function documentAiPayload(array $gemini, string $openAiKey = '', string $anthropicKey = ''): array
    {
        $provider = function (array $overrides) {
            return array_replace([
                'enabled' => false,
                'clear_api_key' => false,
                'model' => '',
                'connection_timeout_seconds' => 15,
                'processing_timeout_seconds' => 90,
                'max_attempts' => 2,
                'allow_document_sending' => false,
                'monthly_operation_limit' => null,
                'monthly_page_limit' => null,
                'data_region' => '',
                'retention_policy' => '',
            ], $overrides);
        };

        return [
            'enabled' => false,
            'provider' => null,
            'primary_provider' => null,
            'fallback_enabled' => false,
            'fallback_providers' => [],
            'confidence_threshold_percent' => 0,
            'default_language' => 'ar',
            'max_files_per_batch' => 10,
            'max_pages_per_file' => 100,
            'max_file_size_bytes' => 10485760,
            'test_mode' => true,
            'providers' => [
                'openai' => $provider(['model' => 'gpt-test', ...($openAiKey !== '' ? ['api_key' => $openAiKey] : [])]),
                'anthropic' => $provider(['model' => 'claude-test', ...($anthropicKey !== '' ? ['api_key' => $anthropicKey] : [])]),
                'google_gemini' => $provider($gemini),
            ],
            'current_password' => 'platform-password-123',
        ];
    }

    /** @return array{PlatformAdministrator,string} */
    private function platformToken(array $abilities): array
    {
        $administrator = PlatformAdministrator::create([
            'name' => 'مدير تكامل Gemini',
            'email' => 'gemini-integrations@nebrax.test',
            'password' => 'platform-password-123',
        ]);

        return [$administrator, $administrator->createToken('platform-console', $abilities)->plainTextToken];
    }
}
