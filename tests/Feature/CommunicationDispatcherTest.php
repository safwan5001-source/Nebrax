<?php

namespace Tests\Feature;

use App\Contracts\CommunicationProvider;
use App\Services\Communications\CommunicationDispatcher;
use App\Services\Communications\CommunicationProviderRegistry;
use App\Services\Communications\DispatchPolicy;
use App\Support\Communications\CommunicationChannel;
use App\Support\Communications\CommunicationsConfigurationException;
use App\Support\Communications\DispatchResult;
use App\Support\Communications\MessageClassification;
use App\Support\Communications\ProviderCapabilities;
use App\Support\Communications\TenantMismatchException;
use App\Tenancy\TenantContext;
use Illuminate\Console\Scheduling\Schedule;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use InvalidArgumentException;
use LogicException;
use PHPUnit\Framework\Attributes\Test;
use RuntimeException;
use Tests\TestCase;

/**
 * AWJ-COMMS-03-A — الموزّع: مطالبة ذرّية، محاولة `started` ملتزَمة قبل المزوّد، إنهاء محروس بالإيجار، إعادة محاولة بتراجع،
 * غموض بلا إعادة إرسال، استرجاع إيجارات، عزل المستأجر، OTP لا يُطالَب به، وخصوصية (لا عنوان/حمولة في السجلات).
 * المزوّد دائماً من `tests/` (بلا شبكة). التزامن الحقيقي والأوامر في ملف PostgreSQL المنفصل.
 */
class CommunicationDispatcherTest extends TestCase
{
    use InteractsWithCommunicationDispatch;
    use InteractsWithCommunicationEnqueue;
    use InteractsWithCommunicationSchema;
    use RefreshDatabase;

    private const ADDRESS = '+966555123456';

    protected function setUp(): void
    {
        parent::setUp();
        $this->configureCommunicationsHmac();
        config([
            'communications.policy' => [
                'otp' => ['ttl_seconds' => 300, 'max_attempts' => 1],
                'transactional' => ['ttl_seconds' => 3600, 'max_attempts' => 3],
                'service' => ['ttl_seconds' => 7200, 'max_attempts' => 2],
            ],
            'communications.dispatch' => ['lease_seconds' => 120, 'receipt_window_seconds' => 259200, 'backoff_seconds' => [60, 300, 900]],
        ]);
        $this->travelTo(now()->startOfSecond()); // زمن مجمَّد: مقارنات المواعيد دقيقة.
    }

    // ───────────────────────── المسار السعيد ─────────────────────────

    #[Test]
    public function an_accepted_send_commits_the_started_attempt_before_the_provider_and_finalizes_with_a_scrubbed_payload(): void
    {
        $tenant = $this->commTenant();
        $id = $this->enqueueMessage($tenant->id, ['address' => self::ADDRESS, 'variables' => ['invoice_no' => 'INV-9']]);
        $base = DB::transactionLevel();
        $during = [];
        $provider = $this->probe(function ($intent) use (&$during, $id, $base) {
            $during = ['row' => $this->messageRow($id), 'attempts' => $this->attemptRows($id), 'level' => DB::transactionLevel(), 'base' => $base];

            return DispatchResult::accepted('prov-123');
        });

        $summary = $this->dispatcherFor($provider)->dispatchDue($tenant->id);

        $this->assertSame(['accepted' => 1, 'claimed' => 1], $summary->toArray());

        // لحظة استدعاء المزوّد: المطالبة والمحاولة ملتزَمتان، ولا معاملة مفتوحة من الموزّع.
        $this->assertSame('sending', $during['row']->status);
        $this->assertSame(1, (int) $during['row']->attempt_count);
        $this->assertNotNull($during['row']->lease_token);
        $this->assertNotNull($during['row']->payload_encrypted, 'the payload is still needed while sending');
        $this->assertCount(1, $during['attempts']);
        $this->assertSame('started', $during['attempts'][0]->outcome);
        $this->assertSame('probe', $during['attempts'][0]->provider_key);
        $this->assertSame($during['base'], $during['level'], 'no provider call inside a database transaction');

        $row = $this->messageRow($id);
        $this->assertSame('accepted', $row->status);
        $this->assertNull($row->payload_encrypted);
        $this->assertNull($row->lease_token);
        $this->assertNull($row->lease_until);
        $this->assertNull($row->next_attempt_at);
        $this->assertNull($row->last_error_code);
        $this->assertNotNull($row->accepted_at);
        $this->assertSame(now()->addSeconds(259200)->toDateTimeString(), (string) $row->receipt_deadline_at);

        $attempt = $this->attemptRows($id)[0];
        $this->assertSame('accepted', $attempt->outcome);
        $this->assertSame('prov-123', $attempt->provider_message_id);
        $this->assertNotNull($attempt->finished_at);

        // ما وصل المزوّد: النيّة المفكوكة كاملة + مفتاح تكرار ثابت لكل رسالة.
        $intent = $provider->received[0];
        $this->assertSame(self::ADDRESS, $intent->recipient->address);
        $this->assertSame(['invoice_no' => 'INV-9'], $intent->variables);
        $this->assertSame('cm:'.$id, $intent->idempotencyKey);
        $this->assertSame('invoice.issued', $intent->templateKey);
        $this->assertSame(MessageClassification::Transactional, $intent->classification);

        // لا إعادة إرسال لما قُبل.
        $this->dispatcherFor($provider)->dispatchDue($tenant->id);
        $this->assertCount(1, $provider->received);
    }

    #[Test]
    public function a_retryable_failure_backs_off_then_exhausts_into_a_permanent_failure_with_one_attempt_row_each(): void
    {
        $tenant = $this->commTenant();
        $id = $this->enqueueMessage($tenant->id);
        $provider = $this->probe(fn () => DispatchResult::retryableFailure('http_503'));
        $dispatcher = $this->dispatcherFor($provider);

        $first = $dispatcher->dispatchDue($tenant->id);
        $this->assertSame(['claimed' => 1, 'retry_scheduled' => 1], $first->toArray());
        $row = $this->messageRow($id);
        $this->assertSame('retry_scheduled', $row->status);
        $this->assertSame(1, (int) $row->attempt_count);
        $this->assertSame(now()->addSeconds(60)->toDateTimeString(), (string) $row->next_attempt_at);
        $this->assertNotNull($row->payload_encrypted, 'the payload is kept for the next attempt');
        $this->assertNull($row->lease_token);
        $this->assertSame('http_503', $row->last_error_code);

        // غير مستحقة بعد: لا مطالبة ولا إرسال.
        $dispatcher->dispatchDue($tenant->id);
        $this->assertCount(1, $provider->received);

        $this->travel(61)->seconds();
        $dispatcher->dispatchDue($tenant->id);
        $this->assertSame(now()->addSeconds(300)->toDateTimeString(), (string) $this->messageRow($id)->next_attempt_at);

        $this->travel(301)->seconds();
        $last = $dispatcher->dispatchDue($tenant->id);
        $this->assertSame(['claimed' => 1, 'failed_permanent' => 1], $last->toArray());
        $row = $this->messageRow($id);
        $this->assertSame('failed_permanent', $row->status);
        $this->assertSame(3, (int) $row->attempt_count);
        $this->assertNull($row->payload_encrypted);
        $this->assertNotNull($row->settled_at);
        $this->assertSame('final_status', $row->settled_reason);
        $this->assertSame('http_503', $row->last_error_code);

        $attempts = $this->attemptRows($id);
        $this->assertSame([1, 2, 3], array_map(fn ($a) => (int) $a->attempt_no, $attempts));
        $this->assertSame(['retryable_failure', 'retryable_failure', 'retryable_failure'], array_map(fn ($a) => $a->outcome, $attempts));

        $this->travel(100000)->seconds();
        $dispatcher->dispatchDue($tenant->id);
        $this->assertCount(3, $provider->received, 'a terminal message is never sent again');
    }

    #[Test]
    public function a_retryable_failure_after_the_message_expired_ends_expired_not_rescheduled(): void
    {
        $tenant = $this->commTenant();
        $id = $this->enqueueMessage($tenant->id);
        $provider = $this->probe(function () {
            $this->travel(4000)->seconds(); // تنقضي الصلاحية (3600) أثناء الاستدعاء.

            return DispatchResult::retryableFailure('http_503');
        });

        $summary = $this->dispatcherFor($provider)->dispatchDue($tenant->id);

        $this->assertSame(['claimed' => 1, 'expired' => 1], $summary->toArray());
        $row = $this->messageRow($id);
        $this->assertSame('expired', $row->status);
        $this->assertNull($row->payload_encrypted);
        $this->assertSame('final_status', $row->settled_reason);
    }

    #[Test]
    public function permanent_and_unsupported_results_are_terminal_and_scrub_the_payload(): void
    {
        $tenant = $this->commTenant();
        $permanent = $this->enqueueMessage($tenant->id);
        $this->dispatcherFor($this->probe(fn () => DispatchResult::permanentFailure('rejected')))->dispatchDue($tenant->id);

        $row = $this->messageRow($permanent);
        $this->assertSame(['failed_permanent', 'rejected'], [$row->status, $row->last_error_code]);
        $this->assertNull($row->payload_encrypted);
        $this->assertNotNull($row->settled_at);
        $this->assertSame('permanent_failure', $this->attemptRows($permanent)[0]->outcome);

        $unsupported = $this->enqueueMessage($tenant->id);
        $this->dispatcherFor($this->probe(fn () => DispatchResult::unsupported()))->dispatchDue($tenant->id);
        $row = $this->messageRow($unsupported);
        $this->assertSame('failed_permanent', $row->status);
        $this->assertSame('unsupported', $this->attemptRows($unsupported)[0]->outcome);
    }

    #[Test]
    public function an_unknown_outcome_waits_for_a_receipt_and_is_never_resent(): void
    {
        $tenant = $this->commTenant();
        $id = $this->enqueueMessage($tenant->id);
        $provider = $this->probe(fn () => DispatchResult::unknown('timeout'));
        $dispatcher = $this->dispatcherFor($provider);

        $summary = $dispatcher->dispatchDue($tenant->id);

        $this->assertSame(['claimed' => 1, 'unknown' => 1], $summary->toArray());
        $row = $this->messageRow($id);
        $this->assertSame('unknown', $row->status);
        $this->assertNull($row->payload_encrypted, 'nothing to resend: the payload is gone');
        $this->assertNull($row->settled_at, 'unknown is not settled until a receipt or the window elapses');
        $this->assertSame(now()->addSeconds(259200)->toDateTimeString(), (string) $row->receipt_deadline_at);
        $this->assertSame('timeout', $row->last_error_code);

        $this->travel(2)->days();
        $dispatcher->dispatchDue($tenant->id);
        $this->assertCount(1, $provider->received);
        $this->assertSame('unknown', $this->messageRow($id)->status, 'never auto-converted to expired or failed');
    }

    #[Test]
    public function a_provider_exception_is_an_unknown_outcome_and_leaks_nothing(): void
    {
        $tenant = $this->commTenant();
        $id = $this->enqueueMessage($tenant->id, ['address' => self::ADDRESS, 'variables' => ['invoice_no' => 'SECRET-INV']]);
        Log::spy();
        $provider = $this->probe(fn () => throw new RuntimeException('boom '.self::ADDRESS.' SECRET-INV'));

        $summary = $this->dispatcherFor($provider)->dispatchDue($tenant->id);

        $this->assertSame(['claimed' => 1, 'unknown' => 1], $summary->toArray());
        $this->assertSame('provider_exception', $this->messageRow($id)->last_error_code);
        Log::shouldHaveReceived('error')->withArgs(function (string $message, array $context) use ($id) {
            return $message === 'communications.dispatch.provider_exception'
                && array_keys($context) === ['tenant_id', 'message_id', 'exception']
                && $context['message_id'] === $id
                && ! str_contains(json_encode($context), self::ADDRESS)
                && ! str_contains(json_encode($context), 'SECRET-INV');
        })->once();
    }

    // ───────────────────────── ما لا يُطالَب به ─────────────────────────

    #[Test]
    public function expired_not_yet_due_and_otp_messages_are_never_claimed(): void
    {
        $tenant = $this->commTenant();
        // expires_at عمود هوية ثابت: الرسالة قصيرة العمر تُنشأ بسياسة TTL قصيرة ثم يمرّ الزمن.
        $expired = $this->enqueueShortLived($tenant->id);
        $future = $this->enqueueMessage($tenant->id);
        DB::table('communication_messages')->where('id', $future)->update(['next_attempt_at' => now()->addMinutes(10)->toDateTimeString()]);
        $otp = $this->enqueueMessage($tenant->id, [
            'classification' => MessageClassification::Otp, 'template' => 'auth.otp', 'source' => 'auth.otp', 'variables' => ['code' => '482913'],
        ]);
        $provider = $this->probe();
        $this->travel(120)->seconds(); // تنقضي الرسالة القصيرة (60ث) وتبقى الأخرى حيّة وغير مستحقة

        $summary = $this->dispatcherFor($provider)->dispatchDue($tenant->id);

        $this->assertSame([], $summary->toArray());
        $this->assertSame([], $provider->received);
        foreach ([$expired, $future, $otp] as $id) {
            $this->assertSame('queued', $this->messageRow($id)->status);
            $this->assertSame([], $this->attemptRows($id));
        }
        $this->assertNull($this->messageRow($otp)->payload_encrypted, 'an OTP row never carried a payload to begin with');
    }

    #[Test]
    public function without_a_capable_provider_nothing_is_claimed(): void
    {
        $tenant = $this->commTenant();
        $id = $this->enqueueMessage($tenant->id);

        $this->assertSame([], $this->dispatcherFor()->dispatchDue($tenant->id)->toArray(), 'empty registry');

        $emailOnly = new CommunicationsProbeProvider('email-only', new ProviderCapabilities([CommunicationChannel::Email], [MessageClassification::Transactional]), fn () => DispatchResult::accepted());
        $this->assertSame([], $this->dispatcherFor($emailOnly)->dispatchDue($tenant->id)->toArray(), 'sms is not served');

        $this->assertSame('queued', $this->messageRow($id)->status);
        $this->assertSame([], $this->attemptRows($id));
        $this->assertSame([], $emailOnly->received);
    }

    #[Test]
    public function an_unreadable_payload_fails_permanently_without_calling_the_provider(): void
    {
        $tenant = $this->commTenant();
        $id = $this->enqueueMessage($tenant->id);
        DB::table('communication_messages')->where('id', $id)->update(['payload_encrypted' => 'not-a-valid-ciphertext']);
        $provider = $this->probe();

        $summary = $this->dispatcherFor($provider)->dispatchDue($tenant->id);

        $this->assertSame(['claimed' => 1, 'failed_permanent' => 1], $summary->toArray());
        $this->assertSame([], $provider->received);
        $row = $this->messageRow($id);
        $this->assertSame(['failed_permanent', 'payload_unreadable'], [$row->status, $row->last_error_code]);
        $this->assertNull($row->payload_encrypted);
        $this->assertSame('permanent_failure', $this->attemptRows($id)[0]->outcome);
    }

    #[Test]
    public function an_unsafe_provider_message_id_is_dropped_not_stored_truncated(): void
    {
        $tenant = $this->commTenant();
        $ids = [];
        foreach (['has a space', str_repeat('a', 192), 'ok-id_1.2'] as $providerId) {
            $id = $this->enqueueMessage($tenant->id);
            $this->dispatcherFor($this->probe(fn () => DispatchResult::accepted($providerId)))->dispatchDue($tenant->id);
            $ids[] = $this->attemptRows($id)[0]->provider_message_id;
        }

        $this->assertSame([null, null, 'ok-id_1.2'], $ids);
    }

    // ───────────────────────── العزل والحراسة ─────────────────────────

    #[Test]
    public function dispatching_one_tenant_never_touches_another_and_a_mismatched_context_is_refused(): void
    {
        $a = $this->commTenant('a');
        $b = $this->commTenant('b');
        $mineId = $this->enqueueMessage($a->id, ['address' => '+966500000001']);
        $theirsId = $this->enqueueMessage($b->id, ['address' => '+966500000002']);
        $provider = $this->probe();
        $dispatcher = $this->dispatcherFor($provider);

        app(TenantContext::class)->set($a->id);
        $summary = $dispatcher->dispatchDue($a->id);

        $this->assertSame(1, $summary->get('accepted'));
        $this->assertSame('accepted', $this->messageRow($mineId)->status);
        $this->assertSame('queued', $this->messageRow($theirsId)->status);
        $this->assertSame([], $this->attemptRows($theirsId));
        $this->assertSame(['+966500000001'], array_map(fn ($i) => $i->recipient->address, $provider->received));

        try {
            $dispatcher->dispatchDue($b->id); // السياق ما زال A.
            $this->fail('a dispatcher call for another tenant must be refused');
        } catch (TenantMismatchException) {
        }
        try {
            $dispatcher->recoverExpiredLeases($b->id);
            $this->fail('recovery for another tenant must be refused');
        } catch (TenantMismatchException) {
        }

        app(TenantContext::class)->forget();
        $this->expectException(TenantMismatchException::class);
        $dispatcher->dispatchDue($a->id);
    }

    #[Test]
    public function running_inside_an_open_business_transaction_is_refused(): void
    {
        $tenant = $this->commTenant();
        $this->enqueueMessage($tenant->id);
        $dispatcher = $this->dispatcherFor($this->probe());

        DB::beginTransaction();
        try {
            $this->expectException(LogicException::class);
            $dispatcher->dispatchDue($tenant->id);
        } finally {
            DB::rollBack();
        }
    }

    // ───────────────────────── الإيجار والـFencing ─────────────────────────

    #[Test]
    public function a_late_result_after_the_lease_was_recovered_never_overwrites_the_newer_state(): void
    {
        $tenant = $this->commTenant();
        $id = $this->enqueueMessage($tenant->id);
        $holder = null;
        $provider = $this->probe(function () use (&$holder, $tenant) {
            $this->travel(121)->seconds(); // ينقضي الإيجار أثناء الاستدعاء
            $holder->recoverExpiredLeases($tenant->id);

            return DispatchResult::accepted('late-id');
        });
        $holder = $this->dispatcherFor($provider);

        $summary = $holder->dispatchDue($tenant->id);

        $this->assertSame(['claimed' => 1, 'lease_lost' => 1], $summary->toArray());
        $row = $this->messageRow($id);
        $this->assertSame('unknown', $row->status, 'a non-idempotent provider is never auto-resent');
        $this->assertNull($row->accepted_at, 'the late acceptance was discarded');
        $this->assertSame('lease_expired', $row->last_error_code);
        $attempt = $this->attemptRows($id)[0];
        $this->assertSame(['abandoned', 'lease_expired', null], [$attempt->outcome, $attempt->error_code, $attempt->provider_message_id]);
    }

    #[Test]
    public function an_idempotent_provider_is_retried_with_the_same_stable_key_after_a_lost_lease(): void
    {
        $tenant = $this->commTenant();
        $id = $this->enqueueMessage($tenant->id);
        $holder = null;
        $calls = 0;
        $provider = $this->probe(function () use (&$holder, &$calls, $tenant) {
            if (++$calls === 1) {
                $this->travel(121)->seconds();
                $holder->recoverExpiredLeases($tenant->id);
            }

            return DispatchResult::accepted('prov-'.$calls);
        }, idempotent: true);
        $holder = $this->dispatcherFor($provider);

        $holder->dispatchDue($tenant->id);

        $row = $this->messageRow($id);
        $this->assertSame('retry_scheduled', $row->status);
        $this->assertNotNull($row->payload_encrypted, 'the payload is kept for the safe retry');
        $this->assertSame(now()->addSeconds(60)->toDateTimeString(), (string) $row->next_attempt_at);

        $this->travel(61)->seconds();
        $holder->dispatchDue($tenant->id);

        $this->assertSame('accepted', $this->messageRow($id)->status);
        $this->assertSame(['cm:'.$id, 'cm:'.$id], array_map(fn ($i) => $i->idempotencyKey, $provider->received));
        $this->assertSame(['abandoned', 'accepted'], array_map(fn ($a) => $a->outcome, $this->attemptRows($id)));
    }

    #[Test]
    public function recovery_turns_an_expired_lease_into_unknown_for_a_non_idempotent_provider(): void
    {
        $tenant = $this->commTenant();
        $id = $this->enqueueMessage($tenant->id);
        $this->strandInSending($tenant->id, $id);
        $dispatcher = $this->dispatcherFor($this->probe());

        $summary = $dispatcher->recoverExpiredLeases($tenant->id);

        $this->assertSame(['recovered_unknown' => 1], $summary->toArray());
        $row = $this->messageRow($id);
        $this->assertSame('unknown', $row->status);
        $this->assertNull($row->payload_encrypted);
        $this->assertNull($row->lease_token);
        $this->assertSame('lease_expired', $row->last_error_code);
        $this->assertSame(now()->addSeconds(259200)->toDateTimeString(), (string) $row->receipt_deadline_at);
        $attempt = $this->attemptRows($id)[0];
        $this->assertSame(['abandoned', 'lease_expired'], [$attempt->outcome, $attempt->error_code]);
        $this->assertNotNull($attempt->finished_at);
    }

    #[Test]
    public function recovery_reschedules_only_when_the_provider_is_idempotent_attempts_remain_and_the_message_is_alive(): void
    {
        $tenant = $this->commTenant();
        $idempotent = $this->probe(idempotent: true);

        // 1) مزوّد يمنع التكرار + محاولات متبقية + صلاحية قائمة ⇒ إعادة جدولة.
        $retry = $this->enqueueMessage($tenant->id);
        $this->strandInSending($tenant->id, $retry);
        // 2) محاولات منتهية ⇒ unknown.
        $exhausted = $this->enqueueMessage($tenant->id);
        $this->strandInSending($tenant->id, $exhausted, attemptNo: 3);
        // 3) رسالة منتهية الصلاحية ⇒ unknown.
        $expired = $this->enqueueShortLived($tenant->id);
        $this->strandInSending($tenant->id, $expired);
        // 4) مفتاح مزوّد غير مسجَّل ⇒ unknown.
        $orphan = $this->enqueueMessage($tenant->id);
        $this->strandInSending($tenant->id, $orphan, providerKey: 'gone');

        $this->travel(120)->seconds(); // الرسالة القصيرة (60ث) انتهت؛ الإيجارات كلها منقضية أصلاً
        $summary = $this->dispatcherFor($idempotent)->recoverExpiredLeases($tenant->id);

        $this->assertSame(['recovered_retry_scheduled' => 1, 'recovered_unknown' => 3], $summary->toArray());
        $this->assertSame('retry_scheduled', $this->messageRow($retry)->status);
        $this->assertNotNull($this->messageRow($retry)->payload_encrypted);
        $this->assertSame(now()->addSeconds(60)->toDateTimeString(), (string) $this->messageRow($retry)->next_attempt_at);
        foreach ([$exhausted, $expired, $orphan] as $id) {
            $this->assertSame('unknown', $this->messageRow($id)->status);
            $this->assertNull($this->messageRow($id)->payload_encrypted);
        }
    }

    #[Test]
    public function a_live_lease_is_left_alone_and_recovery_never_crosses_tenants(): void
    {
        $a = $this->commTenant('a');
        $b = $this->commTenant('b');
        $live = $this->enqueueMessage($a->id);
        $this->strandInSending($a->id, $live, leaseExpiredSecondsAgo: -60); // لم ينقضِ بعد
        $theirs = $this->enqueueMessage($b->id);
        $this->strandInSending($b->id, $theirs);
        $dispatcher = $this->dispatcherFor($this->probe());

        app(TenantContext::class)->set($a->id);
        $summary = $dispatcher->recoverExpiredLeases($a->id);

        $this->assertSame([], $summary->toArray());
        $this->assertSame('sending', $this->messageRow($live)->status);
        $this->assertSame('sending', $this->messageRow($theirs)->status, 'tenant B was not touched');
        $this->assertSame('started', $this->attemptRows($theirs)[0]->outcome);
    }

    // ───────────────────────── السجل والسياسة والحاوية ─────────────────────────

    #[Test]
    public function the_registry_is_deterministic_rejects_duplicates_and_never_offers_otp(): void
    {
        $first = $this->probe(key: 'first');
        $second = $this->probe(key: 'second');
        $registry = (new CommunicationProviderRegistry())->register($first)->register($second);

        $this->assertSame($first, $registry->resolve(CommunicationChannel::Sms, MessageClassification::Transactional));
        $this->assertSame($second, $registry->byKey('second'));
        $this->assertNull($registry->resolve(CommunicationChannel::Push, MessageClassification::Transactional));
        foreach ($registry->supportedPairs() as [, $classification]) {
            $this->assertNotSame(MessageClassification::Otp, $classification);
        }

        $this->expectException(InvalidArgumentException::class);
        $registry->register($this->probe(key: 'first'));
    }

    #[Test]
    public function an_invalid_dispatch_policy_fails_closed(): void
    {
        $valid = ['lease_seconds' => 120, 'receipt_window_seconds' => 259200, 'backoff_seconds' => [60]];
        foreach ([
            ['lease_seconds' => 5], ['lease_seconds' => 99999], ['receipt_window_seconds' => 10], ['backoff_seconds' => []],
            ['backoff_seconds' => [0]], ['backoff_seconds' => ['60']], ['backoff_seconds' => array_fill(0, 11, 60)], ['backoff_seconds' => ['a' => 60]],
            ['lease_seconds' => '120'],
        ] as $bad) {
            config(['communications.dispatch' => $bad + $valid]);
            try {
                DispatchPolicy::fromConfig();
                $this->fail('policy must be rejected: '.json_encode($bad));
            } catch (CommunicationsConfigurationException) {
            }
        }

        config(['communications.dispatch' => null]);
        $this->expectException(CommunicationsConfigurationException::class);
        DispatchPolicy::fromConfig();
    }

    #[Test]
    public function backoff_repeats_the_last_delay_after_the_list_is_exhausted(): void
    {
        $policy = new DispatchPolicy(120, 259200, [60, 300, 900]);

        $this->assertSame([60, 300, 900, 900, 900], array_map(fn ($n) => $policy->backoffAfterAttempt($n), [1, 2, 3, 4, 10]));
    }

    #[Test]
    public function nothing_is_bound_scheduled_or_sendable_by_default(): void
    {
        $this->assertFalse(app()->bound(CommunicationProvider::class), 'no provider is bound in the container');
        $this->assertTrue(app(CommunicationProviderRegistry::class)->isEmpty(), 'the registry ships empty');

        $scheduled = collect(app(Schedule::class)->events())->map(fn ($e) => (string) $e->command)->filter(fn ($c) => str_contains($c, 'communications'));
        $this->assertCount(0, $scheduled, 'the dispatcher commands are not scheduled');

        $tenant = $this->commTenant();
        $id = $this->enqueueMessage($tenant->id);
        $this->artisan('communications:dispatch')->expectsOutputToContain('لم يُوزَّع')->assertExitCode(0);
        $this->assertSame('queued', $this->messageRow($id)->status);

        $this->artisan('communications:dispatch', ['--limit' => 0])->assertExitCode(0); // سجل فارغ يسبق التحقق من الحد
        $this->artisan('communications:recover-leases', ['--limit' => 501])->assertExitCode(2);
    }

    #[Test]
    public function the_dispatcher_sources_use_no_network_http_or_raw_ledger_access(): void
    {
        foreach (['CommunicationDispatcher', 'CommunicationProviderRegistry', 'DispatchPolicy', 'RunSummary'] as $class) {
            $source = file_get_contents(base_path("app/Services/Communications/{$class}.php"));
            foreach (['Http::', 'curl_', 'GuzzleHttp', 'file_get_contents(\'http', 'Mail::', 'journal_lines', 'journal_entries', 'LedgerService'] as $needle) {
                $this->assertStringNotContainsString($needle, $source, "{$class} must not reference {$needle}");
            }
        }
    }
}
