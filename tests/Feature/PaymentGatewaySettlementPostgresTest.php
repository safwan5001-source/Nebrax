<?php

namespace Tests\Feature;

use App\Events\PaymentRefundConfirmed;
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
use App\Services\Accounting\PaymentGatewaySettlementService;
use App\Services\FakePaymentGatewayAdapter;
use App\Services\InvoicePaymentRequestService;
use App\Services\PaymentOrchestrator;
use App\Services\PaymentRefundPostingService;
use App\Services\PaymentRefundService;
use App\Support\PaymentRefundException;
use App\Support\SchedulerHeartbeat;
use App\Support\Settings;
use App\Tenancy\TenantContext;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * PAY-H3-02b — تسوية البوابة تحت تزامن حقيقي (PostgreSQL + `pcntl_fork`):
 *  1) تسويتان بمرجعين مختلفين تخصمان الاسترداد نفسه كاملاً ⇒ واحدة تُرحَّل والأخرى تُرفض (قفل صف الاسترداد + قاعدة الاستهلاك).
 *  2) المرجع نفسه من عدة عمليات ⇒ تسوية واحدة وقيد واحد.
 *  3) تسويتان تستهلكان معاً أكثر من متبقي السند ⇒ واحدة فقط.
 *  4) تسوية وترحيل A5 متزامنان لاسترداد آخر ⇒ لا جمود (ترتيب الأقفال: بوابة ← سندات ← استردادات ← مِرساة).
 * على PostgreSQL **لا يُتخطّى** إن غاب `pcntl`: يفشل. يُتخطّى على SQLite فقط.
 */
class PaymentGatewaySettlementPostgresTest extends TestCase
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
    public function two_settlements_cannot_both_deduct_the_same_refund(): void
    {
        [$attemptA, $paymentA] = $this->capturedAttempt();
        [, $paymentB] = $this->capturedAttempt();
        $refundId = $this->postedRefund($attemptA, 46000);

        $results = $this->runConcurrently([
            $this->settler($paymentA, 115000, [$refundId => 46000], 67400, 1600, 'PG-A6-A'),
            $this->settler($paymentB, 115000, [$refundId => 46000], 67400, 1600, 'PG-A6-B'),
        ]);

        $this->assertAllOk($results);
        $outcomes = array_column(array_column($results, 'value'), 'outcome');
        sort($outcomes);
        $this->assertSame(['posted', 'rejected'], $outcomes);
        $this->assertSame(1, DB::table('payment_gateway_settlements')->where('status', 'posted')->count());
        $this->assertLessThanOrEqual(46000, (int) DB::table('payment_gateway_settlement_lines')->where('payment_refund_id', $refundId)->sum('amount_minor'));
    }

    /** @test */
    public function the_same_reference_from_many_processes_creates_one_settlement_and_one_entry(): void
    {
        [, $payment] = $this->capturedAttempt();
        $jobs = array_fill(0, 5, $this->settler($payment, 115000, [], 113400, 1600, 'PG-SAME'));

        $results = $this->runConcurrently($jobs);

        $this->assertAllOk($results);
        $this->assertSame(1, DB::table('payment_gateway_settlements')->where('provider_settlement_ref', 'PG-SAME')->count());
        $this->assertSame(1, DB::table('journal_entries')->where('tenant_id', $this->tenantId)->where('source_type', \App\Models\PaymentGatewaySettlement::class)->count());
        foreach (array_column(array_column($results, 'value'), 'outcome') as $o) {
            $this->assertSame('posted', $o, 'التكرار الآمن يعيد التسوية نفسها');
        }
    }

    /** @test */
    public function two_settlements_cannot_together_consume_more_than_a_payments_remaining_amount(): void
    {
        [, $payment] = $this->capturedAttempt();

        $results = $this->runConcurrently([
            $this->settler($payment, 100000, [], 98000, 2000, 'PG-REM-A'),
            $this->settler($payment, 100000, [], 98000, 2000, 'PG-REM-B'),
        ]);

        $this->assertAllOk($results);
        $outcomes = array_column(array_column($results, 'value'), 'outcome');
        sort($outcomes);
        $this->assertSame(['posted', 'rejected'], $outcomes);
        $this->assertLessThanOrEqual(115000, (int) DB::table('payment_gateway_settlement_items')->where('payment_id', $payment)->sum('gross_amount'));
    }

    /** @test */
    public function a_settlement_and_a_refund_posting_run_together_without_deadlock(): void
    {
        [$attemptA, $paymentA] = $this->capturedAttempt();
        [$attemptB] = $this->capturedAttempt();
        $refundA = $this->postedRefund($attemptA, 46000);
        \Illuminate\Support\Facades\Event::fake([PaymentRefundConfirmed::class]);
        $refundB = $this->confirmedRefund($attemptB, 20000);
        $tenant = $this->tenantId;
        $poster = function () use ($refundB, $tenant) {
            app(TenantContext::class)->set($tenant);

            return ['outcome' => app(PaymentRefundPostingService::class)->process(PaymentRefund::query()->findOrFail($refundB))];
        };

        $results = $this->runConcurrently([$this->settler($paymentA, 115000, [$refundA => 46000], 67400, 1600, 'PG-DL'), $poster]);

        $this->assertAllOk($results);
        $outcomes = array_column(array_column($results, 'value'), 'outcome');
        $this->assertContains('posted', $outcomes);
        $this->assertSame('posted', DB::table('payment_refunds')->where('id', $refundB)->value('posting_status'));
        $this->assertSame(1, DB::table('payment_gateway_settlements')->where('status', 'posted')->count());
    }

    /** @test */
    public function two_settlements_cannot_both_consume_the_same_approved_adjustment(): void
    {
        [, $paymentA] = $this->capturedAttempt();
        [, $paymentB] = $this->capturedAttempt();
        $adjustmentId = $this->approvedAdjustment('reserve_hold', 10000);

        $extra = ['adjustments' => [['adjustment_id' => $adjustmentId]]];
        $results = $this->runConcurrently([
            $this->settler($paymentA, 115000, [], 103400, 1600, 'PG-ADJ-A', $extra),
            $this->settler($paymentB, 115000, [], 103400, 1600, 'PG-ADJ-B', $extra),
        ]);

        $this->assertAllOk($results);
        $outcomes = array_column(array_column($results, 'value'), 'outcome');
        sort($outcomes);
        $this->assertSame(['posted', 'rejected'], $outcomes);
        $this->assertSame(1, DB::table('payment_gateway_settlement_lines')->where('adjustment_id', $adjustmentId)->count());
        $this->assertSame('consumed', DB::table('payment_gateway_adjustments')->where('id', $adjustmentId)->value('status'));
        $this->assertSame(1, DB::table('payment_gateway_adjustment_events')->where('adjustment_id', $adjustmentId)->where('action', 'consumed')->count());
    }

    /** @test */
    public function concurrent_approvals_of_one_adjustment_record_a_single_approval_and_never_by_the_requester(): void
    {
        app(TenantContext::class)->set($this->tenantId);
        $adj = app(\App\Services\PaymentGatewayAdjustmentService::class)->request(
            PaymentGateway::query()->findOrFail($this->gatewayId), 'adjustment_debit', 500, 'تعديل موثّق من الكشف', 'STMT-PG-1', null, User::query()->findOrFail($this->ownerId),
        );
        $tenant = $this->tenantId;
        $approver = function (string $userId) use ($adj, $tenant) {
            return function () use ($adj, $tenant, $userId) {
                app(TenantContext::class)->set($tenant);
                try {
                    app(\App\Services\PaymentGatewayAdjustmentService::class)->approve(\App\Models\PaymentGatewayAdjustment::query()->findOrFail($adj->id), User::query()->findOrFail($userId));

                    return ['outcome' => 'approved'];
                } catch (\App\Support\GatewayAdjustmentException $e) {
                    return ['outcome' => $e->reason];
                }
            };
        };

        $results = $this->runConcurrently([$approver($this->adminId), $approver($this->adminId), $approver($this->ownerId)]);

        $this->assertAllOk($results);
        $outcomes = array_column(array_column($results, 'value'), 'outcome');
        $this->assertSame(1, count(array_filter($outcomes, fn ($o) => $o === 'approved')));
        // الطالب لا يعتمد أبداً: يخسر السباق إما بـself_approval أو بـinvalid_state إن سبقه معتمِد (كلاهما رفض صحيح؛ الاعتماد الذاتي المحدد يُختبر حتمياً في PaymentGatewayAdjustmentTest)
        $this->assertSame(2, count(array_filter($outcomes, fn ($o) => in_array($o, ['self_approval', 'invalid_state'], true))));
        $this->assertSame($this->adminId, DB::table('payment_gateway_adjustments')->where('id', $adj->id)->value('approved_by'));
    }

    private function approvedAdjustment(string $kind, int $amount): string
    {
        app(TenantContext::class)->set($this->tenantId);
        $svc = app(\App\Services\PaymentGatewayAdjustmentService::class);
        $adj = $svc->request(PaymentGateway::query()->findOrFail($this->gatewayId), $kind, $amount, 'تعديل موثّق من الكشف', 'STMT-'.Str::random(6), null, User::query()->findOrFail($this->ownerId));

        return $svc->approve($adj, User::query()->findOrFail($this->adminId))->id;
    }

    // ═══════════════ أدوات ═══════════════

    private function settler(string $paymentId, int $gross, array $refunds, int $net, int $fee, string $ref, array $extra = []): callable
    {
        $tenant = $this->tenantId;
        $gateway = $this->gatewayId;

        return function () use ($paymentId, $gross, $refunds, $net, $fee, $ref, $extra, $tenant, $gateway) {
            app(TenantContext::class)->set($tenant);
            $bank = \App\Models\CashBankAccount::query()->where('type', 'bank')->where('is_main', true)->firstOrFail();
            try {
                $settlement = app(PaymentGatewaySettlementService::class)->record([
                    'payment_gateway_id' => $gateway, 'cash_bank_account_id' => $bank->id, 'provider_settlement_ref' => $ref, 'settlement_date' => now()->toDateString(),
                    'net_bank_amount' => $net, 'provider_fee_ex_tax' => $fee,
                    'items' => [['payment_id' => $paymentId, 'gross_amount' => $gross]],
                    'refunds' => collect($refunds)->map(fn ($amount, $id) => ['payment_refund_id' => $id, 'amount_minor' => $amount])->values()->all(),
                ] + $extra, User::query()->where('role', 'owner')->where('tenant_id', $tenant)->firstOrFail());

                return ['outcome' => $settlement->status];
            } catch (\DomainException $e) {
                return ['outcome' => 'rejected', 'message' => $e->getMessage()];
            }
        };
    }

    /** @return array{0: string, 1: string} [attemptId، paymentId] — التقاط مرحَّل بـ115000. */
    private function capturedAttempt(): array
    {
        app(TenantContext::class)->set($this->tenantId);
        $invoices = app(InvoiceService::class);
        $invoice = $invoices->post($invoices->create(
            ['partner_id' => $this->customerId, 'payment_type' => 'credit'],
            [['quantity' => 1, 'unit_price' => 100000, 'tax_rate' => 15]],
        ));
        $owner = User::query()->findOrFail($this->ownerId);
        $request = app(InvoicePaymentRequestService::class)->create($invoice, PaymentGateway::query()->findOrFail($this->gatewayId), $owner);
        $attempt = app(InvoicePaymentRequestService::class)->startAttempt($request, 'idem-pgs-'.Str::random(8), null, $owner);
        app(FakePaymentGatewayAdapter::class)->script($attempt->provider_payment_id, 'captured');
        app(PaymentOrchestrator::class)->sync($attempt);
        $this->assertSame(PaymentAttempt::POSTING_POSTED, $attempt->fresh()->posting_status);

        return [$attempt->id, (string) \App\Models\PaymentAttemptPosting::query()->where('payment_attempt_id', $attempt->id)->value('payment_id')];
    }

    private function confirmedRefund(string $attemptId, int $amount): string
    {
        app(TenantContext::class)->set($this->tenantId);
        $service = app(CreditNoteService::class);
        $note = $service->post($service->create(
            ['type' => 'sales', 'partner_id' => $this->customerId, 'refund_type' => 'credit', 'reason' => 'تصحيح تجاري'],
            [['description' => 'تصحيح', 'quantity' => 1, 'unit_price' => 100000, 'tax_rate' => 15]],
        ));
        $refunds = app(PaymentRefundService::class);
        $refund = $refunds->request(PaymentAttempt::query()->findOrFail($attemptId), $amount, [['source_type' => 'credit_note', 'source_id' => $note->id, 'amount' => $amount]], 'idem-pgr-'.Str::random(8), User::query()->findOrFail($this->ownerId));
        $done = $refunds->submit($refunds->approve($refund, User::query()->findOrFail($this->adminId)), User::query()->findOrFail($this->adminId));
        $this->assertSame('confirmed', $done->status);

        return $done->id;
    }

    private function postedRefund(string $attemptId, int $amount): string
    {
        \Illuminate\Support\Facades\Event::fake([PaymentRefundConfirmed::class]);
        $id = $this->confirmedRefund($attemptId, $amount);
        $this->assertSame('posted', app(PaymentRefundPostingService::class)->process(PaymentRefund::query()->findOrFail($id)));

        return $id;
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
