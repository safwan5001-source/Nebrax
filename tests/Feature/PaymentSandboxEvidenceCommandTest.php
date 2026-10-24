<?php

namespace Tests\Feature;

use App\Models\Partner;
use App\Models\PaymentAttempt;
use App\Models\PaymentGateway;
use App\Models\PaymentProviderEvent;
use App\Models\Tenant;
use App\Models\User;
use App\Services\Accounting\CashBankAccountService;
use App\Services\Accounting\ChartOfAccountsSeeder;
use App\Services\Accounting\InvoiceService;
use App\Services\FakePaymentGatewayAdapter;
use App\Services\InvoicePaymentRequestService;
use App\Services\PaymentOrchestrator;
use App\Services\PaymentsRolloutControlService;
use App\Models\PlatformAdministrator;
use App\Support\SchedulerHeartbeat;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;
use PHPUnit\Framework\Attributes\Test;
use Tests\TestCase;

/**
 * EXT-01 — أمر دليل تحقق Sandbox: قراءة فقط، يرفض Live، لا يطبع أسراراً ولا أجسام أحداث، ويلخّص الدفعة والحدث والترحيل والاستعلام.
 */
class PaymentSandboxEvidenceCommandTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $tenant;

    private PaymentGateway $gateway;

    private PaymentAttempt $attempt;

    protected function setUp(): void
    {
        parent::setUp();
        $this->tenant = Tenant::create(['name' => 'شركة الدليل', 'slug' => 'sandbox-evidence', 'vat_number' => '300000000000013', 'currency' => 'SAR']);
        app(TenantContext::class)->set($this->tenant->id);
        app(ChartOfAccountsSeeder::class)->seed($this->tenant->id);
        app(CashBankAccountService::class)->bootstrapDefaults();
        $owner = User::create(['tenant_id' => $this->tenant->id, 'name' => 'المالك', 'email' => 'o@sandbox-evidence.test', 'password' => 'password123', 'role' => 'owner']);
        $customer = Partner::create(['name' => 'عميل', 'type' => 'customer']);
        $platform = PlatformAdministrator::create(['name' => 'مشغّل', 'email' => 'ops@sandbox-evidence.test', 'password' => 'platform-password-123']);
        SchedulerHeartbeat::record();
        $this->app->singleton(FakePaymentGatewayAdapter::class);
        $fake = app(FakePaymentGatewayAdapter::class);
        $gateway = PaymentGateway::query()->create(['provider' => 'fake', 'name' => 'Fake', 'environment' => 'sandbox']);
        DB::table('payment_gateways')->where('id', $gateway->id)->update(['status' => PaymentGateway::STATUS_ACTIVE, 'is_active' => true]);
        $this->gateway = $gateway->fresh();
        app(PaymentsRolloutControlService::class)->setTenantState($platform, $this->tenant->id, true, 'تفعيل للاختبار');

        $invoice = app(InvoiceService::class)->post(app(InvoiceService::class)->create(
            ['partner_id' => $customer->id, 'payment_type' => 'credit'],
            [['quantity' => 1, 'unit_price' => 100000, 'tax_rate' => 15]],
        ));
        $requests = app(InvoicePaymentRequestService::class);
        $attempt = $requests->startAttempt($requests->create($invoice, $this->gateway, $owner), 'idem-ev-1', null, $owner);
        $fake->script($attempt->provider_payment_id, 'captured');
        app(PaymentOrchestrator::class)->sync($attempt);
        $this->attempt = $attempt->fresh();
        PaymentProviderEvent::query()->create([
            'payment_gateway_id' => $this->gateway->id, 'provider' => 'fake', 'provider_event_id' => 'evt_1', 'event_type' => 'payment_paid',
            'provider_payment_id' => $this->attempt->provider_payment_id, 'body_hash' => str_repeat('a', 64), 'body' => '{"secret":"must-not-print"}',
            'status' => 'processed', 'outcome' => 'applied', 'payment_attempt_id' => $this->attempt->id,
        ]);
    }

    #[Test]
    public function it_prints_redacted_evidence_with_passing_checks(): void
    {
        $exit = Artisan::call('payments:sandbox-evidence', ['attempt' => $this->attempt->id, '--tenant' => 'sandbox-evidence', '--fetch' => true]);
        $output = Artisan::output();
        $evidence = json_decode($output, true, flags: JSON_THROW_ON_ERROR);

        $this->assertSame(0, $exit);
        $this->assertSame(['payment_recorded' => true, 'signed_webhook_event_received' => true, 'fetch_matches_local' => true, 'posted_to_ledger' => true], $evidence['checks']);
        $this->assertSame('evt_1', $evidence['events'][0]['provider_event_id']);
        $this->assertSame('sandbox', $evidence['gateway']['environment']);
        $this->assertStringNotContainsString('must-not-print', $output, 'جسم الحدث لا يُطبع');
        $this->assertStringNotContainsString('body_hash', $output);
        $this->assertArrayNotHasKey('credentials', $evidence['gateway']);

        // بلا --fetch لا استعلام حي
        Artisan::call('payments:sandbox-evidence', ['attempt' => $this->attempt->id, '--tenant' => 'sandbox-evidence']);
        $this->assertNull(json_decode(Artisan::output(), true)['fetch']);
    }

    #[Test]
    public function it_refuses_live_and_unknown_inputs_and_never_writes(): void
    {
        $before = [DB::table('journal_entries')->count(), DB::table('payment_attempts')->count(), DB::table('payment_provider_events')->count()];

        $this->artisan('payments:sandbox-evidence', ['attempt' => $this->attempt->id])->expectsOutputToContain('tenant_required')->assertExitCode(2);
        $this->artisan('payments:sandbox-evidence', ['attempt' => (string) \Illuminate\Support\Str::uuid(), '--tenant' => 'sandbox-evidence'])->expectsOutputToContain('attempt_not_found')->assertFailed();

        $this->artisan('payments:sandbox-evidence', ['attempt' => 'not-a-uuid', '--tenant' => 'sandbox-evidence'])->expectsOutputToContain('attempt_not_found')->assertFailed();

        DB::table('payment_gateways')->where('id', $this->gateway->id)->update(['environment' => 'live']);
        $this->artisan('payments:sandbox-evidence', ['attempt' => $this->attempt->id, '--tenant' => 'sandbox-evidence', '--fetch' => true])
            ->expectsOutputToContain('sandbox_only')->assertFailed();

        $this->assertSame($before, [DB::table('journal_entries')->count(), DB::table('payment_attempts')->count(), DB::table('payment_provider_events')->count()]);
    }
}
