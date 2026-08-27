<?php

namespace Tests\Feature;

use App\Models\Invoice;
use App\Models\Partner;
use App\Models\ZatcaSubmissionAttempt;
use App\Services\Accounting\ChartOfAccountsSeeder;
use App\Services\Accounting\InvoiceService;
use App\Services\Accounting\ZatcaSubmissionService;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class ZatcaSubmissionAttemptTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    private array $auth;
    private Partner $customer;

    protected function setUp(): void
    {
        parent::setUp();

        $this->auth = $this->registerTenant('zatca-attempts', 'zatca-attempts@example.test');
        app(TenantContext::class)->set($this->auth['tenant_id']);
        app(ChartOfAccountsSeeder::class)->seed($this->auth['tenant_id']);
        $this->customer = Partner::create(['name' => 'عميل ZATCA', 'type' => 'customer']);
    }

    private function postedInvoice(): Invoice
    {
        $invoice = app(InvoiceService::class)->create(
            ['partner_id' => $this->customer->id, 'payment_type' => 'credit'],
            [['description' => 'خدمة', 'quantity' => 1, 'unit_price' => 100000, 'tax_rate' => 15]],
        );

        return app(InvoiceService::class)->post($invoice);
    }

    private function request(Invoice $invoice, string $key)
    {
        return $this->withToken($this->auth['token'])
            ->withHeader('Idempotency-Key', $key)
            ->postJson("/api/invoices/{$invoice->id}/zatca/submissions");
    }

    /** @test */
    public function a_manual_request_creates_one_pending_attempt_without_network_submission(): void
    {
        $invoice = $this->postedInvoice();

        $response = $this->request($invoice, 'manual-1')
            ->assertStatus(202)
            ->assertJsonPath('data.attempt_number', 1)
            ->assertJsonPath('data.submission_type', 'reporting')
            ->assertJsonPath('data.source', 'manual')
            ->assertJsonPath('data.status', 'pending')
            ->assertJsonPath('meta.created', true)
            ->assertJsonPath('meta.network_submission_performed', false);

        $attempt = ZatcaSubmissionAttempt::sole();
        $this->assertSame($response['data']['id'], $attempt->id);
        $this->assertSame(hash('sha256', $invoice->zatca_xml), $attempt->request_hash);
        $this->assertNotSame('manual-1', $attempt->idempotency_key_hash);
    }

    /** @test */
    public function the_same_idempotency_key_returns_the_same_attempt(): void
    {
        $invoice = $this->postedInvoice();
        $first = $this->request($invoice, 'same-request')->assertStatus(202);

        $second = $this->request($invoice, 'same-request')
            ->assertOk()
            ->assertJsonPath('meta.created', false);

        $this->assertSame($first['data']['id'], $second['data']['id']);
        $this->assertDatabaseCount('zatca_submission_attempts', 1);
    }

    /** @test */
    public function a_parallel_manual_request_with_a_different_key_is_rejected(): void
    {
        $invoice = $this->postedInvoice();
        $this->request($invoice, 'first-key')->assertStatus(202);

        $this->request($invoice, 'different-key')->assertStatus(409);

        $this->assertDatabaseCount('zatca_submission_attempts', 1);
    }

    /** @test */
    public function a_failed_attempt_can_be_retried_manually_with_the_next_number(): void
    {
        $invoice = $this->postedInvoice();
        $first = $this->request($invoice, 'attempt-1')->assertStatus(202);
        $attempt = ZatcaSubmissionAttempt::findOrFail($first['data']['id']);

        app(ZatcaSubmissionService::class)->complete(
            $attempt,
            'failed',
            503,
            'gateway_unavailable',
            '<b>Temporary failure</b>',
            ['retryable' => true],
        );

        $second = $this->request($invoice, 'attempt-2')
            ->assertStatus(202)
            ->assertJsonPath('data.attempt_number', 2)
            ->assertJsonPath('data.status', 'pending');

        $history = $this->withToken($this->auth['token'])
            ->getJson("/api/invoices/{$invoice->id}/zatca/submissions")
            ->assertOk();

        $this->assertSame([2, 1], array_column($history['data'], 'attempt_number'));
        $this->assertSame('Temporary failure', $history['data'][1]['response_message']);
        $this->assertNotSame($first['data']['id'], $second['data']['id']);
    }

    /** @test */
    public function an_accepted_invoice_cannot_be_submitted_again(): void
    {
        $invoice = $this->postedInvoice();
        $response = $this->request($invoice, 'accepted-1')->assertStatus(202);
        $attempt = ZatcaSubmissionAttempt::findOrFail($response['data']['id']);
        app(ZatcaSubmissionService::class)->complete($attempt, 'accepted', 200, 'accepted');

        $this->request($invoice, 'accepted-2')->assertStatus(409);
        $this->assertDatabaseCount('zatca_submission_attempts', 1);
    }

    /** @test */
    public function a_draft_without_frozen_zatca_xml_is_rejected(): void
    {
        $draft = app(InvoiceService::class)->create(
            ['partner_id' => $this->customer->id],
            [['description' => 'خدمة', 'quantity' => 1, 'unit_price' => 100000, 'tax_rate' => 15]],
        );

        $this->request($draft, 'draft-1')->assertStatus(422);
        $this->assertDatabaseCount('zatca_submission_attempts', 0);
    }

    /** @test */
    public function the_idempotency_header_is_mandatory(): void
    {
        $invoice = $this->postedInvoice();

        $this->withToken($this->auth['token'])
            ->postJson("/api/invoices/{$invoice->id}/zatca/submissions")
            ->assertStatus(422)
            ->assertJsonValidationErrors('idempotency_key');
    }
}
