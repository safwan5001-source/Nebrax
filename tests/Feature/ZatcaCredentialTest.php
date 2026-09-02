<?php

namespace Tests\Feature;

use App\Models\User;
use App\Models\ZatcaCredential;
use App\Services\Accounting\ZatcaCredentialService;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;
use Tests\TestCase;

class ZatcaCredentialTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    private function payload(array $overrides = []): array
    {
        return array_replace([
            'stage' => 'compliance',
            ...$this->certificateMaterial(),
            'secret' => 'CCSID-BASIC-AUTH-SECRET',
            'request_id' => 'request-123',
            'current_password' => 'password123',
        ], $overrides);
    }

    /** @return array{certificate:\OpenSSLCertificate, private_key:\OpenSSLAsymmetricKey, path:string, config_path:string} */
    private function testAuthority(): array
    {
        static $authority = null;

        if ($authority === null) {
            $opensslConfig = <<<'CONF'
[ req ]
distinguished_name = req_distinguished_name
prompt = no
default_bits = 2048

[ req_distinguished_name ]
CN = Nebrax ZATCA Test

[ v3_ca ]
basicConstraints = critical, CA:true
keyUsage = critical, keyCertSign, cRLSign
subjectKeyIdentifier = hash
authorityKeyIdentifier = keyid:always, issuer

[ zatca_leaf ]
basicConstraints = critical, CA:false
keyUsage = critical, digitalSignature, keyEncipherment
extendedKeyUsage = clientAuth
subjectKeyIdentifier = hash
authorityKeyIdentifier = keyid, issuer

[ tls_only_leaf ]
basicConstraints = critical, CA:false
keyUsage = critical, keyEncipherment
extendedKeyUsage = serverAuth
subjectKeyIdentifier = hash
authorityKeyIdentifier = keyid, issuer

[ client_auth_prefix_leaf ]
basicConstraints = critical, CA:false
keyUsage = critical, digitalSignature
extendedKeyUsage = 1.3.6.1.5.5.7.3.20
subjectKeyIdentifier = hash
authorityKeyIdentifier = keyid, issuer

[ csid_ca_leaf ]
basicConstraints = critical, CA:true
keyUsage = critical, digitalSignature, keyCertSign
extendedKeyUsage = clientAuth
subjectKeyIdentifier = hash
authorityKeyIdentifier = keyid, issuer

[ self_signed_leaf ]
basicConstraints = critical, CA:false
keyUsage = critical, digitalSignature, keyEncipherment
extendedKeyUsage = clientAuth
subjectKeyIdentifier = hash
CONF;
            $configPath = tempnam(sys_get_temp_dir(), 'zatca-openssl-');
            $this->assertNotFalse($configPath);
            $this->assertNotFalse(file_put_contents($configPath, $opensslConfig));

            $key = openssl_pkey_new([
                'config' => $configPath,
                'private_key_type' => OPENSSL_KEYTYPE_EC,
                'curve_name' => 'secp256k1',
            ]);
            $this->assertNotFalse($key);

            $csr = openssl_csr_new(
                ['commonName' => 'Nebrax Test ZATCA Root'],
                $key,
                ['config' => $configPath, 'digest_alg' => 'sha256']
            );
            $this->assertNotFalse($csr);

            $certificate = openssl_csr_sign($csr, null, $key, 3650, [
                'config' => $configPath,
                'digest_alg' => 'sha256',
                'x509_extensions' => 'v3_ca',
            ]);
            $this->assertNotFalse($certificate);
            $this->assertTrue(openssl_x509_export($certificate, $certificatePem));

            $path = tempnam(sys_get_temp_dir(), 'zatca-test-ca-');
            $this->assertNotFalse($path);
            $this->assertNotFalse(file_put_contents($path, $certificatePem));

            $authority = [
                'certificate' => $certificate,
                'private_key' => $key,
                'path' => $path,
                'config_path' => $configPath,
            ];
        }

        config([
            'zatca.trust_anchors.developer' => $authority['path'],
            'zatca.trust_anchors.simulation' => $authority['path'],
            'zatca.trust_anchors.production' => $authority['path'],
        ]);

        return $authority;
    }

    /** @return array{binary_security_token:string, private_key:string, expires_at:string} */
    private function certificateMaterial(string $label = 'default', string $profile = 'zatca_leaf'): array
    {
        static $materials = [];
        $authority = $this->testAuthority();
        $cacheKey = "{$label}:{$profile}";

        if (isset($materials[$cacheKey])) {
            return $materials[$cacheKey];
        }

        $key = openssl_pkey_new([
            'config' => $authority['config_path'],
            'private_key_type' => OPENSSL_KEYTYPE_EC,
            'curve_name' => 'secp256k1',
        ]);
        $this->assertNotFalse($key);

        $csr = openssl_csr_new(
            ['commonName' => "Nebrax ZATCA {$label}"],
            $key,
            ['config' => $authority['config_path'], 'digest_alg' => 'sha256']
        );
        $this->assertNotFalse($csr);

        $certificate = openssl_csr_sign(
            $csr,
            $authority['certificate'],
            $authority['private_key'],
            365,
            [
                'config' => $authority['config_path'],
                'digest_alg' => 'sha256',
                'x509_extensions' => $profile,
            ],
            count($materials) + 100
        );
        $this->assertNotFalse($certificate);
        $this->assertTrue(openssl_pkey_export($key, $privateKey));
        $this->assertTrue(openssl_x509_export($certificate, $certificatePem));

        $token = (string) preg_replace(
            '/-----BEGIN CERTIFICATE-----|-----END CERTIFICATE-----|\\s+/',
            '',
            $certificatePem
        );
        $parsed = openssl_x509_parse($certificate, false);
        $this->assertIsArray($parsed);

        return $materials[$cacheKey] = [
            'binary_security_token' => $token,
            'private_key' => $privateKey,
            'expires_at' => gmdate('c', $parsed['validTo_time_t']),
        ];
    }

    private function certificateBody(\OpenSSLCertificate $certificate): string
    {
        $this->assertTrue(openssl_x509_export($certificate, $pem));

        return (string) preg_replace(
            '/-----BEGIN CERTIFICATE-----|-----END CERTIFICATE-----|\\s+/',
            '',
            $pem
        );
    }

    /** @return array{binary_security_token:string, private_key:string, expires_at:string} */
    private function untrustedCertificateMaterial(): array
    {
        $authority = $this->testAuthority();
        $key = openssl_pkey_new([
            'config' => $authority['config_path'],
            'private_key_type' => OPENSSL_KEYTYPE_EC,
            'curve_name' => 'secp256k1',
        ]);
        $this->assertNotFalse($key);
        $csr = openssl_csr_new(
            ['commonName' => 'Untrusted CSID'],
            $key,
            ['config' => $authority['config_path'], 'digest_alg' => 'sha256']
        );
        $this->assertNotFalse($csr);
        $certificate = openssl_csr_sign($csr, null, $key, 365, [
            'config' => $authority['config_path'],
            'digest_alg' => 'sha256',
            'x509_extensions' => 'self_signed_leaf',
        ]);
        $this->assertNotFalse($certificate);
        $this->assertTrue(openssl_pkey_export($key, $privateKey));
        $this->assertTrue(openssl_x509_export($certificate, $certificatePem));
        $parsed = openssl_x509_parse($certificate, false);
        $this->assertIsArray($parsed);

        return [
            'binary_security_token' => (string) preg_replace(
                '/-----BEGIN CERTIFICATE-----|-----END CERTIFICATE-----|\\s+/',
                '',
                $certificatePem
            ),
            'private_key' => $privateKey,
            'expires_at' => gmdate('c', $parsed['validTo_time_t']),
        ];
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

        $material = $this->certificateMaterial();
        $raw = (string) DB::table('zatca_credentials')->value('credentials');
        $this->assertStringNotContainsString($material['binary_security_token'], $raw);
        $this->assertStringNotContainsString('CCSID-BASIC-AUTH-SECRET', $raw);
        $this->assertStringNotContainsString($material['private_key'], $raw);

        $credential = ZatcaCredential::sole();
        $this->assertSame('CCSID-BASIC-AUTH-SECRET', $credential->credentials['secret']);
        $this->assertSame('secp256k1', $credential->credentials['curve_name']);
        $this->assertStringContainsString('BEGIN PUBLIC KEY', $credential->credentials['public_key']);
        $this->assertCount(2, $credential->credentials['certificate_chain']);
        $this->assertSame(
            $material['binary_security_token'],
            $credential->credentials['certificate_chain'][0]
        );
        $this->assertSame(
            $this->certificateBody($this->testAuthority()['certificate']),
            $credential->credentials['certificate_chain'][1]
        );
        $this->assertSame(64, strlen($response['data']['certificate_fingerprint']));
        $this->assertSame('secp256k1', $response['data']['public_key_curve']);
        $this->assertSame(2, $response['data']['certificate_chain_length']);
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
            'stage' => 'production',
            ...$this->certificateMaterial('production-initial'),
            'secret' => 'PCSID-SECRET',
        ]))->assertOk();

        $expiresAt = ZatcaCredential::sole()->expires_at;
        $this->withToken($auth['token'])->putJson($url, [
            'stage' => 'production', 'current_password' => 'password123',
        ])->assertOk()->assertJsonPath('data.has_secret', true);

        $credential = ZatcaCredential::sole();
        $this->assertSame('PCSID-SECRET', $credential->credentials['secret']);
        $this->assertTrue($credential->expires_at->equalTo($expiresAt));

        // شهادة جديدة بلا تاريخ لا ترث انتهاء الشهادة القديمة.
        $this->withToken($auth['token'])->putJson($url, [
            'stage' => 'production',
            'binary_security_token' => 'PCSID-PARTIAL-TOKEN',
            'current_password' => 'password123',
        ])->assertUnprocessable()->assertJsonValidationErrors('secret');

        $rotated = $this->certificateMaterial('production-rotated');
        $this->withToken($auth['token'])->putJson($url, [
            'stage' => 'production',
            ...$rotated,
            'secret' => 'PCSID-ROTATED-SECRET',
            'current_password' => 'password123',
        ])->assertOk();
        $this->assertSame(
            strtotime($rotated['expires_at']),
            ZatcaCredential::sole()->expires_at->getTimestamp()
        );
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

        $newMaterial = $this->certificateMaterial('stage-production');
        $this->withToken($auth['token'])->putJson($url, $this->payload([
            'stage' => 'production',
            ...$newMaterial,
            'secret' => 'PCSID-NEW-SECRET',
        ]))->assertOk()->assertJsonPath('data.stage', 'production');

        $credentials = ZatcaCredential::sole()->credentials;
        $this->assertSame($newMaterial['binary_security_token'], $credentials['binary_security_token']);
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
    public function the_inner_application_guard_rejects_storage_after_disable_wins_the_lock(): void
    {
        $auth = $this->registerTenant('zatca-disabled-race', 'zatca-disabled-race@example.test');
        app(TenantContext::class)->set($auth['tenant_id']);

        $this->withToken($auth['token'])->postJson('/api/applications/disable', [
            'application_key' => 'compliance.zatca',
        ])->assertOk()->assertJsonPath('data.status', 'disabled');

        $user = User::where('email', 'zatca-disabled-race@example.test')->firstOrFail();

        try {
            app(ZatcaCredentialService::class)->store($user, 'simulation', $this->payload());
            $this->fail('Disabled ZATCA application accepted credential storage.');
        } catch (ValidationException $exception) {
            $this->assertArrayHasKey('application', $exception->errors());
        }

        $this->assertDatabaseCount('zatca_credentials', 0);
    }

    /** @test */
    public function a_same_key_certificate_with_a_different_subject_is_not_counted_as_a_parent(): void
    {
        $authority = $this->testAuthority();
        $csr = openssl_csr_new(
            ['commonName' => 'Renewed CA With Different Subject'],
            $authority['private_key'],
            ['config' => $authority['config_path'], 'digest_alg' => 'sha256']
        );
        $this->assertNotFalse($csr);

        $otherSubject = openssl_csr_sign($csr, null, $authority['private_key'], 3650, [
            'config' => $authority['config_path'],
            'digest_alg' => 'sha256',
            'x509_extensions' => 'v3_ca',
        ]);
        $this->assertNotFalse($otherSubject);
        $missingIssuerKey = openssl_pkey_new([
            'config' => $authority['config_path'],
            'private_key_type' => OPENSSL_KEYTYPE_EC,
            'curve_name' => 'secp256k1',
        ]);
        $this->assertNotFalse($missingIssuerKey);
        $missingIssuerCsr = openssl_csr_new(
            ['commonName' => 'Missing Cross Sign Issuer'],
            $missingIssuerKey,
            ['config' => $authority['config_path'], 'digest_alg' => 'sha256']
        );
        $this->assertNotFalse($missingIssuerCsr);
        $missingIssuer = openssl_csr_sign($missingIssuerCsr, null, $missingIssuerKey, 3650, [
            'config' => $authority['config_path'],
            'digest_alg' => 'sha256',
            'x509_extensions' => 'v3_ca',
        ]);
        $this->assertNotFalse($missingIssuer);

        // نفس Subject والمفتاح العام للجذر الصحيح، لكن بتوقيع مُصدِر غير موجود في الحزمة.
        $crossCsr = openssl_csr_new(
            ['commonName' => 'Nebrax Test ZATCA Root'],
            $authority['private_key'],
            ['config' => $authority['config_path'], 'digest_alg' => 'sha256']
        );
        $this->assertNotFalse($crossCsr);
        $deadEndCrossSigned = openssl_csr_sign(
            $crossCsr,
            $missingIssuer,
            $missingIssuerKey,
            3650,
            [
                'config' => $authority['config_path'],
                'digest_alg' => 'sha256',
                'x509_extensions' => 'v3_ca',
            ]
        );
        $this->assertNotFalse($deadEndCrossSigned);

        $this->assertTrue(openssl_x509_export($authority['certificate'], $rootPem));
        $this->assertTrue(openssl_x509_export($otherSubject, $otherPem));
        $this->assertTrue(openssl_x509_export($deadEndCrossSigned, $crossPem));

        $bundlePath = tempnam(sys_get_temp_dir(), 'zatca-same-key-bundle-');
        $this->assertNotFalse($bundlePath);
        $this->assertNotFalse(file_put_contents($bundlePath, $rootPem.$otherPem.$crossPem));
        $requestPayload = $this->payload();
        config(['zatca.trust_anchors.developer' => $bundlePath]);

        $auth = $this->registerTenant('zatca-same-key-ca', 'zatca-same-key-ca@example.test');
        $this->withToken($auth['token'])->putJson(
            '/api/zatca-credentials/developer',
            $requestPayload
        )->assertOk()->assertJsonPath('data.certificate_chain_length', 2);

        $this->assertSame(
            $this->certificateBody($authority['certificate']),
            ZatcaCredential::sole()->credentials['certificate_chain'][1]
        );
    }

    /** @test */
    public function invalid_or_mismatched_cryptographic_material_is_rejected(): void
    {
        $auth = $this->registerTenant('zatca-material', 'zatca-material@example.test');
        $url = '/api/zatca-credentials/simulation';

        $this->withToken($auth['token'])->putJson($url, $this->payload([
            'binary_security_token' => 'not-a-certificate',
        ]))->assertUnprocessable()->assertJsonValidationErrors('binary_security_token');

        $otherKey = $this->certificateMaterial('mismatched-key');
        $this->withToken($auth['token'])->putJson($url, $this->payload([
            'private_key' => $otherKey['private_key'],
        ]))->assertUnprocessable()->assertJsonValidationErrors('private_key');

        $this->withToken($auth['token'])->putJson($url, $this->payload([
            'expires_at' => now()->addYears(2)->toIso8601String(),
        ]))->assertUnprocessable()->assertJsonValidationErrors('expires_at');

        $this->withToken($auth['token'])->putJson(
            $url,
            $this->payload($this->untrustedCertificateMaterial())
        )->assertUnprocessable()->assertJsonValidationErrors('binary_security_token');

        $this->withToken($auth['token'])->putJson(
            $url,
            $this->payload($this->certificateMaterial('tls-only', 'tls_only_leaf'))
        )->assertUnprocessable()->assertJsonValidationErrors('binary_security_token');

        $this->assertDatabaseCount('zatca_credentials', 0);
    }

    /** @test */
    public function a_client_auth_oid_prefix_is_not_accepted_as_client_auth(): void
    {
        $auth = $this->registerTenant('zatca-client-auth-prefix', 'zatca-client-auth-prefix@example.test');

        $this->withToken($auth['token'])->putJson(
            '/api/zatca-credentials/simulation',
            $this->payload($this->certificateMaterial('client-auth-prefix', 'client_auth_prefix_leaf'))
        )->assertUnprocessable()->assertJsonValidationErrors('binary_security_token');

        $this->assertDatabaseCount('zatca_credentials', 0);
    }

    /** @test */
    public function a_certificate_authority_cannot_be_stored_as_a_csid_leaf(): void
    {
        $auth = $this->registerTenant('zatca-csid-ca', 'zatca-csid-ca@example.test');

        $this->withToken($auth['token'])->putJson(
            '/api/zatca-credentials/simulation',
            $this->payload($this->certificateMaterial('csid-ca', 'csid_ca_leaf'))
        )->assertUnprocessable()->assertJsonValidationErrors('binary_security_token');

        $this->assertDatabaseCount('zatca_credentials', 0);
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
