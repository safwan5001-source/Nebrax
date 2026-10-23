<?php

namespace Tests\Feature;

use App\Models\CreditNote;
use App\Models\Partner;
use App\Models\PaymentAttempt;
use App\Models\PaymentGateway;
use App\Models\PaymentRefund;
use App\Models\PlatformAdministrator;
use App\Models\Tenant;
use App\Models\User;
use App\Services\Accounting\CashBankAccountService;
use App\Services\Accounting\ChartOfAccountsSeeder;
use App\Services\Accounting\CreditNoteService;
use App\Services\Accounting\CustomerRefundService;
use App\Services\Accounting\InvoiceService;
use App\Services\FakePaymentGatewayAdapter;
use App\Services\InvoicePaymentRequestService;
use App\Services\PaymentOrchestrator;
use App\Services\PaymentRefundService;
use App\Support\PaymentRefundException;
use App\Support\SchedulerHeartbeat;
use App\Support\Settings;
use App\Tenancy\TenantContext;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * ═══════════════════════════════════════════════════════════════
 *  PAY-H3-01b — استرداد البوابة تحت تزامن حقيقي (PostgreSQL + `pcntl_fork`)
 * ═══════════════════════════════════════════════════════════════
 *  1) اعتماد متزامن لاسترداد واحد ⇒ اعتماد واحد وحدث واحد.
 *  2) إرسال متزامن لاسترداد واحد ⇒ فائز واحد وسجل استدعاء واحد (الباقي حالة غير مشروعة، لا إرسال ثانٍ).
 *  3) طلبان متزامنان يتجاوزان معاً متبقي الدفعة ⇒ ينجح واحد (قفل صف المحاولة).
 *  4) استرداد بوابة واسترداد نقدي متزامنان على إشعار دائن واحد ⇒ لا يتجاوزان رصيد المصدر (الدالة المشتركة + أقفال المصادر).
 *  5) المفتاح نفسه من عدة عمليات ⇒ مستند واحد.
 *
 *  لا حالة محاكٍ مشتركة بين العمليات الفرعية، فلا يُختبر هنا تزامن المزوّد (سباقه محكوم بالفهرس الجزئي الفريد وبالتسلسل في اختبار SQLite/PG العادي).
 *  على PostgreSQL **لا يُتخطّى** إن غاب `pcntl`: يفشل. يُتخطّى على SQLite فقط.
 */
class PaymentRefundPostgresTest extends TestCase
{
    use DiagnosesUnprovenScheduler;
    use UsesWorkerDatabaseWithoutTransaction;

    private string $dir;

    private string $tenantId;

    private string $ownerId;

    private string $adminId;

    private string $gatewayId;

    private string $customerId;

    /** @var list<string> */
    private array $tenants = [];

    /** @var list<string> */
    private array $admins = [];

    protected function setUp(): void
    {
        parent::setUp();

        if (DB::connection()->getDriverName() !== 'pgsql') {
            $this->markTestSkipped('يتطلب PostgreSQL حقيقياً — SQLite لا يُظهر تنافساً على أقفال الصفوف.');
        }
        $this->assertTrue(function_exists('pcntl_fork') && function_exists('posix_kill'),
            'pcntl/posix مطلوبان لاختبارات تزامن PostgreSQL؛ غيابهما فشل لا تخطٍّ (PAY-H3-01b).');

        $this->dir = sys_get_temp_dir().'/payment_refund_'.uniqid();
        mkdir($this->dir);

        $tenant = Tenant::create(['name' => 'استرداد متزامن', 'slug' => 'pay-h3-01b-pg-'.Str::random(8), 'vat_number' => '300000000000013', 'currency' => 'SAR']);
        $this->tenants[] = $this->tenantId = $tenant->id;
        app(TenantContext::class)->set($this->tenantId);
        app(ChartOfAccountsSeeder::class)->seed($this->tenantId);
        app(CashBankAccountService::class)->bootstrapDefaults();
        Settings::put('sales', ['allow_standalone_credit_notes' => true], $tenant);

        $this->ownerId = User::create(['tenant_id' => $this->tenantId, 'name' => 'المالك', 'email' => Str::random(8).'@pay.test', 'password' => 'password123', 'role' => 'owner'])->id;
        $this->adminId = User::create(['tenant_id' => $this->tenantId, 'name' => 'المدير', 'email' => Str::random(8).'@pay.test', 'password' => 'password123', 'role' => 'admin'])->id;
        $this->customerId = Partner::create(['name' => 'عميل', 'type' => 'customer'])->id;
        $admin = PlatformAdministrator::create(['name' => 'مشغّل', 'email' => Str::random(8).'@platform.test', 'password' => 'platform-password-123']);
        $this->admins[] = $admin->id;
        SchedulerHeartbeat::record();
        $this->enableTenantPaymentsOrDiagnose($admin, $this->tenantId, 'تفعيل اختبار التزامن');

        $gateway = PaymentGateway::query()->create(['provider' => 'fake', 'name' => 'Fake', 'environment' => 'sandbox']);
        DB::table('payment_gateways')->where('id', $gateway->id)->update(['status' => 'active', 'is_active' => true]);
        $this->gatewayId = $gateway->id;
        app()->singleton(FakePaymentGatewayAdapter::class);
    }

    protected function tearDown(): void
    {
        if (isset($this->dir) && is_dir($this->dir)) {
            foreach (glob($this->dir.'/*') ?: [] as $f) {
                @unlink($f);
            }
            @rmdir($this->dir);
        }
        if (DB::connection()->getDriverName() === 'pgsql') {
            foreach ($this->tenants as $id) {
                DB::table('tenants')->where('id', $id)->delete();
            }
            foreach ($this->admins as $id) {
                DB::table('platform_administrators')->where('id', $id)->delete();
            }
            DB::table('platform_runtime_heartbeats')->where('component', SchedulerHeartbeat::COMPONENT)->delete();
        }

        parent::tearDown();
    }

    /** @test */
    public function concurrent_approvals_of_one_refund_record_a_single_approval(): void
    {
        [$attemptId, $noteId] = $this->capturedAttemptAndNote();
        $refundId = $this->requestRefund($attemptId, $noteId, 50000, 'idem-pg-appr-'.Str::random(6));

        $results = $this->runConcurrently(array_fill(0, 5, $this->approver($refundId)));

        $this->assertAllOk($results);
        $outcomes = array_column(array_column($results, 'value'), 'outcome');
        $this->assertSame(1, count(array_filter($outcomes, fn ($o) => $o === 'approved')), 'اعتماد واحد فعلي');
        $this->assertSame('approved', DB::table('payment_refunds')->where('id', $refundId)->value('status'));
        $this->assertSame(1, DB::table('payment_refund_events')->where('payment_refund_id', $refundId)->where('action', 'approved')->count());
    }

    /** @test */
    public function concurrent_submissions_of_one_approved_refund_reach_the_provider_once(): void
    {
        [$attemptId, $noteId] = $this->capturedAttemptAndNote();
        $refundId = $this->requestRefund($attemptId, $noteId, 50000, 'idem-pg-subm-'.Str::random(6), approve: true);

        $results = $this->runConcurrently(array_fill(0, 5, $this->submitter($refundId)));

        $this->assertAllOk($results);
        $outcomes = array_column(array_column($results, 'value'), 'outcome');
        $this->assertSame(1, count(array_filter($outcomes, fn ($o) => $o === 'confirmed')), 'إرسال واحد فعلي');
        foreach ($outcomes as $o) {
            $this->assertContains($o, ['confirmed', 'invalid_state', 'busy']);
        }
        $this->assertSame(1, DB::table('payment_refund_attempts')->where('payment_refund_id', $refundId)->count());
        $this->assertSame(1, DB::table('payment_refund_attempt_results')->count());
        $this->assertSame(50000, (int) DB::table('payment_attempts')->where('id', $attemptId)->value('refunded_minor'));
    }

    /** @test */
    public function two_requests_that_together_exceed_the_payment_capacity_cannot_both_succeed(): void
    {
        [$attemptId, $noteA] = $this->capturedAttemptAndNote();
        $noteB = $this->creditNoteId();

        $results = $this->runConcurrently([
            $this->requester($attemptId, $noteA, 75000, 'idem-pg-cap-a-'.Str::random(6)),
            $this->requester($attemptId, $noteB, 75000, 'idem-pg-cap-b-'.Str::random(6)),
        ]);

        $this->assertAllOk($results);
        $outcomes = array_column(array_column($results, 'value'), 'outcome');
        sort($outcomes);
        $this->assertSame(['exceeds_payment_capacity', 'requested'], $outcomes);
        $this->assertSame(1, DB::table('payment_refunds')->where('payment_attempt_id', $attemptId)->count());
    }

    /** @test */
    public function a_gateway_refund_and_a_cash_refund_cannot_both_consume_the_same_credit_note(): void
    {
        [$attemptId, $noteId] = $this->capturedAttemptAndNote();   // إشعار بـ115000
        app(TenantContext::class)->set($this->tenantId);
        $cash = app(CustomerRefundService::class);
        $draft = $cash->create(['partner_id' => $this->customerId, 'amount' => 100000, 'method' => 'cash'], [['source_type' => 'credit_note', 'source_id' => $noteId, 'amount' => 100000]]);
        $draftId = $draft->id;
        $tenant = $this->tenantId;

        $cashPoster = function () use ($draftId, $tenant) {
            app(TenantContext::class)->set($tenant);
            try {
                app(CustomerRefundService::class)->post(\App\Models\CustomerRefund::query()->findOrFail($draftId));

                return ['outcome' => 'cash_posted'];
            } catch (\RuntimeException $e) {
                return ['outcome' => 'cash_rejected'];
            }
        };

        $results = $this->runConcurrently([$this->requester($attemptId, $noteId, 100000, 'idem-pg-src-'.Str::random(6)), $cashPoster]);

        $this->assertAllOk($results);
        $outcomes = array_column(array_column($results, 'value'), 'outcome');
        $this->assertSame(1, count(array_filter($outcomes, fn ($o) => in_array($o, ['requested', 'cash_posted'], true))), 'مستهلِك واحد للمصدر');
        $consumed = (int) DB::table('payment_refund_allocations')->where('source_id', $noteId)->sum('amount_minor')
            + (int) DB::table('customer_refund_allocations')->where('source_id', $noteId)
                ->whereIn('customer_refund_id', DB::table('customer_refunds')->where('status', 'posted')->pluck('id'))->sum('amount');
        $this->assertLessThanOrEqual(115000, $consumed, 'لا تجاوز لرصيد المصدر');
    }

    /** @test */
    public function the_same_idempotency_key_from_many_processes_creates_one_refund(): void
    {
        [$attemptId, $noteId] = $this->capturedAttemptAndNote();
        $key = 'idem-pg-same-'.Str::random(6);

        $results = $this->runConcurrently(array_fill(0, 5, $this->requester($attemptId, $noteId, 30000, $key)));

        $this->assertAllOk($results);
        $this->assertSame(1, DB::table('payment_refunds')->where('idempotency_key', $key)->count());
        foreach (array_column(array_column($results, 'value'), 'outcome') as $o) {
            $this->assertContains($o, ['requested', 'exceeds_payment_capacity', 'exceeds_source_balance']);
        }
    }

    // ═══════════════ أدوات ═══════════════

    /** @return array{0: string, 1: string} [attemptId، creditNoteId] — التقاط مرحَّل بـ115000 وإشعار دائن آجل بـ115000. */
    private function capturedAttemptAndNote(): array
    {
        app(TenantContext::class)->set($this->tenantId);
        $invoices = app(InvoiceService::class);
        $invoice = $invoices->post($invoices->create(
            ['partner_id' => $this->customerId, 'payment_type' => 'credit'],
            [['quantity' => 1, 'unit_price' => 100000, 'tax_rate' => 15]],
        ));
        $owner = User::query()->findOrFail($this->ownerId);
        $request = app(InvoicePaymentRequestService::class)->create($invoice, PaymentGateway::query()->findOrFail($this->gatewayId), $owner);
        $attempt = app(InvoicePaymentRequestService::class)->startAttempt($request, 'idem-pg-'.Str::random(8), null, $owner);
        app(FakePaymentGatewayAdapter::class)->script($attempt->provider_payment_id, 'captured');
        app(PaymentOrchestrator::class)->sync($attempt);
        $this->assertSame(PaymentAttempt::POSTING_POSTED, $attempt->fresh()->posting_status);

        return [$attempt->id, $this->creditNoteId()];
    }

    private function creditNoteId(): string
    {
        $service = app(CreditNoteService::class);
        $note = $service->create(
            ['type' => 'sales', 'partner_id' => $this->customerId, 'refund_type' => 'credit', 'reason' => 'تصحيح تجاري'],
            [['description' => 'تصحيح', 'quantity' => 1, 'unit_price' => 100000, 'tax_rate' => 15]],
        );

        return $service->post($note)->id;
    }

    private function requestRefund(string $attemptId, string $noteId, int $amount, string $key, bool $approve = false): string
    {
        $refund = app(PaymentRefundService::class)->request(
            PaymentAttempt::query()->findOrFail($attemptId), $amount,
            [['source_type' => 'credit_note', 'source_id' => $noteId, 'amount' => $amount]], $key, User::query()->findOrFail($this->ownerId),
        );
        if ($approve) {
            app(PaymentRefundService::class)->approve($refund, User::query()->findOrFail($this->adminId));
        }

        return $refund->id;
    }

    private function requester(string $attemptId, string $noteId, int $amount, string $key): callable
    {
        $tenant = $this->tenantId;
        $owner = $this->ownerId;

        return function () use ($attemptId, $noteId, $amount, $key, $tenant, $owner) {
            app(TenantContext::class)->set($tenant);
            try {
                $refund = app(PaymentRefundService::class)->request(
                    PaymentAttempt::query()->findOrFail($attemptId), $amount,
                    [['source_type' => 'credit_note', 'source_id' => $noteId, 'amount' => $amount]], $key, User::query()->findOrFail($owner),
                );

                return ['outcome' => 'requested', 'id' => $refund->id];
            } catch (PaymentRefundException $e) {
                return ['outcome' => $e->reason];
            }
        };
    }

    private function approver(string $refundId): callable
    {
        $tenant = $this->tenantId;
        $admin = $this->adminId;

        return function () use ($refundId, $tenant, $admin) {
            app(TenantContext::class)->set($tenant);
            try {
                app(PaymentRefundService::class)->approve(PaymentRefund::query()->findOrFail($refundId), User::query()->findOrFail($admin));

                return ['outcome' => 'approved'];
            } catch (PaymentRefundException $e) {
                return ['outcome' => $e->reason];
            }
        };
    }

    private function submitter(string $refundId): callable
    {
        $tenant = $this->tenantId;
        $admin = $this->adminId;

        return function () use ($refundId, $tenant, $admin) {
            app(TenantContext::class)->set($tenant);
            try {
                $done = app(PaymentRefundService::class)->submit(PaymentRefund::query()->findOrFail($refundId), User::query()->findOrFail($admin));

                return ['outcome' => $done->status];
            } catch (PaymentRefundException $e) {
                return ['outcome' => $e->reason];
            }
        };
    }

    private function assertAllOk(array $results): void
    {
        foreach ($results as $i => $result) {
            $this->assertTrue($result['ok'] ?? false, "العملية {$i}: ".($result['error_class'] ?? '').' '.($result['message'] ?? ''));
            $message = (string) ($result['message'] ?? '');
            $this->assertFalse(str_contains($message, '40P01') || stripos($message, 'deadlock') !== false, "جمود في العملية {$i}");
        }
    }

    /** @param  list<callable>  $jobs */
    private function runConcurrently(array $jobs): array
    {
        $barrier = $this->dir.'/barrier_'.uniqid();
        $resultFiles = [];
        $pids = [];

        foreach ($jobs as $i => $job) {
            $resultFiles[$i] = $this->dir.'/result_'.uniqid()."_{$i}";
            $pid = pcntl_fork();
            if ($pid === -1) {
                $this->fail('فشل pcntl_fork.');
            }
            if ($pid === 0) {
                DB::purge(config('database.default'));
                $deadline = microtime(true) + 10.0;
                while (! file_exists($barrier) && microtime(true) < $deadline) {
                    usleep(500);
                }
                try {
                    file_put_contents($resultFiles[$i], json_encode(['ok' => true, 'value' => $job()]));
                } catch (\Throwable $e) {
                    file_put_contents($resultFiles[$i], json_encode(['ok' => false, 'error_class' => get_class($e), 'message' => $e->getMessage()]));
                }
                exit(0);
            }
            $pids[] = $pid;
        }

        touch($barrier);
        foreach ($pids as $pid) {
            pcntl_waitpid($pid, $status);
        }

        $results = [];
        foreach ($resultFiles as $i => $file) {
            $raw = is_file($file) ? file_get_contents($file) : false;
            $results[$i] = json_decode($raw !== false ? $raw : '{"ok":false,"message":"no output"}', true);
        }

        return $results;
    }
}
