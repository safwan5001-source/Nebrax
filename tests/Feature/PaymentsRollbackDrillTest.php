<?php

namespace Tests\Feature;

use App\Events\PaymentRefundConfirmed;
use App\Models\PaymentConnectionEvent;
use App\Services\PaymentGatewayService;
use App\Support\PaymentGatewayException;
use App\Models\AccountRoleMapping;
use App\Models\PaymentGatewayAdjustment;
use App\Models\PaymentGatewayAdjustmentEvent;
use App\Services\PaymentGatewayAdjustmentService;
use App\Support\GatewayAdjustmentException;
use RuntimeException;
use App\Models\CreditNote;
use App\Models\JournalEntry;
use App\Models\Partner;
use App\Models\PaymentAttempt;
use App\Models\PaymentGateway;
use App\Models\PaymentGatewaySettlement;
use App\Models\PaymentGatewaySettlementLine;
use App\Models\PaymentRefund;
use App\Models\PlatformAdministrator;
use App\Models\Tenant;
use App\Models\User;
use App\Services\Accounting\CashBankAccountService;
use App\Services\Accounting\ChartOfAccountsSeeder;
use App\Services\Accounting\CreditNoteService;
use App\Services\Accounting\CustomerRefundService;
use App\Services\Accounting\InvoiceService;
use App\Services\Accounting\PaymentGatewaySettlementService;
use App\Services\FakePaymentGatewayAdapter;
use App\Services\InvoicePaymentRequestService;
use App\Services\PaymentOrchestrator;
use App\Services\PaymentRefundPostingService;
use App\Services\PaymentRefundService;
use App\Services\PaymentsRolloutControlService;
use App\Support\SchedulerHeartbeat;
use App\Support\Settings;
use App\Tenancy\TenantContext;
use DomainException;
use Illuminate\Database\QueryException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Str;
use PHPUnit\Framework\Attributes\Test;
use Tests\TestCase;


/**
 * PAY-H8-03 — تدريب التراجع (بيئة اختبار غير إنتاجية): إيقاف طارئ للمنصة ← إطفاء ضابط المستأجر ← إيقاف الاتصال ← الاستعادة.
 * يثبت أن الإيقاف يمنع الجديد فقط، وأن المرحَّل والدفتر لا يتغيران، وأن المطابقة تبقى متاحة، وأن الاستعادة نظيفة.
 */
class PaymentsRollbackDrillTest extends TestCase
{
    use CapturesThrowable;
    use InteractsWithApi;
    use RefreshDatabase;

    private Tenant $tenant;

    private User $owner;

    private User $admin;

    private string $ownerToken;

    private Partner $customer;

    private PaymentGateway $gateway;

    private FakePaymentGatewayAdapter $fake;

    private PlatformAdministrator $platform;

    private PaymentGatewaySettlementService $settlements;

    protected function setUp(): void
    {
        parent::setUp();
        $this->travelTo(now('UTC')->setDate(2026, 10, 23)->setTime(9, 0));
        $this->tenant = Tenant::create(['name' => 'شركة H8-03', 'slug' => 'pay-h8-03', 'vat_number' => '300000000000013', 'currency' => 'SAR']);
        app(TenantContext::class)->set($this->tenant->id);
        app(ChartOfAccountsSeeder::class)->seed($this->tenant->id);
        app(CashBankAccountService::class)->bootstrapDefaults();
        Settings::put('sales', ['allow_standalone_credit_notes' => true], $this->tenant);
        $this->owner = User::create(['tenant_id' => $this->tenant->id, 'name' => 'المالك', 'email' => 'owner@pay-h8-03.test', 'password' => 'password123', 'role' => 'owner']);
        $this->admin = User::create(['tenant_id' => $this->tenant->id, 'name' => 'المدير', 'email' => 'admin@pay-h8-03.test', 'password' => 'password123', 'role' => 'admin']);
        $this->ownerToken = $this->owner->createToken('t')->plainTextToken;
        $this->customer = Partner::create(['name' => 'عميل', 'type' => 'customer']);
        $this->platform = PlatformAdministrator::create(['name' => 'مشغّل', 'email' => 'ops@pay-h8-03.test', 'password' => 'platform-password-123']);
        SchedulerHeartbeat::record();
        $this->app->singleton(FakePaymentGatewayAdapter::class);
        $this->fake = app(FakePaymentGatewayAdapter::class);
        $gateway = PaymentGateway::query()->create(['provider' => 'fake', 'name' => 'Fake', 'environment' => 'sandbox']);
        DB::table('payment_gateways')->where('id', $gateway->id)->update(['status' => PaymentGateway::STATUS_ACTIVE, 'is_active' => true]);
        $this->gateway = $gateway->fresh();
        app(PaymentsRolloutControlService::class)->setTenantState($this->platform, $this->tenant->id, true, 'تفعيل للاختبار');
        $this->settlements = app(PaymentGatewaySettlementService::class);
    }


    #[Test]
    public function the_rollback_drill_stops_new_payments_keeps_posted_money_intact_and_resumes_cleanly(): void
    {
        // 0) قبل التدريب: التقاط مرحَّل ورصيد المقاصة
        [$attempt] = $this->capture();
        $invoice = app(InvoiceService::class)->post(app(InvoiceService::class)->create(
            ['partner_id' => $this->customer->id, 'payment_type' => 'credit'],
            [['quantity' => 1, 'unit_price' => 50000, 'tax_rate' => 15]],
        ));
        $requests = app(InvoicePaymentRequestService::class);
        $ledgerBefore = [JournalEntry::query()->count(), $this->balance('1170'), $this->balance('1130')];

        // 1) إيقاف طارئ من المنصة ⇒ لا طلب دفع جديد، ولا أثر على المرحَّل
        app(PaymentsRolloutControlService::class)->setPlatformState($this->platform, false, 'تدريب التراجع: إيقاف طارئ');
        $e = $this->thrown(fn () => $requests->create($invoice, $this->gateway, $this->owner), 'platform stop', \App\Support\PaymentOrchestrationException::class);
        $this->assertSame('platform_stop', $e->reason);
        $this->assertSame($ledgerBefore, [JournalEntry::query()->count(), $this->balance('1170'), $this->balance('1130')]);
        $this->assertSame('captured', $attempt->fresh()->capture_status);
        // المطابقة المحاسبية تبقى متاحة أثناء الإيقاف (قراءة): المقاصة تساوي المستندات
        $this->assertSame('reconciled', app(\App\Services\Accounting\PaymentClearingReportService::class)->reconcile()['status']);

        // 2) رفع الإيقاف ثم إطفاء ضابط المستأجر ⇒ rollout_disabled
        app(PaymentsRolloutControlService::class)->setPlatformState($this->platform, true, 'تدريب التراجع: رفع الإيقاف');
        app(PaymentsRolloutControlService::class)->setTenantState($this->platform, $this->tenant->id, false, 'تدريب التراجع: إطفاء المستأجر');
        $e = $this->thrown(fn () => $requests->create($invoice, $this->gateway, $this->owner), 'tenant off', \App\Support\PaymentOrchestrationException::class);
        $this->assertSame('rollout_disabled', $e->reason);

        // 3) إيقاف الاتصال نفسه (suspend) ثم الاستعادة: التفعيل من جديد يعيد القدرة دون مساس بالمرحَّل
        app(PaymentsRolloutControlService::class)->setTenantState($this->platform, $this->tenant->id, true, 'تدريب التراجع: استعادة المستأجر');
        \Illuminate\Support\Facades\DB::table('payment_gateways')->where('id', $this->gateway->id)->update(['verified_at' => now('UTC')]);   // اتصال تحقق منه المالك سابقاً
        $this->withToken($this->ownerToken)->postJson("/api/payment-gateways/{$this->gateway->id}/suspend", ['reason' => 'تدريب التراجع: إيقاف الاتصال'])->assertOk();
        $this->assertSame('suspended', $this->gateway->fresh()->status);
        $this->thrown(fn () => $requests->startAttempt($requests->create($invoice, $this->gateway->fresh(), $this->owner), 'idem-drill', null, $this->owner), 'gateway suspended', \Throwable::class);

        $act = $this->withToken($this->ownerToken)->postJson("/api/payment-gateways/{$this->gateway->id}/activate", ['reason' => 'تدريب التراجع: استعادة الاتصال']);
        $act->assertOk();
        $request = $requests->create($invoice, $this->gateway->fresh(), $this->owner);
        $this->assertNotNull($request->id, 'القدرة عادت بعد الاستعادة');
        $this->assertSame($ledgerBefore, [JournalEntry::query()->count(), $this->balance('1170'), $this->balance('1130')], 'لا قيد من التدريب كله');
    }

    private function balance(string $code): int
    {
        $row = DB::table('journal_lines')
            ->join('accounts', 'accounts.id', '=', 'journal_lines.account_id')
            ->where('journal_lines.tenant_id', $this->tenant->id)
            ->where('accounts.code', $code)
            ->selectRaw('COALESCE(SUM(journal_lines.debit),0) as d, COALESCE(SUM(journal_lines.credit),0) as c')->first();

        return (int) $row->d - (int) $row->c;
    }

    /** @return array{0: PaymentAttempt, 1: string} الالتقاط الملتقَط المرحَّل (A1) ومعرّف سند القبض. */
    private function capture(): array
    {
        $invoice = app(InvoiceService::class)->post(app(InvoiceService::class)->create(
            ['partner_id' => $this->customer->id, 'payment_type' => 'credit'],
            [['quantity' => 1, 'unit_price' => 100000, 'tax_rate' => 15]],
        ));
        $requests = app(InvoicePaymentRequestService::class);
        $request = $requests->create($invoice, $this->gateway, $this->owner);
        $attempt = $requests->startAttempt($request, 'idem-cap-'.uniqid(), null, $this->owner);
        $this->fake->script($attempt->provider_payment_id, 'captured');
        app(PaymentOrchestrator::class)->sync($attempt);
        $attempt = $attempt->fresh();
        $this->assertSame(PaymentAttempt::POSTING_POSTED, $attempt->posting_status);
        $paymentId = \App\Models\PaymentAttemptPosting::query()->where('payment_attempt_id', $attempt->id)->value('payment_id');
        $this->assertNotNull($paymentId);

        return [$attempt, (string) $paymentId];
    }

}
