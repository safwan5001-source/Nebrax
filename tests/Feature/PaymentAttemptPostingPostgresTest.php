<?php

namespace Tests\Feature;

use App\Events\PaymentAttemptCaptured;
use App\Models\Invoice;
use App\Models\InvoicePaymentRequest;
use App\Models\Partner;
use App\Models\PaymentAttempt;
use App\Models\PaymentGateway;
use App\Models\PlatformAdministrator;
use App\Models\Tenant;
use App\Models\User;
use App\Services\Accounting\AccountingPeriodLockService;
use App\Services\Accounting\ChartOfAccountsSeeder;
use App\Services\Accounting\InvoiceService;
use App\Services\Accounting\PaymentService;
use App\Services\FakePaymentGatewayAdapter;
use App\Services\InvoicePaymentRequestService;
use App\Services\PaymentAttemptPostingService;
use App\Services\PaymentOrchestrator;
use App\Support\SchedulerHeartbeat;
use App\Tenancy\TenantContext;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * ═══════════════════════════════════════════════════════════════
 *  PAY-H2-02c — ترحيل الالتقاط تحت تزامن حقيقي (PostgreSQL + `pcntl_fork`)
 * ═══════════════════════════════════════════════════════════════
 *  1) ترحيل متزامن لالتقاط واحد ⇒ سند واحد وقيد واحد، والباقي `already_posted`، بلا جمود.
 *  2) ترحيل زائد متزامن مع سداد خارجي على الفاتورة ⇒ لا تجاوز للمستحق ويتوازن المخصص والفائض مع الملتقط.
 *  3) ترحيل متزامن مع قفل فترة ⇒ الحالة النهائية متّسقة (مرحَّل أو محجوب، لا نصف حالة) بلا جمود.
 *
 *  على PostgreSQL **لا يُتخطّى** إن غاب `pcntl`: يفشل. يُتخطّى على SQLite فقط. بلا RefreshDatabase (الأطفال يحتاجون بيانات مُثبَتة).
 */
class PaymentAttemptPostingPostgresTest extends TestCase
{
    use UsesWorkerDatabaseWithoutTransaction;
    use DiagnosesUnprovenScheduler;

    private string $dir;

    private string $tenantId;

    private string $ownerId;

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
            'pcntl/posix مطلوبان لاختبارات تزامن PostgreSQL؛ غيابهما فشل لا تخطٍّ (PAY-H2-02c).');

        $this->dir = sys_get_temp_dir().'/payment_posting_'.uniqid();
        mkdir($this->dir);

        $tenant = Tenant::create(['name' => 'ترحيل متزامن', 'slug' => 'pay-h2-02c-pg-'.Str::random(8), 'vat_number' => '300000000000013', 'currency' => 'SAR']);
        $this->tenants[] = $this->tenantId = $tenant->id;
        app(TenantContext::class)->set($this->tenantId);
        app(ChartOfAccountsSeeder::class)->seed($this->tenantId);

        $this->ownerId = User::create(['tenant_id' => $this->tenantId, 'name' => 'المالك', 'email' => Str::random(8).'@pay.test', 'password' => 'password123', 'role' => 'owner'])->id;
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
    public function concurrent_posting_of_one_capture_creates_one_voucher_and_one_entry(): void
    {
        [$attemptId, $invoiceId] = $this->capturedPendingAttempt();

        $results = $this->runConcurrently(array_fill(0, 6, $this->processor($attemptId)));

        $this->assertAllOk($results);
        $outcomes = array_column(array_column($results, 'value'), 'outcome');
        $this->assertSame(1, count(array_filter($outcomes, fn ($o) => $o === 'posted')), 'ترحيل واحد فعلي');
        foreach ($outcomes as $o) {
            $this->assertContains($o, ['posted', 'already_posted']);
        }
        $this->assertSame(1, DB::table('payments')->where('tenant_id', $this->tenantId)->where('payment_gateway_id', $this->gatewayId)->count());
        $this->assertSame(1, DB::table('payment_attempt_postings')->where('payment_attempt_id', $attemptId)->count());
        $this->assertSame(1, DB::table('journal_entries')->where('tenant_id', $this->tenantId)->where('source_type', \App\Models\Payment::class)->count());
        $invoice = DB::table('invoices')->where('id', $invoiceId)->first();
        $this->assertSame((int) $invoice->total, (int) $invoice->paid_amount);
        $this->assertSame('posted', DB::table('payment_attempts')->where('id', $attemptId)->value('posting_status'));
    }

    /** @test */
    public function posting_an_overpaid_capture_concurrently_with_an_external_payment_never_exceeds_the_invoice(): void
    {
        [$attemptId, $invoiceId] = $this->capturedPendingAttempt();

        $jobs = [$this->processor($attemptId), $this->processor($attemptId), $this->externalPayer($invoiceId, 20000), $this->processor($attemptId)];
        $results = $this->runConcurrently($jobs);

        $this->assertAllOk($results);
        $invoice = DB::table('invoices')->where('id', $invoiceId)->first();
        $this->assertLessThanOrEqual((int) $invoice->total, (int) $invoice->paid_amount, 'لا تجاوز للمستحق');
        $postings = DB::table('payment_attempt_postings')->where('payment_attempt_id', $attemptId)->get();
        $this->assertLessThanOrEqual(2, $postings->count());
        $this->assertSame(115000, (int) $postings->sum('amount_minor'), 'المخصص + الفائض = الملتقط تماماً');
        $allocated = (int) DB::table('payment_allocations')->whereIn('payment_id', $postings->pluck('payment_id'))->sum('amount');
        $this->assertSame((int) $postings->where('role', 'allocated')->sum('amount_minor'), $allocated);
        foreach ($postings->where('role', 'excess') as $excess) {
            $this->assertSame(0, DB::table('payment_allocations')->where('payment_id', $excess->payment_id)->count());
        }
    }

    /** @test */
    public function posting_racing_a_period_lock_ends_either_posted_or_blocked_never_half(): void
    {
        [$attemptId, $invoiceId] = $this->capturedPendingAttempt();
        $tenant = $this->tenantId;
        $owner = $this->ownerId;
        $locker = function () use ($tenant, $owner) {
            app(TenantContext::class)->set($tenant);
            $lock = app(AccountingPeriodLockService::class)->create(now('UTC')->startOfMonth()->toDateString(), now('UTC')->endOfMonth()->toDateString(), 'إقفال متزامن', User::query()->findOrFail($owner));

            return ['lock' => $lock['id']];
        };

        $results = $this->runConcurrently([$this->processor($attemptId), $locker, $this->processor($attemptId)]);

        $this->assertAllOk($results);
        $attempt = DB::table('payment_attempts')->where('id', $attemptId)->first();
        $payments = DB::table('payments')->where('tenant_id', $this->tenantId)->where('payment_gateway_id', $this->gatewayId)->count();
        $invoice = DB::table('invoices')->where('id', $invoiceId)->first();
        if ($attempt->posting_status === 'posted') {
            $this->assertSame(1, $payments);
            $this->assertSame((int) $invoice->total, (int) $invoice->paid_amount);
        } else {
            $this->assertSame('blocked_period', $attempt->posting_status);
            $this->assertSame(0, $payments);
            $this->assertSame(0, (int) $invoice->paid_amount);
            $this->assertNotNull($attempt->posting_blocked_reason);
        }
    }

    // ═══════════════ أدوات ═══════════════

    /** فاتورة مرحَّلة + طلب + محاولة التقطها المزوّد (بلا ترحيل: الحدث موقوف) ⇒ [attemptId, invoiceId]. */
    private function capturedPendingAttempt(): array
    {
        $invoices = app(InvoiceService::class);
        $invoice = $invoices->post($invoices->create(
            ['partner_id' => $this->customerId, 'payment_type' => 'credit'],
            [['quantity' => 1, 'unit_price' => 100000, 'tax_rate' => 15]],
        ));
        $owner = User::query()->findOrFail($this->ownerId);
        $request = app(InvoicePaymentRequestService::class)->create($invoice, PaymentGateway::query()->findOrFail($this->gatewayId), $owner);
        $attempt = app(InvoicePaymentRequestService::class)->startAttempt($request, 'idem-pg-'.Str::random(8), null, $owner);
        app(FakePaymentGatewayAdapter::class)->script($attempt->provider_payment_id, 'captured');
        Event::fake([PaymentAttemptCaptured::class]);
        app(PaymentOrchestrator::class)->sync($attempt);
        $this->assertSame(PaymentAttempt::POSTING_PENDING, $attempt->fresh()->posting_status);

        return [$attempt->id, $invoice->id];
    }

    private function processor(string $attemptId): callable
    {
        $tenant = $this->tenantId;

        return function () use ($attemptId, $tenant) {
            app(TenantContext::class)->set($tenant);
            $attempt = PaymentAttempt::query()->findOrFail($attemptId);

            return ['outcome' => app(PaymentAttemptPostingService::class)->process($attempt)];
        };
    }

    private function externalPayer(string $invoiceId, int $amount): callable
    {
        $tenant = $this->tenantId;
        $partner = $this->customerId;

        return function () use ($invoiceId, $amount, $tenant, $partner) {
            app(TenantContext::class)->set($tenant);
            $payments = app(PaymentService::class);
            try {
                $payments->post($payments->create(['partner_id' => $partner, 'amount' => $amount, 'direction' => 'received', 'method' => 'cash', 'invoice_id' => $invoiceId]));
            } catch (\RuntimeException $e) {
                // سبقه ترحيل البوابة فاستنفد المتبقي: الرفض هو السلوك الصحيح (لا تجاوز للمستحق).
                return ['rejected' => $e->getMessage()];
            }

            return ['paid' => $amount];
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
