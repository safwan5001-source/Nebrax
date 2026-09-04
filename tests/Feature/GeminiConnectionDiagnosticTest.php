<?php

namespace Tests\Feature;

use App\Models\PlatformAdministrator;
use App\Models\PlatformIntegrationSetting;
use App\Services\DocumentCenter\GeminiConnectionDiagnostic;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

class GeminiConnectionDiagnosticTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    private const GEMINI_SECRET = 'gemini-test-secret-abcd';

    /** @test */
    public function a_successful_gemini_connection_returns_a_null_error_code(): void
    {
        $token = $this->saveGemini();
        Http::fake([
            'generativelanguage.googleapis.com/*' => Http::response([
                'candidates' => [['content' => ['parts' => [['text' => 'OK']]]]],
            ]),
        ]);

        $response = $this->withToken($token)->postJson('/api/platform/integrations/document_ai/test', [
            'provider' => 'google_gemini',
        ])->assertOk()
            ->assertJsonPath('data.ok', true)
            ->assertJsonPath('data.error_code', null);

        $this->assertSame('نجح اختبار اتصال Google Gemini.', $response->json('data.message'));
        $this->assertArrayNotHasKey('http_status', $response->json('data'));
        $this->assertStringNotContainsString(self::GEMINI_SECRET, $response->getContent());

        $gemini = $this->storedGemini();
        $this->assertSame('passed', $gemini['last_test_status']);
        $this->assertNull($gemini['last_test_error_code']);
        $this->assertSame(self::GEMINI_SECRET, $gemini['api_key']);
    }

    /** @test */
    public function an_invalid_or_unauthenticated_gemini_key_is_classified_as_auth_failed(): void
    {
        $this->assertClassifiedFailure(
            Http::response($this->googleError('UNAUTHENTICATED', 401, 'API_KEY_INVALID'), 401),
            GeminiConnectionDiagnostic::AUTH_FAILED,
            401,
        );
    }

    /** @test */
    public function a_gemini_permission_denied_response_is_classified_separately_from_auth(): void
    {
        $this->assertClassifiedFailure(
            Http::response($this->googleError('PERMISSION_DENIED', 403), 403),
            GeminiConnectionDiagnostic::PERMISSION_DENIED,
            403,
        );
    }

    /** @test */
    public function a_missing_gemini_model_from_google_is_classified_as_unavailable(): void
    {
        $this->assertClassifiedFailure(
            Http::response($this->googleError('NOT_FOUND', 404), 404),
            GeminiConnectionDiagnostic::MODEL_UNAVAILABLE,
            404,
        );
    }

    /** @test */
    public function a_gemini_quota_or_rate_limit_is_classified_as_rate_limited(): void
    {
        $this->assertClassifiedFailure(
            Http::response($this->googleError('RESOURCE_EXHAUSTED', 429), 429),
            GeminiConnectionDiagnostic::RATE_LIMITED,
            429,
        );
    }

    /** @test */
    public function a_gemini_timeout_is_classified_without_forwarding_the_transport_message(): void
    {
        $token = $this->saveGemini();
        Http::fake(function () {
            throw new ConnectionException('cURL error 28: Operation timed out after 15000 milliseconds with 0 bytes received');
        });

        $response = $this->withToken($token)->postJson('/api/platform/integrations/document_ai/test', [
            'provider' => 'google_gemini',
        ])->assertOk()
            ->assertJsonPath('data.ok', false)
            ->assertJsonPath('data.error_code', GeminiConnectionDiagnostic::TIMEOUT);

        $this->assertSame(GeminiConnectionDiagnostic::message(GeminiConnectionDiagnostic::TIMEOUT), $response->json('data.message'));
        $this->assertStringNotContainsString('cURL', $response->getContent());
        $this->assertStringNotContainsString('timed out', strtolower($response->getContent()));
        $this->assertStringNotContainsString(self::GEMINI_SECRET, $response->getContent());
        $this->assertSame('failed', $this->storedGemini()['last_test_status']);
    }

    /** @test */
    public function a_gemini_network_failure_is_classified_as_upstream_unavailable(): void
    {
        $token = $this->saveGemini();
        Http::fake(function () {
            throw new ConnectionException('cURL error 7: Failed to connect to generativelanguage.googleapis.com port 443');
        });

        $response = $this->withToken($token)->postJson('/api/platform/integrations/document_ai/test', [
            'provider' => 'google_gemini',
        ])->assertOk()
            ->assertJsonPath('data.ok', false)
            ->assertJsonPath('data.error_code', GeminiConnectionDiagnostic::UPSTREAM_UNAVAILABLE);

        $this->assertStringNotContainsString('cURL', $response->getContent());
        $this->assertStringNotContainsString('generativelanguage.googleapis.com', $response->getContent());
        $this->assertStringNotContainsString(self::GEMINI_SECRET, $response->getContent());
    }

    /** @test */
    public function a_malformed_gemini_success_body_is_classified_as_invalid_response(): void
    {
        $this->assertClassifiedFailure(
            Http::response(['promptFeedback' => ['blockReason' => 'SAFETY']], 200),
            GeminiConnectionDiagnostic::INVALID_RESPONSE,
            200,
        );
    }

    /** @test */
    public function an_unknown_gemini_failure_falls_back_to_connection_failed(): void
    {
        $this->assertClassifiedFailure(
            Http::response($this->googleError('FAILED_PRECONDITION', 400), 400),
            GeminiConnectionDiagnostic::CONNECTION_FAILED,
            400,
        );
    }

    /** @test */
    public function a_missing_stored_gemini_key_is_classified_without_calling_google(): void
    {
        config()->set('document_center.ai.provider_network_enabled', true);
        [, $token] = $this->platformToken();
        $this->withToken($token)->putJson('/api/platform/integrations/document_ai', $this->documentAiPayload([
            'enabled' => true,
            'model' => 'gemini-2.5-flash',
            'allow_document_sending' => true,
        ]))->assertOk();
        Http::fake();

        $this->withToken($token)->postJson('/api/platform/integrations/document_ai/test', [
            'provider' => 'google_gemini',
        ])->assertOk()
            ->assertJsonPath('data.ok', false)
            ->assertJsonPath('data.error_code', GeminiConnectionDiagnostic::API_KEY_MISSING);

        Http::assertNothingSent();
    }

    /** @test */
    public function a_missing_gemini_model_is_classified_without_calling_google(): void
    {
        config()->set('document_center.ai.provider_network_enabled', true);
        [, $token] = $this->platformToken();
        $this->withToken($token)->putJson('/api/platform/integrations/document_ai', $this->documentAiPayload([
            'enabled' => true,
            'model' => '',
            'api_key' => self::GEMINI_SECRET,
            'allow_document_sending' => true,
        ]))->assertOk();
        Http::fake();

        $this->withToken($token)->postJson('/api/platform/integrations/document_ai/test', [
            'provider' => 'google_gemini',
        ])->assertOk()
            ->assertJsonPath('data.ok', false)
            ->assertJsonPath('data.error_code', GeminiConnectionDiagnostic::MODEL_MISSING);

        Http::assertNothingSent();
        $this->assertSame(self::GEMINI_SECRET, $this->storedGemini()['api_key']);
    }

    /** @test */
    public function a_disabled_provider_network_gate_is_classified_without_calling_google(): void
    {
        config()->set('document_center.ai.provider_network_enabled', false);
        [, $token] = $this->platformToken();
        $this->withToken($token)->putJson('/api/platform/integrations/document_ai', $this->documentAiPayload([
            'enabled' => true,
            'model' => 'gemini-2.5-flash',
            'api_key' => self::GEMINI_SECRET,
            'allow_document_sending' => true,
        ]))->assertOk();
        Http::fake();

        $this->withToken($token)->postJson('/api/platform/integrations/document_ai/test', [
            'provider' => 'google_gemini',
        ])->assertOk()
            ->assertJsonPath('data.ok', false)
            ->assertJsonPath('data.error_code', GeminiConnectionDiagnostic::NETWORK_DISABLED);

        Http::assertNothingSent();
        $this->assertSame(self::GEMINI_SECRET, $this->storedGemini()['api_key']);
    }

    /** @test */
    public function the_gemini_api_key_never_appears_in_the_test_response_or_safe_diagnostic(): void
    {
        $token = $this->saveGemini();
        Http::fake([
            'generativelanguage.googleapis.com/*' => Http::response($this->googleError(
                'UNAUTHENTICATED',
                401,
                'API_KEY_INVALID',
            ), 401),
        ]);

        $response = $this->withToken($token)->postJson('/api/platform/integrations/document_ai/test', [
            'provider' => 'google_gemini',
        ])->assertOk()->assertJsonPath('data.ok', false);

        $content = $response->getContent();
        $this->assertStringNotContainsString(self::GEMINI_SECRET, $content);
        $this->assertStringNotContainsString('x-goog-api-key', $content);
        $this->assertStringNotContainsString('API key not valid', $content);
        $this->assertSame(
            GeminiConnectionDiagnostic::message(GeminiConnectionDiagnostic::AUTH_FAILED),
            $response->json('data.message'),
        );
        $this->assertSame(GeminiConnectionDiagnostic::AUTH_FAILED, $response->json('data.error_code'));

        $stored = $this->storedGemini();
        $this->assertSame(self::GEMINI_SECRET, $stored['api_key']);
        $this->assertStringNotContainsString(self::GEMINI_SECRET, (string) $stored['last_test_message_safe']);
        $this->assertSame(GeminiConnectionDiagnostic::AUTH_FAILED, $stored['last_test_error_code']);

        $overview = $this->withToken($token)->getJson('/api/platform/integrations')->assertOk();
        $overview->assertJsonMissing([self::GEMINI_SECRET, 'API key not valid']);
        $this->assertStringNotContainsString(self::GEMINI_SECRET, $overview->getContent());
    }

    /** @test */
    public function a_failed_gemini_test_does_not_erase_stored_configuration(): void
    {
        $token = $this->saveGemini([
            'connection_timeout_seconds' => 20,
            'max_attempts' => 3,
        ]);
        Http::fake([
            'generativelanguage.googleapis.com/*' => Http::response($this->googleError('PERMISSION_DENIED', 403), 403),
        ]);

        $this->withToken($token)->postJson('/api/platform/integrations/document_ai/test', [
            'provider' => 'google_gemini',
        ])->assertOk()->assertJsonPath('data.error_code', GeminiConnectionDiagnostic::PERMISSION_DENIED);

        $gemini = $this->storedGemini();
        $this->assertTrue($gemini['enabled']);
        $this->assertSame('gemini-2.5-flash', $gemini['model']);
        $this->assertTrue($gemini['allow_document_sending']);
        $this->assertSame(self::GEMINI_SECRET, $gemini['api_key']);
        $this->assertSame(20, $gemini['connection_timeout_seconds']);
        $this->assertSame(3, $gemini['max_attempts']);
        $this->assertSame('failed', $gemini['last_test_status']);
        $this->assertSame(GeminiConnectionDiagnostic::PERMISSION_DENIED, $gemini['last_test_error_code']);
        $this->assertSame(403, $gemini['last_test_http_status']);

        $this->withToken($token)->putJson('/api/platform/integrations/document_ai', $this->documentAiPayload([
            'enabled' => true,
            'model' => 'gemini-2.5-flash',
            'allow_document_sending' => true,
            'connection_timeout_seconds' => 20,
            'max_attempts' => 3,
        ]))->assertOk();

        $preserved = $this->storedGemini();
        $this->assertSame(self::GEMINI_SECRET, $preserved['api_key']);
        $this->assertSame(GeminiConnectionDiagnostic::PERMISSION_DENIED, $preserved['last_test_error_code']);
        $this->assertSame(403, $preserved['last_test_http_status']);
        $this->assertSame('failed', $preserved['last_test_status']);
    }

    /** @test */
    public function only_platform_administrators_with_manage_can_run_the_gemini_connection_test(): void
    {
        [, $readToken] = $this->platformToken(['platform:read'], 'gemini-diagnostics-read@nebrax.test');
        $this->withToken($readToken)->postJson('/api/platform/integrations/document_ai/test', [
            'provider' => 'google_gemini',
        ])->assertForbidden();

        $tenant = $this->registerTenant('gemini-diagnostics-denied', 'owner@gemini-diagnostics-denied.test');
        $this->withToken($tenant['token'])->postJson('/api/platform/integrations/document_ai/test', [
            'provider' => 'google_gemini',
        ])->assertForbidden();
    }

    /** @test */
    public function openai_connection_tests_do_not_receive_the_gemini_diagnostic_contract(): void
    {
        config()->set('document_center.ai.provider_network_enabled', false);
        [, $token] = $this->platformToken();
        Http::fake();

        $response = $this->withToken($token)->postJson('/api/platform/integrations/document_ai/test', [
            'provider' => 'openai',
        ])->assertOk()->assertJsonPath('data.ok', false);

        $this->assertArrayNotHasKey('error_code', $response->json('data'));
        $this->assertArrayNotHasKey('http_status', $response->json('data'));
        Http::assertNothingSent();
    }

    private function assertClassifiedFailure(mixed $fakeResponse, string $code, int $httpStatus): void
    {
        $token = $this->saveGemini();
        Http::fake(['generativelanguage.googleapis.com/*' => $fakeResponse]);

        $response = $this->withToken($token)->postJson('/api/platform/integrations/document_ai/test', [
            'provider' => 'google_gemini',
        ])->assertOk()
            ->assertJsonPath('data.ok', false)
            ->assertJsonPath('data.error_code', $code)
            ->assertJsonPath('data.http_status', $httpStatus);

        $this->assertSame(GeminiConnectionDiagnostic::message($code), $response->json('data.message'));
        $this->assertStringNotContainsString(self::GEMINI_SECRET, $response->getContent());
        $this->assertStringNotContainsString('API key not valid', $response->getContent());

        $stored = $this->storedGemini();
        $this->assertSame('failed', $stored['last_test_status']);
        $this->assertSame($code, $stored['last_test_error_code']);
        $this->assertSame($httpStatus, $stored['last_test_http_status']);
        $this->assertSame(self::GEMINI_SECRET, $stored['api_key']);
        $this->assertStringNotContainsString(self::GEMINI_SECRET, (string) $stored['last_test_message_safe']);
    }

    /** @param  array<string, mixed>  $overrides */
    private function saveGemini(array $overrides = []): string
    {
        config()->set('document_center.ai.provider_network_enabled', true);
        [, $token] = $this->platformToken();
        $this->withToken($token)->putJson('/api/platform/integrations/document_ai', $this->documentAiPayload(array_replace([
            'enabled' => true,
            'model' => 'gemini-2.5-flash',
            'api_key' => self::GEMINI_SECRET,
            'allow_document_sending' => true,
        ], $overrides)))->assertOk();

        return $token;
    }

    /** @return array<string, mixed> */
    private function storedGemini(): array
    {
        $stored = PlatformIntegrationSetting::where('integration_key', 'document_ai')->firstOrFail();

        return $stored->configuration['providers']['google_gemini'];
    }

    /**
     * @return array<string, mixed>
     */
    private function googleError(string $status, int $code, ?string $reason = null): array
    {
        $error = [
            'code' => $code,
            'message' => 'API key not valid: '.self::GEMINI_SECRET,
            'status' => $status,
        ];
        if ($reason !== null) {
            $error['details'] = [[
                '@type' => 'type.googleapis.com/google.rpc.ErrorInfo',
                'reason' => $reason,
                'metadata' => ['api_key' => self::GEMINI_SECRET],
            ]];
        }

        return ['error' => $error];
    }

    /**
     * @param  array<string, mixed>  $gemini
     * @return array<string, mixed>
     */
    private function documentAiPayload(array $gemini): array
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
                'openai' => $provider(['model' => 'gpt-test']),
                'anthropic' => $provider(['model' => 'claude-test']),
                'google_gemini' => $provider($gemini),
            ],
            'current_password' => 'platform-password-123',
        ];
    }

    /** @param  list<string>  $abilities
     * @return array{PlatformAdministrator,string}
     */
    private function platformToken(array $abilities = ['platform:read', 'platform:manage'], string $email = 'gemini-diagnostics@nebrax.test'): array
    {
        $administrator = PlatformAdministrator::query()->where('email', $email)->first()
            ?? PlatformAdministrator::create([
                'name' => 'مدير تشخيص Gemini',
                'email' => $email,
                'password' => 'platform-password-123',
            ]);

        return [$administrator, $administrator->createToken('platform-console', $abilities)->plainTextToken];
    }
}
