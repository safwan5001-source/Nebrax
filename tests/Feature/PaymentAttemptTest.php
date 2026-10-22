<?php

namespace Tests\Feature;

use App\Models\JournalEntry;
use App\Models\JournalLine;
use App\Models\Payment;
use App\Models\PaymentAttempt;
use App\Models\PaymentGateway;
use App\Models\PlatformAdministrator;
use App\Models\Tenant;
use App\Models\User;
use App\Services\FakePaymentGatewayAdapter;
use App\Services\PaymentGatewayAdapterRegistry;
use App\Services\PaymentOrchestrator;
use App\Services\PaymentGatewayService;
use App\Services\PaymentsRolloutControlService;
use App\Support\PaymentOrchestrationException;
use App\Support\PaymentProviderSnapshot;
use App\Support\SchedulerHeartbeat;
use App\Tenancy\TenantContext;
use DomainException;
use RuntimeException;
use Illuminate\Database\QueryException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use LogicException;
use PHPUnit\Framework\Attributes\Test;
use Tests\Support\TestPayable;
use Tests\TestCase;

/** PAY-H1-03 — نواة التنسيق: المحاولات، آلة الحالات الرتيبة، idempotency، الأحداث المتأخرة، ضابط التفعيل، العزل، RBAC. */
class PaymentAttemptTest extends TestCase
{
    use CapturesThrowable;
    use RefreshDatabase;

    private const MIGRATION = '2026_11_25_010000_create_payment_attempts_table.php';

    private Tenant $tenant;

    private User $owner;

    private PlatformAdministrator $admin;

    private PaymentGateway $gateway;

    private FakePaymentGatewayAdapter $fake;

    private PaymentOrchestrator $orchestrator;

    protected function setUp(): void
    {
        parent::setUp();

        $this->tenant = Tenant::create(['name' => 'شركة المنسّق', 'slug' => 'pay-h1-03', 'vat_number' => '300000000000013', 'currency' => 'SAR']);
        app(TenantContext::class)->set($this->tenant->id);
        $this->owner = User::create(['tenant_id' => $this->tenant->id, 'name' => 'المالك', 'email' => 'owner@pay-h1-03.test', 'password' => 'password123', 'role' => 'owner']);
        $this->admin = PlatformAdministrator::create(['name' => 'مشغّل', 'email' => 'ops@pay-h1-03.test', 'password' => 'platform-password-123']);
        SchedulerHeartbeat::record();

        $this->app->singleton(FakePaymentGatewayAdapter::class);
        $this->fake = app(FakePaymentGatewayAdapter::class);
        $this->orchestrator = app(PaymentOrchestrator::class);
        $this->gateway = $this->activeGateway();
        $this->enableRollout();
    }

    // ═══════════════ البدء والـidempotency ═══════════════

    #[Test]
    public function starting_creates_a_pending_attempt_with_a_checkout_and_no_financial_artifacts(): void
    {
        $attempt = $this->orchestrator->start(new TestPayable, $this->gateway, 'idem-key-0001', $this->owner);

        $this->assertSame(PaymentAttempt::STATUS_PENDING_CUSTOMER, $attempt->capture_status);
        $this->assertSame('invoice:inv-1', $attempt->payable_key);
        $this->assertSame(11500, $attempt->amount_minor);
        $this->assertSame('SAR', $attempt->currency);
        $this->assertSame('fake', $attempt->provider);
        $this->assertSame('sandbox', $attempt->environment);
        $this->assertSame('fake_'.$attempt->id, $attempt->provider_payment_id);
        $this->assertStringContainsString($attempt->id, (string) $attempt->checkout_url);
        $this->assertSame($this->tenant->id, $attempt->tenant_id);
        $this->assertSame($this->owner->id, $attempt->created_by);
        $this->assertSame(PaymentAttempt::DISPUTE_NONE, $attempt->dispute_status);
        $this->assertSame(0, $attempt->captured_minor);
        $this->assertNotNull($attempt->expires_at);
        $this->assertCount(1, $this->fake->checkoutCalls);
        $this->assertSame($attempt->id, $this->fake->checkoutCalls[0]['attempt_id'], 'معرّف المحاولة هو مفتاح idempotency عند المزوّد');

        $this->assertNoFinancialArtifacts();
    }

    #[Test]
    public function the_same_idempotency_key_returns_the_same_attempt_and_calls_the_provider_once(): void
    {
        $first = $this->orchestrator->start(new TestPayable, $this->gateway, 'idem-key-0002');
        $again = $this->orchestrator->start(new TestPayable, $this->gateway, 'idem-key-0002');

        $this->assertSame($first->id, $again->id);
        $this->assertSame(1, PaymentAttempt::query()->count());
        $this->assertCount(1, $this->fake->checkoutCalls);
    }

    #[Test]
    public function a_key_reused_for_a_different_request_is_rejected(): void
    {
        $this->orchestrator->start(new TestPayable, $this->gateway, 'idem-key-0003');

        $e = $this->thrown(fn () => $this->orchestrator->start(new TestPayable(key: 'invoice:other'), $this->gateway, 'idem-key-0003'), 'conflict', PaymentOrchestrationException::class);
        $this->assertSame('idempotency_conflict', $e->reason);
        $this->assertSame(1, PaymentAttempt::query()->count());
    }

    #[Test]
    public function only_one_active_attempt_exists_per_payable_until_it_is_closed(): void
    {
        $first = $this->orchestrator->start(new TestPayable, $this->gateway, 'idem-key-0004');

        $e = $this->thrown(fn () => $this->orchestrator->start(new TestPayable, $this->gateway, 'idem-key-0005'), 'second active', PaymentOrchestrationException::class);
        $this->assertSame('active_attempt_exists', $e->reason);
        $this->assertSame(1, PaymentAttempt::query()->count());

        $this->orchestrator->cancel($first);
        $second = $this->orchestrator->start(new TestPayable, $this->gateway, 'idem-key-0005');
        $this->assertNotSame($first->id, $second->id);
        $this->assertSame(PaymentAttempt::STATUS_PENDING_CUSTOMER, $second->capture_status);
    }

    #[Test]
    public function the_amount_is_recomputed_from_the_payable_on_every_new_attempt(): void
    {
        $payable = new TestPayable(due: 20000);
        $first = $this->orchestrator->start($payable, $this->gateway, 'idem-key-0006');
        $this->orchestrator->cancel($first);

        $payable->due = 7500; // سُدِّد جزء من الفاتورة
        $second = $this->orchestrator->start($payable, $this->gateway, 'idem-key-0007');

        $this->assertSame(20000, $first->amount_minor);
        $this->assertSame(7500, $second->amount_minor);
    }

    #[Test]
    public function an_unpayable_or_zero_due_or_unsupported_currency_creates_nothing(): void
    {
        $e = $this->thrown(fn () => $this->orchestrator->start(new TestPayable(payable: false), $this->gateway, 'idem-key-0008'), 'unpayable', DomainException::class);
        $this->assertSame('not payable', $e->getMessage());

        $e = $this->thrown(fn () => $this->orchestrator->start(new TestPayable(due: 0), $this->gateway, 'idem-key-0009'), 'zero', PaymentOrchestrationException::class);
        $this->assertSame('nothing_due', $e->reason);

        $e = $this->thrown(fn () => $this->orchestrator->start(new TestPayable(currency: 'USD'), $this->gateway, 'idem-key-0010'), 'currency', PaymentOrchestrationException::class);
        $this->assertSame('currency_unsupported', $e->reason);

        $e = $this->thrown(fn () => $this->orchestrator->start(new TestPayable(key: 'Bad Key'), $this->gateway, 'idem-key-0011'), 'payable key', PaymentOrchestrationException::class);
        $this->assertSame('invalid_payable', $e->reason);

        $e = $this->thrown(fn () => $this->orchestrator->start(new TestPayable, $this->gateway, 'short'), 'idem key', PaymentOrchestrationException::class);
        $this->assertSame('invalid_idempotency_key', $e->reason);

        $this->assertSame(0, PaymentAttempt::query()->count());
        $this->assertCount(0, $this->fake->checkoutCalls);
    }

    #[Test]
    public function a_provider_outage_leaves_the_attempt_created_and_a_retry_resumes_with_the_same_provider_key(): void
    {
        $this->fake->failNextCheckouts(1);

        $e = $this->thrown(fn () => $this->orchestrator->start(new TestPayable, $this->gateway, 'idem-key-0012'), 'outage', PaymentOrchestrationException::class);
        $this->assertSame('provider_unavailable', $e->reason);
        $stuck = PaymentAttempt::query()->firstOrFail();
        $this->assertSame(PaymentAttempt::STATUS_CREATED, $stuck->capture_status);
        $this->assertNull($stuck->provider_payment_id);

        $resumed = $this->orchestrator->start(new TestPayable, $this->gateway, 'idem-key-0012');
        $this->assertSame($stuck->id, $resumed->id);
        $this->assertSame(PaymentAttempt::STATUS_PENDING_CUSTOMER, $resumed->capture_status);
        $this->assertSame(1, PaymentAttempt::query()->count());
        $this->assertSame([$stuck->id, $stuck->id], array_column($this->fake->checkoutCalls, 'attempt_id'), 'المحاولتان بمفتاح المزوّد نفسه');
    }

    #[Test]
    public function cancelling_an_unresolved_attempt_first_resolves_the_provider_call_so_a_late_capture_is_detected(): void
    {
        $this->fake->failNextCheckouts(1);
        $this->thrown(fn () => $this->orchestrator->start(new TestPayable, $this->gateway, 'idem-key-0031'), 'outage', PaymentOrchestrationException::class);
        $stuck = PaymentAttempt::query()->firstOrFail();
        $this->assertNull($stuck->provider_payment_id);

        $cancelled = $this->orchestrator->cancel($stuck);

        $this->assertSame(PaymentAttempt::STATUS_CANCELLED, $cancelled->capture_status);
        $this->assertSame('fake_'.$stuck->id, $cancelled->provider_payment_id, 'المرجع حُسم بمفتاح المحاولة قبل الإلغاء');
        $this->assertCount(2, $this->fake->checkoutCalls);

        $this->fake->script($cancelled->provider_payment_id, 'captured');
        $result = $this->orchestrator->sync($cancelled);
        $this->assertTrue($result->applied);
        $this->assertSame([PaymentAttempt::REVIEW_LATE_CAPTURE], $result->attempt->review_reasons);
    }

    #[Test]
    public function an_unresolved_attempt_is_not_cancelled_while_the_provider_is_unreachable(): void
    {
        $this->fake->failNextCheckouts(2);
        $this->thrown(fn () => $this->orchestrator->start(new TestPayable, $this->gateway, 'idem-key-0032'), 'outage', PaymentOrchestrationException::class);
        $stuck = PaymentAttempt::query()->firstOrFail();

        $e = $this->thrown(fn () => $this->orchestrator->cancel($stuck), 'still down', PaymentOrchestrationException::class);

        $this->assertSame('provider_unavailable', $e->reason);
        $this->assertSame(PaymentAttempt::STATUS_CREATED, PaymentAttempt::query()->findOrFail($stuck->id)->capture_status);
    }

    #[Test]
    public function a_cancel_that_wins_the_race_against_the_checkout_call_still_keeps_the_provider_reference(): void
    {
        $this->fake->onCheckout = function ($context): void {
            DB::table('payment_attempts')->where('id', $context->attemptId)->update(['capture_status' => PaymentAttempt::STATUS_CANCELLED]);
        };

        $attempt = $this->orchestrator->start(new TestPayable, $this->gateway, 'idem-key-0033');

        $this->assertSame(PaymentAttempt::STATUS_CANCELLED, $attempt->capture_status, 'الإلغاء الأسبق يبقى');
        $this->assertSame('fake_'.$attempt->id, $attempt->provider_payment_id, 'لكن مرجع المزوّد محفوظ');
        $this->fake->script($attempt->provider_payment_id, 'captured');
        $this->assertTrue($this->orchestrator->sync($attempt)->applied, 'الالتقاط المتأخر يُكتشف');
    }

    #[Test]
    public function resuming_an_unfinished_attempt_revalidates_the_payable_and_closes_a_stale_one(): void
    {
        // سُدِّد جزء من المستند بعد انقطاع المزوّد: لا تُستأنف المحاولة بمبلغها القديم.
        $payable = new TestPayable(due: 20000);
        $this->fake->failNextCheckouts(1);
        $this->thrown(fn () => $this->orchestrator->start($payable, $this->gateway, 'idem-key-0034'), 'outage', PaymentOrchestrationException::class);
        $payable->due = 5000;

        $e = $this->thrown(fn () => $this->orchestrator->start($payable, $this->gateway, 'idem-key-0034'), 'changed', PaymentOrchestrationException::class);
        $this->assertSame('payable_changed', $e->reason);
        $closed = PaymentAttempt::query()->firstOrFail();
        $this->assertSame(PaymentAttempt::STATUS_CANCELLED, $closed->capture_status);
        $this->assertSame(20000, $closed->amount_minor);
        $this->assertNotNull($closed->provider_payment_id, 'حُسم لدى المزوّد قبل الإغلاق');

        // ومحاولة جديدة بمفتاح جديد تأخذ المبلغ الحالي.
        $fresh = $this->orchestrator->start($payable, $this->gateway, 'idem-key-0035');
        $this->assertSame(5000, $fresh->amount_minor);

        // لم يعد قابلاً للدفع أصلاً: يُرفض بسببه وتُغلق المحاولة العالقة.
        $other = new TestPayable(key: 'invoice:gone');
        $this->fake->failNextCheckouts(1);
        $this->thrown(fn () => $this->orchestrator->start($other, $this->gateway, 'idem-key-0036'), 'outage 2', PaymentOrchestrationException::class);
        $other->payable = false;
        $this->thrown(fn () => $this->orchestrator->start($other, $this->gateway, 'idem-key-0036'), 'unpayable', DomainException::class);
        $this->assertSame(PaymentAttempt::STATUS_CANCELLED, PaymentAttempt::query()->where('idempotency_key', 'idem-key-0036')->firstOrFail()->capture_status);
    }

    #[Test]
    public function a_payable_read_failure_is_not_treated_as_proof_it_is_obsolete(): void
    {
        $this->fake->failNextCheckouts(1);
        $this->thrown(fn () => $this->orchestrator->start(new TestPayable, $this->gateway, 'idem-key-0037'), 'outage', PaymentOrchestrationException::class);
        $stuck = PaymentAttempt::query()->firstOrFail();
        $calls = count($this->fake->checkoutCalls);

        $broken = new TestPayable(infrastructureFailure: new RuntimeException('db connection lost'));
        $this->thrown(fn () => $this->orchestrator->start($broken, $this->gateway, 'idem-key-0037'), 'infrastructure', RuntimeException::class);

        $this->assertSame(PaymentAttempt::STATUS_CREATED, PaymentAttempt::query()->findOrFail($stuck->id)->capture_status, 'المحاولة لم تُمسّ');
        $this->assertCount($calls, $this->fake->checkoutCalls, 'ولا استدعاء مزوّد جديد');
    }

    #[Test]
    public function a_connection_with_active_attempts_cannot_be_revoked_until_they_are_closed(): void
    {
        $gateways = app(PaymentGatewayService::class);
        $attempt = $this->orchestrator->start(new TestPayable, $this->gateway, 'idem-key-0039');

        $e = $this->thrown(fn () => $gateways->revoke($this->gateway->fresh(), $this->owner, 'إلغاء اختبار'), 'revoke with attempt', \App\Support\PaymentGatewayException::class);
        $this->assertSame('gateway.has_active_attempts', $e->reason);
        $this->assertTrue($this->gateway->fresh()->isUsable(), 'الاتصال وأسراره سليمان');

        // الإيقاف المؤقت يبقي الأسرار فتبقى المطابقة ممكنة.
        $gateways->suspend($this->gateway->fresh(), $this->owner, 'إيقاف');
        $this->fake->script($attempt->provider_payment_id, 'captured');
        $this->assertTrue($this->orchestrator->sync($attempt)->applied);

        // بعد التقاط المحاولة (مغلقة) يصح الإلغاء.
        $this->assertSame(PaymentGateway::STATUS_REVOKED, $gateways->revoke($this->gateway->fresh(), $this->owner, 'إلغاء بعد الإغلاق')->status);
    }

    // ═══════════════ ضابط التفعيل ═══════════════

    #[Test]
    public function nothing_starts_until_the_tenant_is_enabled_and_the_platform_stop_overrides_it(): void
    {
        $other = Tenant::create(['name' => 'شركة أخرى', 'slug' => 'pay-h1-03-b', 'vat_number' => '300000000000014', 'currency' => 'SAR']);
        app(TenantContext::class)->set($other->id);
        $gateway = $this->activeGateway();
        $e = $this->thrown(fn () => $this->orchestrator->start(new TestPayable, $gateway, 'idem-key-0013'), 'not enabled', PaymentOrchestrationException::class);
        $this->assertSame('rollout_disabled', $e->reason);
        $this->assertSame(0, PaymentAttempt::query()->count());
        $this->assertCount(0, $this->fake->checkoutCalls);

        app(TenantContext::class)->set($this->tenant->id);
        $rollout = app(PaymentsRolloutControlService::class);
        $rollout->setPlatformState($this->admin, false, 'إيقاف طارئ للاختبار');
        $e = $this->thrown(fn () => $this->orchestrator->start(new TestPayable, $this->gateway, 'idem-key-0014'), 'platform stop', PaymentOrchestrationException::class);
        $this->assertSame('platform_stop', $e->reason);

        $rollout->setPlatformState($this->admin, true, 'رفع الإيقاف');
        $this->assertSame(PaymentAttempt::STATUS_PENDING_CUSTOMER, $this->orchestrator->start(new TestPayable, $this->gateway, 'idem-key-0014')->capture_status);
    }

    #[Test]
    public function the_gate_stops_new_attempts_but_never_blocks_reconciling_or_cancelling_existing_ones(): void
    {
        $attempt = $this->orchestrator->start(new TestPayable, $this->gateway, 'idem-key-0015');
        app(PaymentsRolloutControlService::class)->setPlatformState($this->admin, false, 'إيقاف طارئ للاختبار');

        $this->fake->script($attempt->provider_payment_id, 'captured');
        $result = $this->orchestrator->sync($attempt);
        $this->assertTrue($result->applied);
        $this->assertSame(PaymentAttempt::STATUS_CAPTURED, $result->attempt->capture_status);
    }

    // ═══════════════ الاتصال والمحوّل ═══════════════

    #[Test]
    public function a_gateway_that_is_not_usable_or_has_no_adapter_is_refused(): void
    {
        foreach ([PaymentGateway::STATUS_DRAFT, PaymentGateway::STATUS_SUSPENDED, PaymentGateway::STATUS_REVOKED] as $i => $status) {
            $gateway = $this->activeGateway("g-{$status}");
            DB::table('payment_gateways')->where('id', $gateway->id)->update(['status' => $status]);
            $e = $this->thrown(fn () => $this->orchestrator->start(new TestPayable, $gateway, "idem-key-st-{$i}"), $status, PaymentOrchestrationException::class);
            $this->assertSame('gateway_unavailable', $e->reason, $status);
        }

        $stripe = app(PaymentGatewayService::class)->create(['provider' => 'stripe', 'name' => 'Stripe', 'environment' => 'sandbox', 'secret_key' => 'sk_test_x'], $this->owner);
        DB::table('payment_gateways')->where('id', $stripe->id)->update(['status' => 'active']);
        $e = $this->thrown(fn () => $this->orchestrator->start(new TestPayable, $stripe->fresh(), 'idem-key-0016'), 'no adapter', PaymentOrchestrationException::class);
        $this->assertSame('adapter_unavailable', $e->reason);

        $this->assertSame(0, PaymentAttempt::query()->count());
    }

    #[Test]
    public function the_fake_adapter_cannot_be_resolved_outside_local_and_testing(): void
    {
        $registry = app(PaymentGatewayAdapterRegistry::class);
        $this->assertTrue($registry->has('fake'));

        $this->app['env'] = 'production';
        $this->assertFalse($registry->has('fake'));
        $e = $this->thrown(fn () => $registry->for('fake'), 'production', PaymentOrchestrationException::class);
        $this->assertSame('adapter_unavailable', $e->reason);
        $this->assertNotContains('fake', PaymentGateway::PROVIDERS, 'واجهة الإدارة لا تنشئ اتصال fake');
    }

    // ═══════════════ آلة الحالات: الرتبة والأحداث المتأخرة ═══════════════

    #[Test]
    public function the_provider_truth_moves_the_attempt_forward_and_records_the_capture(): void
    {
        $attempt = $this->orchestrator->start(new TestPayable, $this->gateway, 'idem-key-0017');

        $this->fake->script($attempt->provider_payment_id, 'authorized');
        $this->assertSame(PaymentAttempt::STATUS_AUTHORIZED, $this->orchestrator->sync($attempt)->attempt->capture_status);

        $this->fake->script($attempt->provider_payment_id, 'captured');
        $result = $this->orchestrator->sync($attempt);
        $this->assertTrue($result->applied);
        $captured = $result->attempt;
        $this->assertSame(PaymentAttempt::STATUS_CAPTURED, $captured->capture_status);
        $this->assertSame(11500, $captured->captured_minor);
        $this->assertNotNull($captured->captured_at);
        $this->assertFalse($captured->requiresReview());
        $this->assertFalse($captured->isActive(), 'الالتقاط يحرّر حجز الـPayable النشط');
        $this->assertNoFinancialArtifacts();
    }

    #[Test]
    public function late_duplicate_and_out_of_order_snapshots_never_move_the_state_backwards(): void
    {
        $attempt = $this->orchestrator->start(new TestPayable, $this->gateway, 'idem-key-0018');
        $id = $attempt->provider_payment_id;

        $this->fake->script($id, 'captured');
        $this->assertTrue($this->orchestrator->sync($attempt)->applied);
        $capturedAt = PaymentAttempt::query()->find($attempt->id)->captured_at;

        // وصل حدث «authorized» قديم بعد الالتقاط، ثم «pending»، ثم الالتقاط نفسه مجدداً.
        foreach (['authorized', 'pending_customer', 'captured'] as $stale) {
            $this->fake->script($id, $stale);
            $result = $this->orchestrator->sync($attempt);
            $this->assertFalse($result->applied, $stale);
            $this->assertSame($stale === 'captured' ? 'duplicate' : 'stale', $result->ignoredReason, $stale);
            $this->assertSame(PaymentAttempt::STATUS_CAPTURED, $result->attempt->capture_status, $stale);
        }

        $final = PaymentAttempt::query()->find($attempt->id);
        $this->assertEquals($capturedAt, $final->captured_at, 'وقت الالتقاط لا يتبدل');
        $this->assertSame(11500, $final->captured_minor);
        $this->assertFalse($final->requiresReview());
    }

    #[Test]
    public function a_capture_after_a_local_cancel_or_expiry_is_accepted_and_flagged_for_review(): void
    {
        foreach (['cancel' => 'idem-key-0019', 'expire' => 'idem-key-0020'] as $how => $key) {
            $attempt = $this->orchestrator->start(new TestPayable(key: "invoice:late-{$how}"), $this->gateway, $key);
            if ($how === 'cancel') {
                $this->orchestrator->cancel($attempt);
            } else {
                DB::table('payment_attempts')->where('id', $attempt->id)->update(['capture_status' => PaymentAttempt::STATUS_EXPIRED]);
            }

            $this->fake->script($attempt->provider_payment_id, 'captured');
            $result = $this->orchestrator->sync($attempt);

            $this->assertTrue($result->applied, $how);
            $this->assertSame(PaymentAttempt::STATUS_CAPTURED, $result->attempt->capture_status, $how);
            $this->assertSame([PaymentAttempt::REVIEW_LATE_CAPTURE], $result->attempt->review_reasons, $how);
        }
    }

    #[Test]
    public function amount_or_currency_differences_at_capture_are_recorded_and_flagged_not_hidden(): void
    {
        $short = $this->orchestrator->start(new TestPayable(key: 'invoice:short'), $this->gateway, 'idem-key-0021');
        $this->fake->script($short->provider_payment_id, 'captured', capturedMinor: 10000);
        $result = $this->orchestrator->sync($short);
        $this->assertSame(10000, $result->attempt->captured_minor);
        $this->assertSame([PaymentAttempt::REVIEW_AMOUNT_MISMATCH], $result->attempt->review_reasons);

        $usd = $this->orchestrator->start(new TestPayable(key: 'invoice:usd'), $this->gateway, 'idem-key-0022');
        $this->fake->script($usd->provider_payment_id, 'captured', currency: 'USD');
        $reasons = $this->orchestrator->sync($usd)->attempt->review_reasons;
        $this->assertSame([PaymentAttempt::REVIEW_CURRENCY_MISMATCH], $reasons);
    }

    #[Test]
    public function a_provider_that_holds_money_for_an_attempt_closed_as_failed_is_flagged_without_reopening_it(): void
    {
        $attempt = $this->orchestrator->start(new TestPayable, $this->gateway, 'idem-key-0023');
        $this->fake->script($attempt->provider_payment_id, 'failed', failureCode: 'card_declined');
        $this->assertSame(PaymentAttempt::STATUS_FAILED, $this->orchestrator->sync($attempt)->attempt->capture_status);
        $this->assertSame('card_declined', PaymentAttempt::query()->find($attempt->id)->failure_code);

        $this->fake->script($attempt->provider_payment_id, 'captured');
        $result = $this->orchestrator->sync($attempt);

        $this->assertFalse($result->applied);
        $this->assertSame('state_conflict', $result->ignoredReason);
        $this->assertSame(PaymentAttempt::STATUS_FAILED, $result->attempt->capture_status);
        $this->assertSame([PaymentAttempt::REVIEW_STATE_CONFLICT], $result->attempt->review_reasons);
        $this->assertSame(0, $result->attempt->captured_minor);
    }

    #[Test]
    public function a_snapshot_for_another_payment_or_an_unknown_status_is_rejected(): void
    {
        $attempt = $this->orchestrator->start(new TestPayable, $this->gateway, 'idem-key-0024');

        $e = $this->thrown(fn () => $this->orchestrator->applySnapshot($attempt, new PaymentProviderSnapshot('someone_elses', 'captured', 11500, 'SAR', 11500)), 'foreign', PaymentOrchestrationException::class);
        $this->assertSame('provider_reference_mismatch', $e->reason);

        $e = $this->thrown(fn () => $this->orchestrator->applySnapshot($attempt, new PaymentProviderSnapshot($attempt->provider_payment_id, 'teleported', 11500, 'SAR')), 'unknown', PaymentOrchestrationException::class);
        $this->assertSame('invalid_snapshot', $e->reason);
        $this->assertSame(PaymentAttempt::STATUS_PENDING_CUSTOMER, PaymentAttempt::query()->find($attempt->id)->capture_status);
    }

    #[Test]
    public function the_model_refuses_every_backwards_or_identity_changing_write(): void
    {
        $attempt = $this->orchestrator->start(new TestPayable, $this->gateway, 'idem-key-0025');
        $this->fake->script($attempt->provider_payment_id, 'captured');
        $captured = $this->orchestrator->sync($attempt)->attempt;

        foreach ([
            'backwards status' => ['capture_status' => PaymentAttempt::STATUS_PENDING_CUSTOMER],
            'captured to voided' => ['capture_status' => PaymentAttempt::STATUS_VOIDED],
            'amount' => ['amount_minor' => 1],
            'currency' => ['currency' => 'USD'],
            'payable' => ['payable_key' => 'invoice:other'],
            'idempotency key' => ['idempotency_key' => 'rewritten-key-1'],
            'gateway' => ['payment_gateway_id' => $this->activeGateway('g2')->id],
            'tenant' => ['tenant_id' => (string) \Illuminate\Support\Str::uuid()],
            'provider reference' => ['provider_payment_id' => 'other_ref'],
            'captured amount' => ['captured_minor' => 5],
        ] as $label => $changes) {
            $fresh = PaymentAttempt::query()->findOrFail($captured->id);
            $this->thrown(fn () => $fresh->forceFill($changes)->save(), $label, LogicException::class);
        }

        $this->thrown(fn () => PaymentAttempt::query()->findOrFail($captured->id)->delete(), 'delete', LogicException::class);
        $this->assertSame(PaymentAttempt::STATUS_CAPTURED, PaymentAttempt::query()->findOrFail($captured->id)->capture_status);
    }

    // ═══════════════ القاعدة ═══════════════

    #[Test]
    public function the_database_refuses_malformed_attempts_and_duplicate_references(): void
    {
        $base = fn (array $o = []) => array_merge([
            'id' => (string) \Illuminate\Support\Str::uuid(), 'tenant_id' => $this->tenant->id, 'payment_gateway_id' => $this->gateway->id,
            'provider' => 'fake', 'environment' => 'sandbox', 'payable_key' => 'invoice:db-'.uniqid(), 'idempotency_key' => 'db-key-'.uniqid(),
            'amount_minor' => 100, 'currency' => 'SAR', 'capture_status' => 'created', 'dispute_status' => 'none',
            'captured_minor' => 0, 'refunded_minor' => 0, 'created_at' => now(), 'updated_at' => now(),
        ], $o);

        foreach ([
            'zero amount' => ['amount_minor' => 0],
            'negative amount' => ['amount_minor' => -5],
            'refunded above captured' => ['refunded_minor' => 10, 'captured_minor' => 5],
            'unknown status' => ['capture_status' => 'teleported'],
            'unknown dispute status' => ['dispute_status' => 'lost_forever'],
        ] as $label => $override) {
            $this->thrown(fn () => DB::transaction(fn () => DB::table('payment_attempts')->insert($base($override))), $label, QueryException::class);
        }

        DB::table('payment_attempts')->insert($base(['payable_key' => 'invoice:dup', 'idempotency_key' => 'dup-key-001']));
        $this->thrown(fn () => DB::transaction(fn () => DB::table('payment_attempts')->insert($base(['payable_key' => 'invoice:dup2', 'idempotency_key' => 'dup-key-001']))), 'duplicate idempotency', QueryException::class);
        $this->thrown(fn () => DB::transaction(fn () => DB::table('payment_attempts')->insert($base(['payable_key' => 'invoice:dup']))), 'second active attempt', QueryException::class);

        DB::table('payment_attempts')->insert($base(['capture_status' => 'captured', 'payable_key' => 'invoice:dup', 'captured_minor' => 100]));
        $this->assertSame(2, DB::table('payment_attempts')->where('payable_key', 'invoice:dup')->count(), 'محاولة مغلقة لا تحجز الـPayable');

        DB::table('payment_attempts')->insert($base(['provider_payment_id' => 'ref_1', 'payable_key' => 'invoice:r1']));
        $this->thrown(fn () => DB::transaction(fn () => DB::table('payment_attempts')->insert($base(['provider_payment_id' => 'ref_1', 'payable_key' => 'invoice:r2']))), 'duplicate provider ref', QueryException::class);
    }

    #[Test]
    public function a_gateway_with_attempts_cannot_be_deleted_by_the_model_or_by_raw_sql(): void
    {
        $this->orchestrator->start(new TestPayable, $this->gateway, 'idem-key-0026');

        $e = $this->thrown(fn () => $this->gateway->fresh()->delete(), 'model delete', \App\Support\PaymentGatewayException::class);
        $this->assertSame('gateway.has_references', $e->reason);
        $this->thrown(fn () => DB::transaction(fn () => DB::table('payment_gateways')->where('id', $this->gateway->id)->delete()), 'raw delete', QueryException::class);
        $this->assertTrue(PaymentGateway::query()->whereKey($this->gateway->id)->exists());
    }

    #[Test]
    public function the_migration_refuses_to_roll_back_while_attempts_exist(): void
    {
        $this->orchestrator->start(new TestPayable, $this->gateway, 'idem-key-0027');
        $migration = require database_path('migrations/'.self::MIGRATION);

        $this->thrown(fn () => $migration->down(), 'rollback with rows', \RuntimeException::class);
        $this->assertSame(1, DB::table('payment_attempts')->count());
    }

    // ═══════════════ العزل و RBAC ═══════════════

    #[Test]
    public function another_tenant_can_neither_see_nor_use_nor_forge_an_attempt_or_gateway(): void
    {
        $attempt = $this->orchestrator->start(new TestPayable, $this->gateway, 'idem-key-0028');

        $other = Tenant::create(['name' => 'مستأجر آخر', 'slug' => 'pay-h1-03-x', 'vat_number' => '300000000000015', 'currency' => 'SAR']);
        app(TenantContext::class)->set($other->id);
        $this->assertSame(0, PaymentAttempt::query()->count(), 'لا يرى محاولات غيره');
        $this->enableRollout($other->id);

        foreach (['sync' => fn () => $this->orchestrator->sync($attempt), 'cancel' => fn () => $this->orchestrator->cancel($attempt)] as $label => $op) {
            $e = $this->thrown($op, $label, PaymentOrchestrationException::class);
            $this->assertSame('attempt_not_found', $e->reason, $label);
        }
        $e = $this->thrown(fn () => $this->orchestrator->start(new TestPayable(key: 'invoice:x'), $this->gateway, 'idem-key-0029'), 'foreign gateway', PaymentOrchestrationException::class);
        $this->assertSame('gateway_unavailable', $e->reason);

        $this->thrown(fn () => PaymentAttempt::query()->create([
            'payment_gateway_id' => $this->gateway->id, 'provider' => 'fake', 'environment' => 'sandbox', 'payable_key' => 'invoice:forged',
            'idempotency_key' => 'forged-key-1', 'amount_minor' => 100, 'currency' => 'SAR',
        ]), 'foreign gateway on model', DomainException::class);
        $this->thrown(fn () => PaymentAttempt::query()->create([
            'tenant_id' => $this->tenant->id, 'payment_gateway_id' => $this->gateway->id, 'provider' => 'fake', 'environment' => 'sandbox',
            'payable_key' => 'invoice:forged', 'idempotency_key' => 'forged-key-2', 'amount_minor' => 100, 'currency' => 'SAR',
        ]), 'forged tenant', DomainException::class);

        app(TenantContext::class)->set($this->tenant->id);
        $this->assertSame(PaymentAttempt::STATUS_PENDING_CUSTOMER, PaymentAttempt::query()->findOrFail($attempt->id)->capture_status);
        $this->assertSame(1, PaymentAttempt::query()->count());
    }

    #[Test]
    public function only_a_same_tenant_actor_with_payments_manage_may_act(): void
    {
        $accountant = User::create(['tenant_id' => $this->tenant->id, 'name' => 'محاسب', 'email' => 'acc@pay-h1-03.test', 'password' => 'password123', 'role' => 'accountant']);
        $staff = User::create(['tenant_id' => $this->tenant->id, 'name' => 'موظف', 'email' => 'staff@pay-h1-03.test', 'password' => 'password123', 'role' => 'staff']);
        $foreign = User::withoutGlobalScopes()->create(['tenant_id' => Tenant::create(['name' => 'ج', 'slug' => 'pay-h1-03-f', 'vat_number' => '300000000000016', 'currency' => 'SAR'])->id,
            'name' => 'غريب', 'email' => 'foreign@pay-h1-03.test', 'password' => 'password123', 'role' => 'owner']);

        foreach (['staff' => $staff, 'foreign owner' => $foreign] as $label => $actor) {
            $e = $this->thrown(fn () => $this->orchestrator->start(new TestPayable, $this->gateway, 'idem-key-0030', $actor), $label, PaymentOrchestrationException::class);
            $this->assertSame('forbidden', $e->reason, $label);
        }
        $this->assertSame(0, PaymentAttempt::query()->count());

        $this->assertSame($accountant->id, $this->orchestrator->start(new TestPayable, $this->gateway, 'idem-key-0030', $accountant)->created_by);
    }

    #[Test]
    public function an_actor_is_re_read_so_revoked_demoted_deleted_or_unsaved_users_are_refused(): void
    {
        $staffLike = fn (string $email) => User::create(['tenant_id' => $this->tenant->id, 'name' => 'م', 'email' => $email, 'password' => 'password123', 'role' => 'accountant']);
        $attempt = $this->orchestrator->start(new TestPayable, $this->gateway, 'idem-key-0038');

        $deactivated = $staffLike('a@pay-h1-03.test');
        $demoted = $staffLike('b@pay-h1-03.test');
        $deleted = $staffLike('c@pay-h1-03.test');
        // النماذج في الذاكرة ما زالت «محاسباً نشطاً»؛ القاعدة تغيّرت بعد تحميلها.
        DB::table('users')->where('id', $deactivated->id)->update(['is_active' => false]);
        DB::table('users')->where('id', $demoted->id)->update(['role' => 'staff']);
        $deleted->delete();
        $unsaved = new User(['tenant_id' => $this->tenant->id, 'role' => 'owner']);

        foreach (['deactivated' => $deactivated, 'demoted' => $demoted, 'deleted' => $deleted, 'unsaved owner' => $unsaved] as $label => $actor) {
            foreach (['start' => fn () => $this->orchestrator->start(new TestPayable(key: 'invoice:r-'.$label), $this->gateway, 'idem-r-'.str_replace(' ', '-', $label), $actor),
                'sync' => fn () => $this->orchestrator->sync($attempt, $actor),
                'cancel' => fn () => $this->orchestrator->cancel($attempt, $actor)] as $op => $call) {
                $e = $this->thrown($call, "{$label}/{$op}", PaymentOrchestrationException::class);
                $this->assertSame('forbidden', $e->reason, "{$label}/{$op}");
            }
        }
        $this->assertSame(PaymentAttempt::STATUS_PENDING_CUSTOMER, PaymentAttempt::query()->findOrFail($attempt->id)->capture_status);
    }

    // ═══════════════ لا دفتر موازٍ ═══════════════

    #[Test]
    public function the_orchestration_layer_never_touches_the_ledger_or_payment_services(): void
    {
        $forbidden = '/LedgerService|PaymentService|JournalEntry|JournalLine|InvoiceService|ZatcaService|CustomerRefund|PaymentGatewaySettlement|table\([\'"](journal_|payments[\'"]|invoices)/';
        $files = array_merge(
            [base_path('app/Services/PaymentOrchestrator.php'), base_path('app/Services/PaymentGatewayAdapterRegistry.php'), base_path('app/Services/FakePaymentGatewayAdapter.php'), base_path('app/Contracts/Payable.php'), base_path('app/Contracts/GatewayAdapter.php'), base_path('app/Models/PaymentAttempt.php')],
            glob(base_path('app/Support/Payment{Gateway,Attempt,Hosted,Provider,Orchestration}*.php'), GLOB_BRACE) ?: [],
        );
        $this->assertNotEmpty($files);
        foreach ($files as $file) {
            $this->assertDoesNotMatchRegularExpression($forbidden, php_strip_whitespace($file), basename($file).' (الشيفرة بلا تعليقات)');
        }
    }

    // ───────────────────────── مساعدات ─────────────────────────

    private function activeGateway(string $name = 'Fake'): PaymentGateway
    {
        $gateway = PaymentGateway::query()->create(['provider' => 'fake', 'name' => $name, 'environment' => 'sandbox']);
        DB::table('payment_gateways')->where('id', $gateway->id)->update(['status' => PaymentGateway::STATUS_ACTIVE, 'is_active' => true]);

        return $gateway->fresh();
    }

    private function enableRollout(?string $tenantId = null): void
    {
        app(PaymentsRolloutControlService::class)->setTenantState($this->admin, $tenantId ?? $this->tenant->id, true, 'تفعيل للاختبار');
    }

    private function assertNoFinancialArtifacts(): void
    {
        $this->assertSame(0, Payment::query()->count());
        $this->assertSame(0, JournalEntry::query()->count());
        $this->assertSame(0, JournalLine::query()->count());
    }
}
