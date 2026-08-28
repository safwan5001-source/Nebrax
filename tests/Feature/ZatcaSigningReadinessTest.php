<?php

namespace Tests\Feature;

use App\Models\ZatcaCredential;
use App\Services\Accounting\ZatcaSigningReadiness;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

class ZatcaSigningReadinessTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    /** @test */
    public function settings_report_stable_blocker_codes_without_exposing_credential_details(): void
    {
        config()->set('zatca.signature_policy.identifier', null);
        config()->set('zatca.signature_policy.digest', null);
        $auth = $this->registerTenant('zatca-not-ready', 'zatca-not-ready@example.test');

        $this->withToken($auth['token'])->getJson('/api/zatca-settings')
            ->assertOk()
            ->assertJsonPath('meta.signing_readiness.ready', false)
            ->assertJsonPath('meta.signing_readiness.environment', 'developer')
            ->assertJsonPath('meta.signing_readiness.credential_stage', null)
            ->assertJsonPath('meta.signing_readiness.blockers.0', ZatcaSigningReadiness::CREDENTIAL_UNAVAILABLE)
            ->assertJsonPath('meta.signing_readiness.blockers.1', ZatcaSigningReadiness::SIGNATURE_POLICY_UNAVAILABLE)
            ->assertJsonMissingPath('meta.signing_readiness.private_key')
            ->assertJsonMissingPath('meta.signing_readiness.certificate_chain')
            ->assertJsonMissingPath('meta.signing_readiness.error');
    }

    /** @test */
    public function settings_report_ready_only_when_exact_credentials_and_policy_are_valid(): void
    {
        $digest = base64_encode(hash('sha256', 'pinned-policy', true));
        config()->set('zatca.signature_policy.identifier', 'https://zatca.gov.sa/policy.pdf');
        config()->set('zatca.signature_policy.digest', $digest);
        $auth = $this->registerTenant('zatca-ready', 'zatca-ready@example.test');
        app(TenantContext::class)->set($auth['tenant_id']);

        ZatcaCredential::create([
            'environment' => 'developer',
            'stage' => 'compliance',
            'status' => 'configured',
            'credentials' => [
                'private_key' => 'server-only-private-key',
                'certificate_chain' => [base64_encode('leaf-certificate')],
            ],
            'certificate_fingerprint' => str_repeat('a', 64),
            'configured_at' => now(),
            'expires_at' => now()->addDay(),
        ]);

        $response = $this->withToken($auth['token'])->getJson('/api/zatca-settings')
            ->assertOk()
            ->assertJsonPath('meta.signing_readiness.ready', true)
            ->assertJsonPath('meta.signing_readiness.environment', 'developer')
            ->assertJsonPath('meta.signing_readiness.credential_stage', 'compliance')
            ->assertJsonCount(0, 'meta.signing_readiness.blockers');

        $this->assertStringNotContainsString('server-only-private-key', $response->getContent());
        $this->assertStringNotContainsString('leaf-certificate', $response->getContent());
    }

    /** @test */
    public function damaged_encrypted_credentials_are_reported_as_a_stable_blocker(): void
    {
        $digest = base64_encode(hash('sha256', 'pinned-policy', true));
        config()->set('zatca.signature_policy.identifier', 'https://zatca.gov.sa/policy.pdf');
        config()->set('zatca.signature_policy.digest', $digest);
        $auth = $this->registerTenant('zatca-damaged-credential', 'zatca-damaged@example.test');
        app(TenantContext::class)->set($auth['tenant_id']);

        $credential = ZatcaCredential::create([
            'environment' => 'developer',
            'stage' => 'compliance',
            'status' => 'configured',
            'credentials' => [
                'private_key' => 'server-only-private-key',
                'certificate_chain' => [base64_encode('leaf-certificate')],
            ],
            'certificate_fingerprint' => str_repeat('b', 64),
            'configured_at' => now(),
            'expires_at' => now()->addDay(),
        ]);

        DB::table('zatca_credentials')->where('id', $credential->id)->update([
            'credentials' => 'damaged-ciphertext',
        ]);

        $this->withToken($auth['token'])->getJson('/api/zatca-settings')
            ->assertOk()
            ->assertJsonPath('meta.signing_readiness.ready', false)
            ->assertJsonPath('meta.signing_readiness.credential_stage', null)
            ->assertJsonPath('meta.signing_readiness.blockers.0', ZatcaSigningReadiness::CREDENTIAL_UNAVAILABLE)
            ->assertJsonCount(1, 'meta.signing_readiness.blockers')
            ->assertJsonMissingPath('meta.signing_readiness.error');
    }
}
