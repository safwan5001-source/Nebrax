<?php

namespace Tests\Feature;

use App\Jobs\Accounting\SendZatcaSubmission;
use App\Models\Invoice;
use App\Models\Partner;
use App\Models\ZatcaCredential;
use App\Services\Accounting\InvoiceService;
use App\Services\Accounting\ZatcaSubmissionDispatcher;
use App\Services\Accounting\ZatcaSubmissionService;
use App\Support\Settings;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Queue;
use Tests\TestCase;

class ZatcaSubmissionDispatcherTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    private array $auth;
    private Invoice $invoice;

    protected function setUp(): void
    {
        parent::setUp();
        $this->auth = $this->registerTenant('zatca-dispatcher', 'zatca-dispatcher@example.test');
        app(TenantContext::class)->set($this->auth['tenant_id']);
        $customer = Partner::create(['name' => 'عميل النقل', 'type' => 'customer']);
        $draft = app(InvoiceService::class)->create(
            ['partner_id' => $customer->id, 'payment_type' => 'credit'],
            [['description' => 'خدمة', 'quantity' => 1, 'unit_price' => 100000, 'tax_rate' => 15]],
        );
        $this->invoice = app(InvoiceService::class)->post($draft);
        Settings::put('zatca', ['active_environment' => 'simulation']);
        ZatcaCredential::create([
            'environment' => 'simulation',
            'stage' => 'production',
            'status' => 'configured',
            'credentials' => ['binary_security_token' => 'csid', 'secret' => 'secret'],
            'certificate_fingerprint' => str_repeat('a', 64),
            'configured_at' => now(),
            'expires_at' => now()->addDay(),
        ]);
    }

    private function attempt(string $key = 'dispatch-1')
    {
        return app(ZatcaSubmissionService::class)
            ->requestManual($this->invoice->fresh(), $key, null)['attempt'];
    }

    /** @test */
    public function reporting_dispatch_persists_a_sanitized_final_result_once(): void
    {
        Http::fake(['https://gw-fatoora.zatca.gov.sa/*' => Http::response([
            'reportingStatus' => 'REPORTED',
            'invoiceHash' => $this->invoice->zatca_hash,
            'secret' => 'never-store-this',
        ], 200)]);

        $attempt = $this->attempt();
        $completed = app(ZatcaSubmissionDispatcher::class)->dispatch($attempt);
        $again = app(ZatcaSubmissionDispatcher::class)->dispatch($completed);

        $this->assertSame('accepted', $completed->status);
        $this->assertSame('REPORTED', $completed->response_code);
        $this->assertArrayNotHasKey('secret', $completed->response_payload);
        $this->assertFalse($completed->response_payload['retryable']);
        $this->assertSame($completed->id, $again->id);
        Http::assertSentCount(1);
    }

    /** @test */
    public function clearance_xml_is_saved_separately_without_mutating_the_submission_snapshot(): void
    {
        $this->invoice->update(['zatca_document_type' => 'standard']);
        $originalXml = $this->invoice->zatca_xml;
        $clearedXml = '<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"><ID>cleared</ID></Invoice>';
        Http::fake(['https://gw-fatoora.zatca.gov.sa/*' => Http::response([
            'clearanceStatus' => 'CLEARED',
            'clearedInvoice' => base64_encode($clearedXml),
        ], 200)]);

        $completed = app(ZatcaSubmissionDispatcher::class)->dispatch($this->attempt('clearance-1'));
        $fresh = $this->invoice->fresh();

        $this->assertSame('accepted', $completed->status);
        $this->assertSame($originalXml, $fresh->zatca_xml);
        $this->assertSame($clearedXml, $fresh->zatca_cleared_xml);
        $this->assertArrayNotHasKey('clearedInvoice', $completed->response_payload);
    }

    /** @test */
    public function a_changed_snapshot_fails_before_network_access(): void
    {
        Http::fake();
        $attempt = $this->attempt();
        $this->invoice->update(['zatca_xml' => $this->invoice->zatca_xml.' ']);

        $completed = app(ZatcaSubmissionDispatcher::class)->dispatch($attempt);

        $this->assertSame('failed', $completed->status);
        $this->assertSame('submission_preflight_failed', $completed->response_code);
        Http::assertNothingSent();
    }

    /** @test */
    public function controller_queues_only_new_attempts_when_dispatch_is_explicitly_enabled(): void
    {
        Queue::fake();
        config(['zatca.transport.dispatch_enabled' => true, 'zatca.transport.queue' => 'zatca']);

        $response = $this->withToken($this->auth['token'])
            ->withHeader('Idempotency-Key', 'queued-1')
            ->postJson("/api/invoices/{$this->invoice->id}/zatca/submissions")
            ->assertStatus(202)
            ->assertJsonPath('meta.queue_dispatch_performed', true)
            ->assertJsonPath('meta.network_submission_performed', false);

        $attemptId = $response['data']['id'];
        Queue::assertPushedOn('zatca', SendZatcaSubmission::class);
        Queue::assertPushed(SendZatcaSubmission::class, fn (SendZatcaSubmission $job): bool =>
            $job->tenantId === $this->auth['tenant_id'] && $job->attemptId === $attemptId
        );

        $this->withToken($this->auth['token'])
            ->withHeader('Idempotency-Key', 'queued-1')
            ->postJson("/api/invoices/{$this->invoice->id}/zatca/submissions")
            ->assertOk()
            ->assertJsonPath('meta.queue_dispatch_performed', false);
        Queue::assertPushed(SendZatcaSubmission::class, 1);
    }
}
