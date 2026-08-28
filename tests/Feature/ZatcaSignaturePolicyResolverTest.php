<?php

namespace Tests\Feature;

use App\Services\Accounting\ZatcaSignaturePolicyResolver;
use RuntimeException;
use Tests\TestCase;

class ZatcaSignaturePolicyResolverTest extends TestCase
{
    /** @test */
    public function it_fails_closed_when_the_policy_is_not_configured(): void
    {
        config()->set('zatca.signature_policy.identifier', null);
        config()->set('zatca.signature_policy.digest', null);

        $this->expectException(RuntimeException::class);
        $this->expectExceptionMessage('سياسة توقيع ZATCA');
        app(ZatcaSignaturePolicyResolver::class)->resolve();
    }

    /** @test */
    public function it_rejects_malformed_identifiers_and_non_sha256_digests(): void
    {
        config()->set('zatca.signature_policy.identifier', '/security-policy.pdf');
        config()->set('zatca.signature_policy.digest', base64_encode(hash('sha256', 'policy', true)));

        try {
            app(ZatcaSignaturePolicyResolver::class)->resolve();
            $this->fail('كان يجب رفض معرّف سياسة نسبي.');
        } catch (RuntimeException $exception) {
            $this->assertStringContainsString('HTTPS', $exception->getMessage());
        }

        foreach (['https://', 'urn:%ZZ', 'urn:ab-:x', 'urn:ab:#'] as $malformedIdentifier) {
            config()->set('zatca.signature_policy.identifier', $malformedIdentifier);
            try {
                app(ZatcaSignaturePolicyResolver::class)->resolve();
                $this->fail("كان يجب رفض معرّف السياسة غير الصالح: {$malformedIdentifier}");
            } catch (RuntimeException $exception) {
                $this->assertStringContainsString('HTTPS', $exception->getMessage());
            }
        }

        config()->set('zatca.signature_policy.identifier', 'https://zatca.gov.sa/signature-policy.pdf');
        config()->set('zatca.signature_policy.digest', base64_encode('not-32-bytes'));

        $this->expectException(RuntimeException::class);
        $this->expectExceptionMessage('SHA-256');
        app(ZatcaSignaturePolicyResolver::class)->resolve();
    }

    /** @test */
    public function it_returns_only_a_canonical_base64_sha256_policy(): void
    {
        $digest = base64_encode(hash('sha256', 'pinned-zatca-policy-document', true));
        config()->set('zatca.signature_policy.identifier', 'https://zatca.gov.sa/policy.pdf');
        config()->set('zatca.signature_policy.digest', $digest);

        $policy = app(ZatcaSignaturePolicyResolver::class)->resolve();

        $this->assertSame('https://zatca.gov.sa/policy.pdf', $policy->identifier);
        $this->assertSame($digest, $policy->digest);
    }
}
