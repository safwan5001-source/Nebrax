<?php

namespace Tests\Feature;

use App\Models\JournalEntry;
use App\Models\Payment;
use App\Models\PaymentAttempt;
use App\Models\PaymentGateway;
use App\Models\PlatformAdministrator;
use App\Models\PlatformRuntimeHeartbeat;
use App\Models\Tenant;
use App\Models\User;
use App\Services\FakePaymentGatewayAdapter;
use App\Services\PaymentAttemptReconciler;
use App\Services\PaymentOrchestrator;
use App\Services\PaymentsRolloutControlService;
use App\Support\SchedulerHeartbeat;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use PHPUnit\Framework\Attributes\Test;
use Tests\TestCase;

/** PAY-H1-04 — المطابِق المجدول: التقاط المتعثّر، الإيجار الذرّي، التراجع الأسّي، الانتهاء، العزل، وتمرين الاستعادة (ADR-0004 §5). */
class PaymentAttemptReconcilerTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $tenant;

    private PlatformAdministrator $admin;

    private PaymentGateway $gateway;

    private FakePaymentGatewayAdapter $fake;

    private PaymentOrchestrator $orchestrator;

    protected function setUp(): void
    {
        parent::setUp();

        $this->tenant = Tenant::create(['name' => 'شركة المطابِق', 'slug' => 'pay-h1-04-rc', 'vat_number' => '300000000000013', 'currency' => 'SAR']);
        app(TenantContext::class)->set($this->tenant->id);
        User::create(['tenant_id' => $this->tenant->id, 'name' => 'المالك', 'email' => 'owner@pay-h1-04-rc.test', 'password' => 'password123', 'role' => 'owner']);
        $this->admin = PlatformAdministrator::create(['name' => 'مشغّل', 'email' => 'ops@pay-h1-04-rc.test', 'password' => 'platform-password-123']);
        SchedulerHeartbeat::record();
        $this->app->singleton(FakePaymentGatewayAdapter::class);
        $this->fake = app(FakePaymentGatewayAdapter::class);
        $this->orchestrator = app(PaymentOrchestrator::class);
        $this->gateway = $this->activeGateway($this->tenant);
        app(PaymentsRolloutControlService::class)->setTenantState($this->admin, $this->tenant->id, true, 'تفعيل للاختبار');
    }

    #[Test]
    public function a_stuck_attempt_is_captured_by_the_reconciler_without_any_ledger_effect(): void
    {
        $attempt = $this->agedAttempt('invoice:rc-1', 'idem-rc-0001');
        $this->fake->script($attempt->provider_payment_id, 'captured');

        $summary = app(PaymentAttemptReconciler::class)->run();

        $this->assertSame(['claimed' => 1, 'applied' => 1, 'unchanged' => 0, 'failed' => 0], $summary);
        $fresh = PaymentAttempt::query()->findOrFail($attempt->id);
        $this->assertSame(PaymentAttempt::STATUS_CAPTURED, $fresh->capture_status);
        $this->assertNull($fresh->reconcile_lease_until);
        $this->assertSame(0, (int) $fresh->reconcile_failures);
        $this->assertSame(0, Payment::query()->count());
        $this->assertSame(0, JournalEntry::query()->count());
    }

    #[Test]
    public function fresh_synced_and_already_captured_attempts_are_left_alone(): void
    {
        $fresh = $this->orchestrator->start(new TestPayable(key: 'invoice:rc-2'), $this->gateway, 'idem-rc-0002');
        $captured = $this->agedAttempt('invoice:rc-3', 'idem-rc-0003');
        $this->fake->script($captured->provider_payment_id, 'captured');
        $this->orchestrator->sync($captured);
        DB::table('payment_attempts')->where('id', $captured->id)->update(['last_synced_at' => now('UTC')->subHour()]);
        $fetches = $this->fake->fetchCount;

        $summary = app(PaymentAttemptReconciler::class)->run();

        $this->assertSame(0, $summary['claimed']);
        $this->assertSame($fetches, $this->fake->fetchCount, 'لا استعلام للطازج ولا للملتقَط');
        $this->assertSame(PaymentAttempt::STATUS_PENDING_CUSTOMER, PaymentAttempt::query()->findOrFail($fresh->id)->capture_status);
    }

    #[Test]
    public function a_provider_failure_backs_off_exponentially_records_only_a_code_and_recovers(): void
    {
        $attempt = $this->agedAttempt('invoice:rc-4', 'idem-rc-0004');
        $this->fake->failFetchWith(new \RuntimeException('secret provider detail sk_live_leak'));

        $first = app(PaymentAttemptReconciler::class)->run();

        $this->assertSame(1, $first['failed']);
        $row = DB::table('payment_attempts')->where('id', $attempt->id)->first();
        $this->assertSame(1, (int) $row->reconcile_failures);
        $this->assertNotNull($row->next_reconcile_at);
        $this->assertNull($row->reconcile_lease_until);
        $this->assertStringNotContainsString('sk_live', (string) $row->last_reconcile_error, 'رمز ثابت فقط، لا تفاصيل مزوّد');

        // داخل نافذة التراجع: لا يُعاد استعلام المزوّد.
        $fetches = $this->fake->fetchCount;
        $this->assertSame(0, app(PaymentAttemptReconciler::class)->run()['claimed']);
        $this->assertSame($fetches, $this->fake->fetchCount);

        // الفشل الثاني يضاعف التراجع، وبعد انقضائه والتعافي يلتقط المحاولة ويصفّر العدّاد.
        DB::table('payment_attempts')->where('id', $attempt->id)->update(['next_reconcile_at' => now('UTC')->subSecond()]);
        $this->assertSame(1, app(PaymentAttemptReconciler::class)->run()['failed']);
        $second = DB::table('payment_attempts')->where('id', $attempt->id)->first();
        $this->assertSame(2, (int) $second->reconcile_failures);
        $this->assertTrue(\Illuminate\Support\Carbon::parse($second->next_reconcile_at)->gt(now('UTC')->addMinutes(3)), 'تراجع 4 دقائق للفشل الثاني');

        $this->fake->failFetchWith(null);
        $this->fake->script($attempt->provider_payment_id, 'captured');
        DB::table('payment_attempts')->where('id', $attempt->id)->update(['next_reconcile_at' => now('UTC')->subSecond()]);
        $this->assertSame(1, app(PaymentAttemptReconciler::class)->run()['applied']);
        $done = DB::table('payment_attempts')->where('id', $attempt->id)->first();
        $this->assertSame(0, (int) $done->reconcile_failures);
        $this->assertNull($done->next_reconcile_at);
        $this->assertNull($done->last_reconcile_error);
    }

    #[Test]
    public function the_backoff_is_capped_at_one_hour(): void
    {
        $attempt = $this->agedAttempt('invoice:rc-5', 'idem-rc-0005');
        DB::table('payment_attempts')->where('id', $attempt->id)->update(['reconcile_failures' => 20]);
        $this->fake->failFetchWith(new \RuntimeException('down'));

        app(PaymentAttemptReconciler::class)->run();

        $next = \Illuminate\Support\Carbon::parse(DB::table('payment_attempts')->where('id', $attempt->id)->value('next_reconcile_at'));
        $this->assertTrue($next->lte(now('UTC')->addMinutes(PaymentAttemptReconciler::MAX_BACKOFF_MINUTES)->addSeconds(5)));
        $this->assertTrue($next->gt(now('UTC')->addMinutes(PaymentAttemptReconciler::MAX_BACKOFF_MINUTES - 1)));
    }

    #[Test]
    public function a_live_lease_blocks_a_second_reconciler_and_an_expired_lease_is_reclaimed(): void
    {
        $attempt = $this->agedAttempt('invoice:rc-6', 'idem-rc-0006');
        $this->fake->script($attempt->provider_payment_id, 'captured');
        DB::table('payment_attempts')->where('id', $attempt->id)->update(['reconcile_lease_until' => now('UTC')->addSeconds(60)]);
        $fetches = $this->fake->fetchCount;

        $this->assertSame(0, app(PaymentAttemptReconciler::class)->run()['claimed'], 'إيجار حيّ ⇒ لا مطابقة مزدوجة');
        $this->assertSame($fetches, $this->fake->fetchCount);

        DB::table('payment_attempts')->where('id', $attempt->id)->update(['reconcile_lease_until' => now('UTC')->subSecond()]);
        $this->assertSame(1, app(PaymentAttemptReconciler::class)->run()['applied'], 'عامل انهار ⇒ ينتهي إيجاره ويُستعاد');
    }

    #[Test]
    public function an_overdue_pending_attempt_is_expired_by_the_reconciler_and_a_late_capture_is_still_flagged(): void
    {
        $attempt = $this->agedAttempt('invoice:rc-7', 'idem-rc-0007');
        DB::table('payment_attempts')->where('id', $attempt->id)->update(['expires_at' => now('UTC')->subMinute()]);

        $this->assertSame(1, app(PaymentAttemptReconciler::class)->run()['applied']);
        $this->assertSame(PaymentAttempt::STATUS_EXPIRED, PaymentAttempt::query()->findOrFail($attempt->id)->capture_status);

        // المنتهية لا تُطابَق بعد انتهاء نافذة الصفحة، والتقاط متأخر يصل عبر الصندوق/المطابقة اليدوية فقط (D-15).
        DB::table('payment_attempts')->where('id', $attempt->id)->update(['last_synced_at' => now('UTC')->subHour()]);
        $this->assertSame(0, app(PaymentAttemptReconciler::class)->run()['claimed']);
        $this->fake->script($attempt->provider_payment_id, 'captured');
        $late = $this->orchestrator->sync(PaymentAttempt::query()->findOrFail($attempt->id));
        $this->assertTrue($late->applied);
        $fresh = PaymentAttempt::query()->findOrFail($attempt->id);
        $this->assertSame(PaymentAttempt::STATUS_CAPTURED, $fresh->capture_status);
        $this->assertContains('late_capture', $fresh->review_reasons);
    }

    #[Test]
    public function the_reconciler_works_across_tenants_without_leaking_context_and_ignores_rollout_state(): void
    {
        $other = Tenant::create(['name' => 'مؤسسة ثانية', 'slug' => 'pay-h1-04-rc2', 'vat_number' => '300000000000021', 'currency' => 'SAR']);
        app(TenantContext::class)->set($other->id);
        $otherGateway = $this->activeGateway($other);
        app(PaymentsRolloutControlService::class)->setTenantState($this->admin, $other->id, true, 'تفعيل');
        $theirs = $this->orchestrator->start(new TestPayable(key: 'invoice:rc-x'), $otherGateway, 'idem-rc-other1');
        DB::table('payment_attempts')->where('id', $theirs->id)->update(['created_at' => now('UTC')->subHour()]);
        app(TenantContext::class)->set($this->tenant->id);
        $mine = $this->agedAttempt('invoice:rc-8', 'idem-rc-0008');
        $this->fake->script($mine->provider_payment_id, 'captured');
        $this->fake->script($theirs->provider_payment_id, 'captured');

        // إيقاف المنصة الطارئ لا يمنع رصد ما التقطه المزوّد فعلاً.
        app(PaymentsRolloutControlService::class)->setPlatformState($this->admin, false, 'إيقاف طارئ');
        app(TenantContext::class)->forget();

        $summary = app(PaymentAttemptReconciler::class)->run();

        $this->assertSame(2, $summary['applied']);
        $this->assertNull(app(TenantContext::class)->id(), 'المطابِق يمسح السياق بعد كل محاولة');
        $this->assertSame(PaymentAttempt::STATUS_CAPTURED, PaymentAttempt::query()->withoutGlobalScopes()->findOrFail($theirs->id)->capture_status);
        $this->assertSame(PaymentAttempt::STATUS_CAPTURED, PaymentAttempt::query()->withoutGlobalScopes()->findOrFail($mine->id)->capture_status);
    }

    /** تمرين الاستعادة (ADR-0004 §5): نبض المجدول متوقف ⇒ محاولة عالقة ⇒ استعادة يدوية ⇒ تعافي المجدول يلتقط الباقي. */
    #[Test]
    public function recovery_exercise_stale_scheduler_then_manual_sync_then_automatic_recovery(): void
    {
        $stuck = $this->agedAttempt('invoice:rc-9', 'idem-rc-0009');
        $other = $this->agedAttempt('invoice:rc-10', 'idem-rc-0010');
        $this->fake->script($stuck->provider_payment_id, 'captured');
        $this->fake->script($other->provider_payment_id, 'captured');

        // 1) المجدول متوقف: النبض قديم ⇒ تفعيل جديد مرفوض، والمحاولات تبقى عالقة.
        PlatformRuntimeHeartbeat::query()->where('component', SchedulerHeartbeat::COMPONENT)->update(['last_seen_at' => now('UTC')->subMinutes(30)]);
        $this->assertFalse(SchedulerHeartbeat::isFresh(), 'المجدول متوقف');
        $this->assertSame(PaymentAttempt::STATUS_PENDING_CUSTOMER, PaymentAttempt::query()->findOrFail($stuck->id)->capture_status);

        // 2) الاستعادة اليدوية للمحاولة العالقة لا تعتمد المجدول.
        $manual = $this->orchestrator->sync(PaymentAttempt::query()->findOrFail($stuck->id));
        $this->assertTrue($manual->applied);
        $this->assertSame(PaymentAttempt::STATUS_CAPTURED, PaymentAttempt::query()->findOrFail($stuck->id)->capture_status);

        // 3) عودة المجدول: أمر المطابقة يلتقط المتبقّي ويكرّر آمناً.
        SchedulerHeartbeat::record();
        $this->assertSame(0, $this->artisan('payments:reconcile-attempts')->run());
        $this->assertSame(PaymentAttempt::STATUS_CAPTURED, PaymentAttempt::query()->findOrFail($other->id)->capture_status);
        $this->assertSame(0, app(PaymentAttemptReconciler::class)->run()['claimed'], 'التكرار آمن');
        $this->assertSame(0, Payment::query()->count());
        $this->assertSame(0, JournalEntry::query()->count());
    }

    #[Test]
    public function the_reconcile_command_is_scheduled_without_overlap_and_the_reconciler_never_touches_the_ledger(): void
    {
        $console = (string) file_get_contents(base_path('routes/console.php'));
        $this->assertMatchesRegularExpression("/payments:reconcile-attempts'\)[^;]*withoutOverlapping/s", $console);

        $forbidden = '/LedgerService|PaymentService|JournalEntry|JournalLine|InvoiceService|ZatcaService/';
        $this->assertDoesNotMatchRegularExpression($forbidden, php_strip_whitespace(base_path('app/Services/PaymentAttemptReconciler.php')));
    }

    // ───────────────────────── مساعدات ─────────────────────────

    private function activeGateway(Tenant $tenant): PaymentGateway
    {
        $gateway = PaymentGateway::query()->create(['provider' => 'fake', 'name' => 'Fake '.$tenant->slug, 'environment' => 'sandbox', 'webhook_secret' => 'whsec_rc']);
        DB::table('payment_gateways')->where('id', $gateway->id)->update(['status' => PaymentGateway::STATUS_ACTIVE, 'is_active' => true]);

        return $gateway->fresh();
    }

    /** محاولة معلّقة تأخرت مطابقتها (عمرها ساعة ولم تُزامَن). */
    private function agedAttempt(string $payableKey, string $idem): PaymentAttempt
    {
        $attempt = $this->orchestrator->start(new TestPayable(key: $payableKey), $this->gateway, $idem);
        DB::table('payment_attempts')->where('id', $attempt->id)->update(['created_at' => now('UTC')->subHour(), 'last_synced_at' => null]);

        return $attempt->fresh();
    }
}
