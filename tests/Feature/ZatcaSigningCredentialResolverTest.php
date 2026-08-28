<?php

namespace Tests\Feature;

use App\Models\ZatcaCredential;
use App\Services\Accounting\ZatcaSigningCredentialResolver;
use App\Support\Settings;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use RuntimeException;
use Tests\TestCase;

class ZatcaSigningCredentialResolverTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    /** @test */
    public function active_environment_defaults_to_developer_and_persists_only_allowed_values(): void
    {
        $auth = $this->registerTenant('zatca-environment', 'zatca-environment@example.test');

        $this->withToken($auth['token'])->getJson('/api/zatca-settings')
            ->assertOk()
            ->assertJsonPath('data.active_environment', 'developer');

        $this->withToken($auth['token'])->putJson('/api/zatca-settings', [
            'active_environment' => 'simulation',
        ])->assertOk()->assertJsonPath('data.active_environment', 'simulation');

        $this->withToken($auth['token'])->putJson('/api/zatca-settings', [
            'active_environment' => 'unknown',
        ])->assertUnprocessable()->assertJsonValidationErrors('active_environment');

        app(TenantContext::class)->set($auth['tenant_id']);
        $this->assertSame('simulation', Settings::get('zatca', 'active_environment'));
    }

    /** @test */
    public function it_resolves_only_the_exact_active_environment_without_fallback(): void
    {
        $auth = $this->registerTenant('zatca-resolver', 'zatca-resolver@example.test');
        app(TenantContext::class)->set($auth['tenant_id']);
        $this->credential('production', 'production-key');

        try {
            app(ZatcaSigningCredentialResolver::class)->resolve();
            $this->fail('كان يجب ألا يستخدم محلّل ZATCA شهادة production بدلاً من developer.');
        } catch (RuntimeException $exception) {
            $this->assertStringContainsString('developer', $exception->getMessage());
        }

        $this->credential('developer', 'developer-key');
        $material = app(ZatcaSigningCredentialResolver::class)->resolve();

        $this->assertSame('developer', $material->environment);
        $this->assertSame('compliance', $material->stage);
        $this->assertSame('developer-key', $material->privateKey);
        $this->assertSame([base64_encode('developer-certificate')], $material->certificateChain);

        Settings::put('zatca', ['active_environment' => 'production']);
        $material = app(ZatcaSigningCredentialResolver::class)->resolve();
        $this->assertSame('production', $material->environment);
        $this->assertSame('production-key', $material->privateKey);
    }

    /** @test */
    public function it_fails_closed_outside_an_active_tenant_context(): void
    {
        $auth = $this->registerTenant('zatca-no-context', 'zatca-no-context@example.test');
        app(TenantContext::class)->set($auth['tenant_id']);
        $this->credential('developer', 'secret-that-must-not-leak');
        app(TenantContext::class)->forget();

        $this->expectException(RuntimeException::class);
        $this->expectExceptionMessage('سياق مستأجر نشط');
        app(ZatcaSigningCredentialResolver::class)->resolve();
    }

    /** @test */
    public function expired_or_incomplete_material_is_rejected_before_signing(): void
    {
        $auth = $this->registerTenant('zatca-readiness', 'zatca-readiness@example.test');
        app(TenantContext::class)->set($auth['tenant_id']);
        $expired = $this->credential('developer', 'key', now()->subMinute());

        try {
            app(ZatcaSigningCredentialResolver::class)->resolve();
            $this->fail('كان يجب رفض شهادة ZATCA المنتهية.');
        } catch (RuntimeException $exception) {
            $this->assertStringContainsString('منتهية', $exception->getMessage());
        }

        $expired->update([
            'expires_at' => now()->addDay(),
            'credentials' => ['private_key' => 'key', 'certificate_chain' => []],
        ]);

        $this->expectException(RuntimeException::class);
        $this->expectExceptionMessage('سلسلة شهادات');
        app(ZatcaSigningCredentialResolver::class)->resolve();
    }

    private function credential(string $environment, string $privateKey, $expiresAt = null): ZatcaCredential
    {
        return ZatcaCredential::create([
            'environment' => $environment,
            'stage' => $environment === 'production' ? 'production' : 'compliance',
            'status' => 'configured',
            'credentials' => [
                'private_key' => $privateKey,
                'certificate_chain' => [base64_encode($environment.'-certificate')],
            ],
            'certificate_fingerprint' => str_repeat('a', 64),
            'configured_at' => now(),
            'expires_at' => $expiresAt ?? now()->addDay(),
        ]);
    }
}
