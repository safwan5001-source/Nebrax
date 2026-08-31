<?php

namespace Tests\Feature;

use App\Services\Accounting\ZatcaHttpTransport;
use App\Services\Accounting\ZatcaSubmissionEndpointResolver;
use App\Services\Accounting\ZatcaTransportCredential;
use Illuminate\Http\Client\Request;
use Illuminate\Support\Facades\Http;
use RuntimeException;
use Tests\TestCase;

class ZatcaHttpTransportTest extends TestCase
{
    private const SIMULATION_REPORTING = 'https://gw-fatoora.zatca.gov.sa/e-invoicing/simulation/invoices/reporting/single';

    private function credential(string $environment = 'simulation'): ZatcaTransportCredential
    {
        return new ZatcaTransportCredential($environment, 'production-csid', 'production-secret');
    }

    /** @test */
    public function it_posts_the_official_v2_contract_without_leaking_credentials(): void
    {
        Http::fake([
            self::SIMULATION_REPORTING => Http::response([
                'invoiceHash' => base64_encode(str_repeat('h', 32)),
                'reportingStatus' => 'REPORTED',
                'warnings' => [],
                'secret' => 'must-not-be-audited',
            ], 200),
        ]);

        $xml = '<Invoice>signed</Invoice>';
        $hash = base64_encode(hash('sha256', $xml, true));
        $result = app(ZatcaHttpTransport::class)->submit(
            $this->credential(),
            'reporting',
            $hash,
            $xml,
        );

        $this->assertSame('accepted', $result->status);
        $this->assertSame('REPORTED', $result->responseCode);
        $this->assertFalse($result->retryable);
        $this->assertArrayNotHasKey('secret', $result->auditPayload);

        Http::assertSent(function (Request $request) use ($hash, $xml): bool {
            $authorization = $request->header('Authorization')[0] ?? null;

            return $request->url() === self::SIMULATION_REPORTING
                && $request->method() === 'POST'
                && $request->header('accept-version') === ['v2']
                && $request->header('accept-language') === ['en']
                && $authorization === 'Basic '.base64_encode('production-csid:production-secret')
                && $request['invoiceHash'] === $hash
                && $request['invoice'] === base64_encode($xml);
        });
    }

    /** @test */
    public function clearance_keeps_the_returned_xml_separate_from_the_audit_payload(): void
    {
        $url = 'https://gw-fatoora.zatca.gov.sa/e-invoicing/core/invoices/clearance/single';
        Http::fake([$url => Http::response([
            'clearanceStatus' => 'CLEARED',
            'clearedInvoice' => base64_encode('<Invoice>cleared</Invoice>'),
            'validationResults' => ['warningMessages' => [['message' => '<b>warning</b>']]],
        ], 202)]);

        $result = app(ZatcaHttpTransport::class)->submit(
            $this->credential('production'),
            'clearance',
            base64_encode(str_repeat('x', 32)),
            '<Invoice>signed</Invoice>',
        );

        $this->assertSame('accepted', $result->status);
        $this->assertSame(202, $result->httpStatus);
        $this->assertSame(base64_encode('<Invoice>cleared</Invoice>'), $result->clearedInvoice);
        $this->assertArrayNotHasKey('clearedInvoice', $result->auditPayload);
        $this->assertSame('warning', $result->auditPayload['validationResults']['warningMessages'][0]['message']);
    }

    /** @test */
    public function temporary_failures_are_retryable_but_client_rejections_are_not(): void
    {
        Http::fake([self::SIMULATION_REPORTING => Http::sequence()
            ->push(['status' => 'ERROR'], 503)
            ->push(['status' => 'REJECTED', 'errors' => [['message' => 'invalid invoice']]], 400)]);

        $transport = app(ZatcaHttpTransport::class);
        $hash = base64_encode(str_repeat('x', 32));
        $failed = $transport->submit($this->credential(), 'reporting', $hash, '<Invoice/>');
        $rejected = $transport->submit($this->credential(), 'reporting', $hash, '<Invoice/>');

        $this->assertSame('failed', $failed->status);
        $this->assertTrue($failed->retryable);
        $this->assertSame('rejected', $rejected->status);
        $this->assertFalse($rejected->retryable);
    }

    /** @test */
    public function it_fails_closed_for_developer_or_untrusted_endpoint_configuration(): void
    {
        Http::fake();
        $resolver = app(ZatcaSubmissionEndpointResolver::class);

        try {
            $resolver->resolve('developer', 'reporting');
            $this->fail('كان يجب رفض وجهة developer غير المنشورة رسمياً.');
        } catch (RuntimeException $exception) {
            $this->assertStringContainsString('لا توجد وجهة', $exception->getMessage());
        }

        config(['zatca.submission_endpoints.simulation.reporting' => 'https://evil.example.test/collect']);
        $this->expectException(RuntimeException::class);
        $this->expectExceptionMessage('العنوان الرسمي');
        $resolver->resolve('simulation', 'reporting');
        Http::assertNothingSent();
    }

    /** @test */
    public function malformed_hash_is_rejected_before_any_network_call(): void
    {
        Http::fake();

        $this->expectException(RuntimeException::class);
        $this->expectExceptionMessage('SHA-256');

        try {
            app(ZatcaHttpTransport::class)->submit(
                $this->credential(),
                'reporting',
                'not-a-hash',
                '<Invoice/>',
            );
        } finally {
            Http::assertNothingSent();
        }
    }
}
