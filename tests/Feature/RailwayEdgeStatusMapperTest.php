<?php

namespace Tests\Feature;

use App\Services\Commerce\Edge\EdgeSnapshot;
use App\Services\Commerce\Edge\RailwayEdgeStatusMapper;
use Tests\TestCase;

/**
 * CUSTOM-DOMAIN-EDGE-1 — ترجمة عقد Railway الحي إلى حالات AWJ فقط.
 *
 * تشغيل: php artisan test --filter=RailwayEdgeStatusMapperTest
 */
class RailwayEdgeStatusMapperTest extends TestCase
{
    private function mapper(): RailwayEdgeStatusMapper
    {
        return new RailwayEdgeStatusMapper();
    }

    /**
     * @param  array<string, mixed>  $overrides
     * @return array<string, mixed>
     */
    private function sampleStatus(array $overrides = []): array
    {
        return array_merge([
            'dnsRecords' => [
                [
                    'hostlabel' => 'shop',
                    'fqdn' => 'shop.example.com',
                    'recordType' => RailwayEdgeStatusMapper::RECORD_CNAME,
                    'requiredValue' => 'g05ns7.up.railway.app',
                    'currentValue' => null,
                    'status' => 'DNS_RECORD_STATUS_REQUIRES_UPDATE',
                    'zone' => 'example.com',
                    'purpose' => RailwayEdgeStatusMapper::PURPOSE_ROUTE,
                ],
            ],
            'certificates' => [],
            'certificateStatus' => 'CERTIFICATE_STATUS_TYPE_VALIDATING_OWNERSHIP',
            'certificateErrorMessage' => null,
            'verificationToken' => 'railway-verify=abc',
            'verificationDnsHost' => '_railway-verify.shop.example.com',
            'verified' => false,
        ], $overrides);
    }

    /** @test */
    public function validating_ownership_without_propagated_dns_is_dns_required(): void
    {
        $snapshot = $this->mapper()->snapshotFromStatus($this->sampleStatus());

        $this->assertSame(EdgeSnapshot::STATUS_DNS_REQUIRED, $snapshot->status);
        $this->assertFalse($snapshot->missing);
        $types = array_map(fn ($r) => $r->type, $snapshot->dnsRecords);
        $this->assertContains('CNAME', $types);
        $this->assertContains('TXT', $types);
        $txt = collect($snapshot->dnsRecords)->firstWhere('type', 'TXT');
        $this->assertSame('_railway-verify.shop.example.com', $txt->name);
        $this->assertSame('railway-verify=abc', $txt->value);
    }

    /** @test */
    public function propagated_routing_dns_without_valid_cert_is_tls_pending(): void
    {
        $snapshot = $this->mapper()->snapshotFromStatus($this->sampleStatus([
            'dnsRecords' => [[
                'fqdn' => 'shop.example.com',
                'recordType' => RailwayEdgeStatusMapper::RECORD_CNAME,
                'requiredValue' => 'g05ns7.up.railway.app',
                'status' => RailwayEdgeStatusMapper::DNS_PROPAGATED,
                'purpose' => RailwayEdgeStatusMapper::PURPOSE_ROUTE,
            ]],
            'certificateStatus' => 'CERTIFICATE_STATUS_TYPE_ISSUING',
        ]));

        $this->assertSame(EdgeSnapshot::STATUS_TLS_PENDING, $snapshot->status);
    }

    /** @test */
    public function certificate_valid_is_the_only_ready_evidence(): void
    {
        $snapshot = $this->mapper()->snapshotFromStatus($this->sampleStatus([
            'dnsRecords' => [[
                'fqdn' => 'shop.example.com',
                'recordType' => RailwayEdgeStatusMapper::RECORD_CNAME,
                'requiredValue' => 'g05ns7.up.railway.app',
                'status' => RailwayEdgeStatusMapper::DNS_PROPAGATED,
                'purpose' => RailwayEdgeStatusMapper::PURPOSE_ROUTE,
            ]],
            'certificateStatus' => RailwayEdgeStatusMapper::CERT_VALID,
        ]));

        $this->assertSame(EdgeSnapshot::STATUS_READY, $snapshot->status);
        $this->assertNull($snapshot->lastError);
    }

    /** @test */
    public function official_docs_issued_enum_is_not_treated_as_ready(): void
    {
        $snapshot = $this->mapper()->snapshotFromStatus($this->sampleStatus([
            'certificateStatus' => 'ISSUED',
            'dnsRecords' => [[
                'fqdn' => 'shop.example.com',
                'recordType' => RailwayEdgeStatusMapper::RECORD_CNAME,
                'requiredValue' => 'target',
                'status' => RailwayEdgeStatusMapper::DNS_PROPAGATED,
                'purpose' => RailwayEdgeStatusMapper::PURPOSE_ROUTE,
            ]],
        ]));

        $this->assertNotSame(EdgeSnapshot::STATUS_READY, $snapshot->status);
        $this->assertSame(EdgeSnapshot::STATUS_TLS_PENDING, $snapshot->status);
    }

    /** @test */
    public function certificate_issue_failed_is_failed(): void
    {
        $snapshot = $this->mapper()->snapshotFromStatus($this->sampleStatus([
            'certificateStatus' => RailwayEdgeStatusMapper::CERT_FAILED,
            'certificateErrorMessage' => 'rate limited by letsencrypt',
        ]));

        $this->assertSame(EdgeSnapshot::STATUS_FAILED, $snapshot->status);
        $this->assertSame('rate limited by letsencrypt', $snapshot->lastError);
    }

    /** @test */
    public function acme_challenge_cname_is_not_shown_to_the_merchant(): void
    {
        $snapshot = $this->mapper()->snapshotFromStatus($this->sampleStatus([
            'dnsRecords' => [
                [
                    'fqdn' => '_acme-challenge.shop.example.com',
                    'recordType' => RailwayEdgeStatusMapper::RECORD_CNAME,
                    'requiredValue' => 'acme.example.net',
                    'status' => RailwayEdgeStatusMapper::DNS_PROPAGATED,
                    'purpose' => RailwayEdgeStatusMapper::PURPOSE_ACME,
                ],
                [
                    'fqdn' => 'shop.example.com',
                    'recordType' => RailwayEdgeStatusMapper::RECORD_CNAME,
                    'requiredValue' => 'g05ns7.up.railway.app',
                    'status' => 'DNS_RECORD_STATUS_REQUIRES_UPDATE',
                    'purpose' => RailwayEdgeStatusMapper::PURPOSE_ROUTE,
                ],
            ],
        ]));

        $names = array_map(fn ($r) => $r->name, $snapshot->dnsRecords);
        $this->assertNotContains('_acme-challenge.shop.example.com', $names);
        $this->assertContains('shop.example.com', $names);
    }

    /** @test */
    public function secret_like_certificate_errors_are_sanitized(): void
    {
        $snapshot = $this->mapper()->snapshotFromStatus($this->sampleStatus([
            'certificateStatus' => RailwayEdgeStatusMapper::CERT_FAILED,
            'certificateErrorMessage' => 'Authorization Bearer railway-secret-token failed',
        ]));

        $this->assertSame(EdgeSnapshot::STATUS_FAILED, $snapshot->status);
        $this->assertSame('تعذّر إصدار شهادة HTTPS لهذا النطاق.', $snapshot->lastError);
        $this->assertStringNotContainsString('railway-secret-token', (string) $snapshot->lastError);
        $this->assertStringNotContainsString('Bearer', (string) $snapshot->lastError);
    }

    /** @test */
    public function empty_status_never_marks_ready(): void
    {
        $snapshot = $this->mapper()->snapshotFromStatus([]);

        $this->assertSame(EdgeSnapshot::STATUS_DNS_REQUIRED, $snapshot->status);
        $this->assertSame([], $snapshot->dnsRecords);
    }
}
