<?php

namespace Tests\Feature;

use App\Models\SalesChannel;
use App\Models\Storefront;
use App\Models\StorefrontDomain;
use App\Services\Commerce\StorefrontDomainVerificationService;
use App\Support\Dns\DnsOperationalException;
use App\Support\Dns\DnsTxtResolver;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * STORE-ADMIN-ADOPT-1B-3A — `StorefrontDomainVerificationService` بمعزلٍ عن
 * أي شبكة/إنترنت حقيقي: `DnsTxtResolver` يُستبدَل بتنفيذ وهمي حتمي هنا.
 *
 * تشغيل: php artisan test --filter=StorefrontDomainVerificationServiceTest
 */
class StorefrontDomainVerificationServiceTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    private function seedCustomDomain(string $hostname, string $token): StorefrontDomain
    {
        $auth = $this->registerTenant('dns-service-'.substr(md5($hostname), 0, 8), 'owner@dns-service.test');
        app(TenantContext::class)->set($auth['tenant_id']);

        $channel = SalesChannel::create([
            'slug' => 'web', 'name' => 'ويب', 'type' => SalesChannel::TYPE_WEB, 'is_active' => true,
        ]);
        $storefront = Storefront::create([
            'slug' => 'main', 'name' => 'المتجر', 'sales_channel_id' => $channel->id, 'is_active' => true,
        ]);
        $domain = StorefrontDomain::create([
            'storefront_id' => $storefront->id,
            'hostname' => $hostname,
            'type' => StorefrontDomain::TYPE_CUSTOM,
            'is_primary' => false,
            'is_active' => true,
            'verification_status' => StorefrontDomain::VERIFICATION_PENDING,
            'verification_token' => $token,
        ]);
        app(TenantContext::class)->forget();

        return $domain;
    }

    private function serviceWithFakeResolver(array $txtRecords = null, bool $operationalFailure = false): StorefrontDomainVerificationService
    {
        $resolver = new class($txtRecords, $operationalFailure) implements DnsTxtResolver {
            public function __construct(private ?array $records, private bool $fail) {}

            public function lookupTxt(string $recordName): array
            {
                if ($this->fail) {
                    throw new DnsOperationalException('DNS operational failure (fake).');
                }

                return $this->records ?? [];
            }
        };

        return new StorefrontDomainVerificationService($resolver);
    }

    /** @test */
    public function the_exact_expected_txt_record_verifies_successfully(): void
    {
        $token = StorefrontDomainVerificationService::generateToken();
        $domain = $this->seedCustomDomain('exact-match.example.com', $token);

        $expected = StorefrontDomainVerificationService::expectedValueFor($token);
        $service = $this->serviceWithFakeResolver([$expected]);

        $result = $service->verify($domain);

        $this->assertTrue($result->matched);
        $this->assertFalse($result->operationalFailure);
    }

    /** @test */
    public function an_absent_txt_record_does_not_verify(): void
    {
        $token = StorefrontDomainVerificationService::generateToken();
        $domain = $this->seedCustomDomain('absent-record.example.com', $token);

        $service = $this->serviceWithFakeResolver([]);

        $result = $service->verify($domain);

        $this->assertFalse($result->matched);
        $this->assertFalse($result->operationalFailure);
    }

    /** @test */
    public function an_unrelated_txt_record_does_not_verify(): void
    {
        $token = StorefrontDomainVerificationService::generateToken();
        $domain = $this->seedCustomDomain('unrelated-record.example.com', $token);

        $service = $this->serviceWithFakeResolver(['v=spf1 include:_spf.example.com ~all']);

        $result = $service->verify($domain);

        $this->assertFalse($result->matched);
        $this->assertFalse($result->operationalFailure);
    }

    /** @test */
    public function a_wrong_awj_token_does_not_verify(): void
    {
        $token = StorefrontDomainVerificationService::generateToken();
        $domain = $this->seedCustomDomain('wrong-token.example.com', $token);

        $service = $this->serviceWithFakeResolver(['awj-domain-verification=not-the-real-token']);

        $result = $service->verify($domain);

        $this->assertFalse($result->matched);
    }

    /** @test */
    public function multiple_txt_records_with_one_correct_still_verify(): void
    {
        $token = StorefrontDomainVerificationService::generateToken();
        $domain = $this->seedCustomDomain('multi-correct.example.com', $token);

        $expected = StorefrontDomainVerificationService::expectedValueFor($token);
        $service = $this->serviceWithFakeResolver([
            'v=spf1 include:_spf.example.com ~all',
            'google-site-verification=abcdef',
            $expected,
        ]);

        $result = $service->verify($domain);

        $this->assertTrue($result->matched);
    }

    /** @test */
    public function multiple_unrelated_txt_records_do_not_verify(): void
    {
        $token = StorefrontDomainVerificationService::generateToken();
        $domain = $this->seedCustomDomain('multi-unrelated.example.com', $token);

        $service = $this->serviceWithFakeResolver([
            'v=spf1 include:_spf.example.com ~all',
            'google-site-verification=abcdef',
        ]);

        $result = $service->verify($domain);

        $this->assertFalse($result->matched);
        $this->assertFalse($result->operationalFailure);
    }

    /** @test */
    public function a_dns_operational_error_never_verifies_and_is_reported_distinctly(): void
    {
        $token = StorefrontDomainVerificationService::generateToken();
        $domain = $this->seedCustomDomain('operational-failure.example.com', $token);

        $service = $this->serviceWithFakeResolver(operationalFailure: true);

        $result = $service->verify($domain);

        $this->assertFalse($result->matched);
        $this->assertTrue($result->operationalFailure);
    }

    /** @test */
    public function the_record_name_is_deterministically_derived_from_the_hostname(): void
    {
        $this->assertSame(
            '_awj-verification.shop.example.com',
            StorefrontDomainVerificationService::recordNameFor('shop.example.com'),
        );
    }

    /** @test */
    public function the_expected_value_is_derived_from_the_stored_token(): void
    {
        $this->assertSame(
            'awj-domain-verification=abc123',
            StorefrontDomainVerificationService::expectedValueFor('abc123'),
        );
    }

    /** @test */
    public function a_request_supplied_token_cannot_influence_verification_because_only_the_stored_token_is_used(): void
    {
        $storedToken = StorefrontDomainVerificationService::generateToken();
        $domain = $this->seedCustomDomain('stored-token-only.example.com', $storedToken);

        // A malicious/incorrect "client-provided" token would never even be
        // read by verify() — it takes only the StorefrontDomain model, whose
        // token came from the database, never from request input.
        $attackerSuppliedToken = 'attacker-chosen-token';
        $service = $this->serviceWithFakeResolver([
            StorefrontDomainVerificationService::expectedValueFor($attackerSuppliedToken),
        ]);

        $result = $service->verify($domain);

        $this->assertFalse($result->matched);
    }

    /** @test */
    public function generated_tokens_are_high_entropy_and_unique(): void
    {
        $a = StorefrontDomainVerificationService::generateToken();
        $b = StorefrontDomainVerificationService::generateToken();

        $this->assertNotSame($a, $b);
        $this->assertGreaterThanOrEqual(40, strlen($a));
        $this->assertMatchesRegularExpression('/\A[0-9a-f]+\z/', $a);
    }
}
