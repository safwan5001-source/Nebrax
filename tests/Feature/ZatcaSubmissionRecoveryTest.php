<?php

namespace Tests\Feature;

use App\Jobs\Accounting\SendZatcaSubmission;
use App\Models\Invoice;
use App\Models\Partner;
use App\Models\ZatcaCredential;
use App\Services\Accounting\InvoiceService;
use App\Support\Settings;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Queue;
use Tests\TestCase;

class ZatcaSubmissionRecoveryTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    private array $auth;
    private Invoice $invoice;

    protected function setUp(): void
    {
        parent::setUp();
        $this->auth = $this->registerTenant('zatca-recovery', 'zatca-recovery@example.test');
        app(TenantContext::class)->set($this->auth['tenant_id']);
        $customer = Partner::create(['name' => 'عميل الاستعادة', 'type' => 'customer']);
        $draft = app(InvoiceService::class)->create(
            ['partner_id' => $customer->id, 'payment_type' => 'credit'],
            [['description' => 'خدمة', 'quantity' => 1, 'unit_price' => 100000, 'tax_rate' => 15]],
        );
        $this->invoice = app(InvoiceService::class)->post($draft);

        ZatcaCredential::create([
            'environment' => 'developer',
            'stage' => 'production',
            'status' => 'configured',
            'credentials' => ['binary_security_token' => 'csid', 'secret' => 'secret'],
            'certificate_fingerprint' => str_repeat('a', 64),
            'configured_at' => now(),
            'expires_at' => now()->addDay(),
        ]);

        // لا تغيّر بيئة الطابور العالمية قبل اكتمال تأسيس المستأجر؛ الاختبار
        // يملك هذه الإعدادات من لحظة بدء سيناريو ZATCA فقط.
        Queue::fake();
        config([
            'zatca.transport.dispatch_enabled' => true,
            'zatca.transport.queue_connection' => 'database',
            'zatca.transport.queue' => 'zatca',
        ]);
    }

    private function createAttempt()
    {
        // developer غير مدعوم للنقل: تُسجّل المحاولة pending ولا تُصف.
        return $this->withToken($this->auth['token'])
            ->withHeader('Idempotency-Key', 'recover-1')
            ->postJson("/api/invoices/{$this->invoice->id}/zatca/submissions")
            ->assertStatus(202)
            ->assertJsonPath('meta.queue_dispatch_performed', false)
            ->assertJsonPath('meta.queue_dispatch_error', 'queue_not_ready');
    }

    /** @test */
    public function a_pending_attempt_can_be_requeued_after_readiness_is_fixed(): void
    {
        $created = $this->createAttempt();
        $attemptId = $created['data']['id'];
        $credential = ZatcaCredential::sole();
        $credential->update(['environment' => 'simulation']);
        Settings::put('zatca', ['active_environment' => 'simulation']);

        $this->withToken($this->auth['token'])
            ->postJson("/api/invoices/{$this->invoice->id}/zatca/submissions/{$attemptId}/dispatch")
            ->assertStatus(202)
            ->assertJsonPath('data.queue_count', 1)
            ->assertJsonPath('meta.queue_dispatch_performed', true);

        Queue::assertPushed(SendZatcaSubmission::class, fn (SendZatcaSubmission $job): bool =>
            $job->attemptId === $attemptId && $job->connection === 'database' && $job->queue === 'zatca'
        );
    }

    /** @test */
    public function an_unsafe_sync_connection_fails_without_changing_queue_audit(): void
    {
        $created = $this->createAttempt();
        $attemptId = $created['data']['id'];
        config(['zatca.transport.queue_connection' => 'sync']);

        $this->withToken($this->auth['token'])
            ->postJson("/api/invoices/{$this->invoice->id}/zatca/submissions/{$attemptId}/dispatch")
            ->assertUnprocessable();

        $this->assertDatabaseHas('zatca_submission_attempts', [
            'id' => $attemptId,
            'queue_count' => 0,
            'queued_at' => null,
        ]);
        Queue::assertNothingPushed();
    }

    /** @test */
    public function a_recently_queued_attempt_cannot_be_queued_twice(): void
    {
        $credential = ZatcaCredential::sole();
        $credential->update(['environment' => 'simulation']);
        Settings::put('zatca', ['active_environment' => 'simulation']);

        $created = $this->withToken($this->auth['token'])
            ->withHeader('Idempotency-Key', 'already-queued')
            ->postJson("/api/invoices/{$this->invoice->id}/zatca/submissions")
            ->assertStatus(202)
            ->assertJsonPath('data.queue_count', 1)
            ->assertJsonPath('meta.queue_dispatch_performed', true);

        $attemptId = $created['data']['id'];
        $this->withToken($this->auth['token'])
            ->postJson("/api/invoices/{$this->invoice->id}/zatca/submissions/{$attemptId}/dispatch")
            ->assertStatus(409);

        Queue::assertPushed(SendZatcaSubmission::class, 1);
        $this->assertDatabaseHas('zatca_submission_attempts', [
            'id' => $attemptId,
            'queue_count' => 1,
        ]);
    }

    /** @test */
    public function settings_expose_transport_blockers_without_credentials(): void
    {
        config(['zatca.transport.queue_connection' => 'sync']);

        $this->withToken($this->auth['token'])
            ->getJson('/api/zatca-settings')
            ->assertOk()
            ->assertJsonPath('meta.transport_readiness.ready', false)
            ->assertJsonPath('meta.transport_readiness.enabled', true)
            ->assertJsonPath('meta.transport_readiness.queue_connection', 'sync');
    }
}
