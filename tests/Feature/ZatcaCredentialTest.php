<?php

namespace Tests\Feature;

use App\Models\ZatcaCredential;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

class ZatcaCredentialTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    private function payload(array $overrides = []): array
    {
        return array_replace([
            'stage' => 'compliance',
            'binary_security_token' => 'CCSID-BINARY-TOKEN-SECRET',
            'secret' => 'CCSID-BASIC-AUTH-SECRET',
            'private_key' => 'EC-PRIVATE-MATERIAL',
            'request_id' => 'request-123',
            'expires_at' => now()->addYear()->toIso8601String(),
            'current_password' => 'password123',
        ], $overrides);
    }

    /** @test */
    public function credentials_are_encrypted_and_only_safe_metadata_is_returned(): void
    {
        $auth = $this->registerTenant('zatca-credentials', 'credentials@example.test');

        $response = $this->withToken($auth['token'])
            ->putJson('/api/zatca-credentials/simulation', $this->payload())
            ->assertOk()
            ->assertJsonPath('data.environment', 'simulation')
            ->assertJsonPath('data.has_secret', true)
            ->assertJsonPath('data.has_private_key', true)
            ->assertJsonMissing(['CCSID-BINARY-TOKEN-SECRET', 'CCSID-BASIC-AUTH-SECRET', 'EC-PRIVATE-MATERIAL']);

        $raw = (string) DB::table('zatca_credentials')->value('credentials');
        $this->assertStringNotContainsString('CCSID-BINARY-TOKEN-SECRET', $raw);
        $this->assertStringNotContainsString('CCSID-BASIC-AUTH-SECRET', $raw);
        $this->assertStringNotContainsString('EC-PRIVATE-MATERIAL', $raw);
        $this->assertSame('CCSID-BASIC-AUTH-SECRET', ZatcaCredential::sole()->credentials['secret']);
        $this->assertSame(hash('sha256', 'CCSID-BINARY-TOKEN-SECRET'), $response['data']['certificate_fingerprint']);
    }

    /** @test */
    public function omitted_secrets_are_preserved_but_first_configuration_requires_them(): void
    {
        $auth = $this->registerTenant('zatca-preserve', 'preserve@example.test');
        $url = '/api/zatca-credentials/production';

        $this->withToken($auth['token'])->putJson($url, [
            'stage' => 'production', 'current_password' => 'password123',
        ])->assertUnprocessable()->assertJsonValidationErrors('binary_security_token');

        $this->withToken($auth['token'])->putJson($url, $this->payload([
            'stage' => 'production', 'binary_security_token' => 'PCSID-TOKEN',
            'secret' => 'PCSID-SECRET', 'private_key' => 'PCSID-PRIVATE-KEY',
        ]))->assertOk();

        $this->withToken($auth['token'])->putJson($url, [
            'stage' => 'production', 'current_password' => 'password123',
        ])->assertOk()->assertJsonPath('data.has_secret', true);

        $this->assertSame('PCSID-SECRET', ZatcaCredential::sole()->credentials['secret']);
    }

    /** @test */
    public function changing_credentials_requires_the_current_password(): void
    {
        $auth = $this->registerTenant('zatca-password', 'zatca-password@example.test');
        $this->withToken($auth['token'])
            ->putJson('/api/zatca-credentials/developer', $this->payload(['current_password' => 'wrong']))
            ->assertUnprocessable()->assertJsonValidationErrors('current_password');
        $this->assertDatabaseCount('zatca_credentials', 0);
    }

    /** @test */
    public function changing_csid_stage_requires_a_complete_new_credential_set(): void
    {
        $auth = $this->registerTenant('zatca-stage', 'zatca-stage@example.test');
        $url = '/api/zatca-credentials/simulation';

        $this->withToken($auth['token'])->putJson($url, $this->payload())->assertOk();

        $this->withToken($auth['token'])->putJson($url, [
            'stage' => 'production',
            'current_password' => 'password123',
        ])->assertUnprocessable()->assertJsonValidationErrors('binary_security_token');

        $this->withToken($auth['token'])->putJson($url, $this->payload([
            'stage' => 'production',
            'binary_security_token' => 'PCSID-NEW-TOKEN',
            'secret' => 'PCSID-NEW-SECRET',
            'private_key' => 'PCSID-NEW-PRIVATE-KEY',
        ]))->assertOk()->assertJsonPath('data.stage', 'production');

        $credentials = ZatcaCredential::sole()->credentials;
        $this->assertSame('PCSID-NEW-TOKEN', $credentials['binary_security_token']);
        $this->assertSame('PCSID-NEW-SECRET', $credentials['secret']);
    }

    /** @test */
    public function credential_lists_are_isolated_between_tenants(): void
    {
        $first = $this->registerTenant('zatca-first', 'zatca-first@example.test');
        $this->withToken($first['token'])
            ->putJson('/api/zatca-credentials/simulation', $this->payload())->assertOk();

        $second = $this->registerTenant('zatca-second', 'zatca-second@example.test');
        app(TenantContext::class)->set($second['tenant_id']);
        $this->withToken($second['token'])->getJson('/api/zatca-credentials')
            ->assertOk()->assertJsonCount(0, 'data');
        $this->withToken($first['token'])->getJson('/api/zatca-credentials')
            ->assertOk()->assertJsonCount(1, 'data');
    }

    /** @test */
    public function invalid_environment_and_stage_are_rejected(): void
    {
        $auth = $this->registerTenant('zatca-validation', 'zatca-validation@example.test');
        $this->withToken($auth['token'])
            ->putJson('/api/zatca-credentials/simulation', $this->payload(['stage' => 'invalid']))
            ->assertUnprocessable()->assertJsonValidationErrors('stage');
        $this->withToken($auth['token'])
            ->putJson('/api/zatca-credentials/unknown', $this->payload())->assertNotFound();
    }
}
