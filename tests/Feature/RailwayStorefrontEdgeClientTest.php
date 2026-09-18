<?php

namespace Tests\Feature;

use App\Services\Commerce\Edge\EdgeSnapshot;
use App\Services\Commerce\Edge\RailwayEdgeStatusMapper;
use App\Services\Commerce\Edge\RailwayStorefrontEdgeClient;
use App\Services\Commerce\StorefrontEdgeConflictException;
use App\Services\Commerce\StorefrontEdgeMisconfiguredException;
use App\Services\Commerce\StorefrontEdgeUnavailableException;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Http\Client\Request;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

/**
 * CUSTOM-DOMAIN-EDGE-1 — عميل Railway GraphQL: العقد الحي، أخطاء النقل،
 * وعدم تسريب الأسرار.
 *
 * تشغيل: php artisan test --filter=RailwayStorefrontEdgeClientTest
 */
class RailwayStorefrontEdgeClientTest extends TestCase
{
    private const TOKEN = 'railway-workspace-secret-token';

    private const ENDPOINT = 'https://backboard.railway.com/graphql/v2';

    protected function setUp(): void
    {
        parent::setUp();
        config([
            'storefront.edge.token' => self::TOKEN,
            'storefront.edge.project_id' => 'proj-1',
            'storefront.edge.environment_id' => 'env-1',
            'storefront.edge.service_id' => 'svc-storefront',
            'storefront.edge.target_port' => null,
            'storefront.edge.endpoint' => self::ENDPOINT,
        ]);
    }

    private function client(): RailwayStorefrontEdgeClient
    {
        return new RailwayStorefrontEdgeClient(new RailwayEdgeStatusMapper());
    }

    /**
     * @return array<string, mixed>
     */
    private function domainNode(string $id = 'dom-1', string $hostname = 'shop.example.com'): array
    {
        return [
            'id' => $id,
            'domain' => $hostname,
            'deletedAt' => null,
            'status' => [
                'dnsRecords' => [[
                    'fqdn' => $hostname,
                    'recordType' => RailwayEdgeStatusMapper::RECORD_CNAME,
                    'requiredValue' => 'g05ns7.up.railway.app',
                    'status' => 'DNS_RECORD_STATUS_REQUIRES_UPDATE',
                    'purpose' => RailwayEdgeStatusMapper::PURPOSE_ROUTE,
                ]],
                'certificates' => [],
                'certificateStatus' => 'CERTIFICATE_STATUS_TYPE_VALIDATING_OWNERSHIP',
                'certificateErrorMessage' => null,
                'verificationToken' => 'railway-verify=abc',
                'verificationDnsHost' => '_railway-verify.'.$hostname,
                'verified' => false,
            ],
        ];
    }

    /** @test */
    public function missing_configuration_fails_closed_without_http(): void
    {
        config(['storefront.edge.token' => '']);
        Http::fake();

        try {
            $this->client()->provision('shop.example.com');
            $this->fail('expected misconfigured');
        } catch (StorefrontEdgeMisconfiguredException $e) {
            $this->assertStringContainsString('غير مضبوط', $e->getMessage());
            $this->assertStringNotContainsString(self::TOKEN, $e->getMessage());
        }

        Http::assertNothingSent();
    }

    /** @test */
    public function provision_sends_bearer_auth_and_create_input_without_logging_the_token(): void
    {
        Http::fake([
            self::ENDPOINT => Http::response(['data' => ['customDomainCreate' => $this->domainNode()]], 200),
        ]);

        $binding = $this->client()->provision('shop.example.com');

        $this->assertSame('dom-1', $binding->providerId);
        $this->assertSame(EdgeSnapshot::STATUS_DNS_REQUIRED, $binding->snapshot->status);
        Http::assertSent(function (Request $request) {
            $this->assertSame(self::ENDPOINT, $request->url());
            $this->assertSame('Bearer '.self::TOKEN, $request->header('Authorization')[0] ?? null);
            $body = json_decode($request->body(), true);
            $this->assertIsArray($body);
            $this->assertStringContainsString('customDomainCreate', (string) ($body['query'] ?? ''));
            $this->assertSame('shop.example.com', $body['variables']['input']['domain'] ?? null);
            $this->assertSame('proj-1', $body['variables']['input']['projectId'] ?? null);
            $this->assertSame('env-1', $body['variables']['input']['environmentId'] ?? null);
            $this->assertSame('svc-storefront', $body['variables']['input']['serviceId'] ?? null);
            $this->assertArrayNotHasKey('targetPort', $body['variables']['input'] ?? []);
            $this->assertStringNotContainsString(self::TOKEN, $request->body());

            return true;
        });
    }

    /** @test */
    public function fetch_maps_valid_certificate_to_ready(): void
    {
        $node = $this->domainNode();
        $node['status']['certificateStatus'] = RailwayEdgeStatusMapper::CERT_VALID;
        $node['status']['dnsRecords'][0]['status'] = RailwayEdgeStatusMapper::DNS_PROPAGATED;
        Http::fake([self::ENDPOINT => Http::response(['data' => ['customDomain' => $node]], 200)]);

        $snapshot = $this->client()->fetch('dom-1');

        $this->assertSame(EdgeSnapshot::STATUS_READY, $snapshot->status);
        $this->assertFalse($snapshot->missing);
    }

    /** @test */
    public function fetch_of_null_or_deleted_domain_is_missing_failed(): void
    {
        Http::fake([self::ENDPOINT => Http::response(['data' => ['customDomain' => null]], 200)]);

        $snapshot = $this->client()->fetch('gone');

        $this->assertTrue($snapshot->missing);
        $this->assertSame(EdgeSnapshot::STATUS_FAILED, $snapshot->status);
        $this->assertNotSame(EdgeSnapshot::STATUS_READY, $snapshot->status);
    }

    /** @test */
    public function find_by_hostname_matches_case_insensitively_and_skips_deleted(): void
    {
        Http::fake([self::ENDPOINT => Http::response([
            'data' => [
                'domains' => [
                    'customDomains' => [
                        ['id' => 'old', 'domain' => 'shop.example.com', 'deletedAt' => '2026-01-01T00:00:00Z', 'status' => []],
                        $this->domainNode('dom-live', 'shop.example.com'),
                    ],
                ],
            ],
        ], 200)]);

        $found = $this->client()->findByHostname('SHOP.example.com');

        $this->assertNotNull($found);
        $this->assertSame('dom-live', $found->providerId);
    }

    /** @test */
    public function already_exists_graphql_error_is_conflict(): void
    {
        Http::fake([self::ENDPOINT => Http::response([
            'errors' => [['message' => 'Custom domain already exists']],
        ], 200)]);

        $this->expectException(StorefrontEdgeConflictException::class);
        $this->client()->provision('shop.example.com');
    }

    /** @test */
    public function http_429_is_unavailable_not_ready(): void
    {
        Http::fake([self::ENDPOINT => Http::response(['message' => 'rate limited'], 429)]);

        try {
            $this->client()->provision('shop.example.com');
            $this->fail('expected unavailable');
        } catch (StorefrontEdgeUnavailableException $e) {
            $this->assertStringNotContainsString(self::TOKEN, $e->getMessage());
            $this->assertStringNotContainsString('rate limited', $e->getMessage());
        }
    }

    /** @test */
    public function http_5xx_is_unavailable(): void
    {
        Http::fake([self::ENDPOINT => Http::response('nope', 502)]);

        $this->expectException(StorefrontEdgeUnavailableException::class);
        $this->client()->fetch('dom-1');
    }

    /** @test */
    public function transport_timeout_is_unavailable(): void
    {
        Http::fake(fn () => throw new ConnectionException('cURL error 28: timeout'));

        $this->expectException(StorefrontEdgeUnavailableException::class);
        $this->client()->findByHostname('shop.example.com');
    }

    /** @test */
    public function graphql_not_authorized_is_unavailable_without_leaking_the_token(): void
    {
        Http::fake([self::ENDPOINT => Http::response([
            'errors' => [['message' => 'Not Authorized Bearer '.self::TOKEN]],
        ], 200)]);

        try {
            $this->client()->provision('shop.example.com');
            $this->fail('expected unavailable');
        } catch (StorefrontEdgeUnavailableException $e) {
            $this->assertStringNotContainsString(self::TOKEN, $e->getMessage());
            $this->assertStringNotContainsString('Bearer', $e->getMessage());
        }
    }
}
