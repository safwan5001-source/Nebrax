<?php

namespace Tests\Feature;

use App\Models\ZatcaCredential;
use App\Services\Accounting\ZatcaTransportCredentialResolver;
use App\Support\Settings;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use RuntimeException;
use Tests\TestCase;

class ZatcaTransportCredentialResolverTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    /** @test */
    public function it_resolves_only_a_valid_production_csid_in_the_active_environment(): void
    {
        $auth = $this->registerTenant('zatca-transport', 'zatca-transport@example.test');
        app(TenantContext::class)->set($auth['tenant_id']);
        Settings::put('zatca', ['active_environment' => 'simulation']);
        $this->credential('simulation', 'production', 'simulation-csid', 'simulation-secret');
        $this->credential('production', 'production', 'wrong-environment-csid', 'wrong-secret');

        $material = app(ZatcaTransportCredentialResolver::class)->resolve();

        $this->assertSame('simulation', $material->environment);
        $this->assertSame('simulation-csid', $material->csid);
        $this->assertSame('simulation-secret', $material->secret);
    }

    /** @test */
    public function a_compliance_csid_is_never_used_for_core_submission(): void
    {
        $auth = $this->registerTenant('zatca-compliance-transport', 'zatca-compliance-transport@example.test');
        app(TenantContext::class)->set($auth['tenant_id']);
        Settings::put('zatca', ['active_environment' => 'simulation']);
        $this->credential('simulation', 'compliance', 'compliance-csid', 'compliance-secret');

        $this->expectException(RuntimeException::class);
        $this->expectExceptionMessage('Production CSID');
        app(ZatcaTransportCredentialResolver::class)->resolve();
    }

    /** @test */
    public function missing_secret_or_expired_certificate_fails_closed(): void
    {
        $auth = $this->registerTenant('zatca-invalid-transport', 'zatca-invalid-transport@example.test');
        app(TenantContext::class)->set($auth['tenant_id']);
        Settings::put('zatca', ['active_environment' => 'production']);
        $credential = $this->credential('production', 'production', 'csid', '', now()->subMinute());

        try {
            app(ZatcaTransportCredentialResolver::class)->resolve();
            $this->fail('كان يجب رفض شهادة النقل المنتهية.');
        } catch (RuntimeException $exception) {
            $this->assertStringContainsString('منتهية', $exception->getMessage());
        }

        $credential->update(['expires_at' => now()->addDay()]);

        $this->expectException(RuntimeException::class);
        $this->expectExceptionMessage('Secret');
        app(ZatcaTransportCredentialResolver::class)->resolve();
    }

    private function credential(
        string $environment,
        string $stage,
        string $csid,
        string $secret,
        $expiresAt = null,
    ): ZatcaCredential {
        return ZatcaCredential::create([
            'environment' => $environment,
            'stage' => $stage,
            'status' => 'configured',
            'credentials' => [
                'binary_security_token' => $csid,
                'secret' => $secret,
            ],
            'certificate_fingerprint' => str_repeat('a', 64),
            'configured_at' => now(),
            'expires_at' => $expiresAt ?? now()->addDay(),
        ]);
    }
}
