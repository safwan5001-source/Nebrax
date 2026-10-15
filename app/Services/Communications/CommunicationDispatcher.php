<?php

namespace App\Services\Communications;

use App\Models\CommunicationMessage;
use App\Contracts\CommunicationProvider;
use App\Models\CommunicationMessageAttempt;
use App\Support\Communications\CommunicationChannel;
use App\Support\Communications\DeliveryStatus;
use App\Support\Communications\DispatchOutcome;
use App\Support\Communications\DispatchResult;
use App\Support\Communications\MessageClassification;
use App\Support\Communications\MessageIntent;
use App\Support\Communications\MessageRecipient;
use App\Support\Communications\TenantMismatchException;
use App\Tenancy\TenantContext;
use Carbon\CarbonImmutable;
use Illuminate\Contracts\Encryption\DecryptException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;
use LogicException;
use Throwable;

/**
 * AWJ-COMMS-03-A — موزّع الـOutbox: يطالب بالمستحق، يُلتزم محاولة `started` قبل أي استدعاء للمزوّد، ثم يُنهي بنتيجة
 * محروسة بالإيجار، ويسترجع الإيجارات المنقضية. **لا يعمل شيء منه تلقائياً** (لا جدولة ولا عامل)، والسجل فارغ افتراضياً
 * فلا يُرسَل شيء في أي بيئة ما لم يُسجَّل مزوّد صراحةً في الشيفرة.
 *
 * ضمانات:
 *  - **المطالبة ذرّية:** `UPDATE` واحد محروس (`status`، الاستحقاق، الصلاحية، سقف المحاولات، وجود الحمولة) يزيد `attempt_count`
 *    ويثبّت `lease_token` ويُدرج صف المحاولة في المعاملة نفسها. من يخسر السباق يرى 0 صفوف ولا يرسل. لا `SKIP LOCKED`
 *    (غير محمول على SQLite)؛ القيد الفريد للمحاولة الجارية الواحدة خط دفاع ثانٍ.
 *  - **لا استدعاء مزوّد داخل معاملة قاعدة بيانات.** المطالبة تلتزم أولاً، ثم يُستدعى المزوّد، ثم تُنهي معاملة ثانية.
 *  - **Fencing:** الإنهاء يشترط `status = sending` و`lease_token` المخصّص لهذه المطالبة. إن استُرجع الإيجار أثناء الاستدعاء
 *    يفشل الشرط (`lease_lost`) ولا تُكتب نتيجة متأخرة فوق الحالة الأحدث؛ تسوية الغموض عبر الإيصالات (شريحة 08).
 *  - **انتقالات أحادية** بحسب `DeliveryStatus::canTransitionTo`؛ الحمولة تُمسح في الجملة نفسها عند مغادرة الحالات القابلة للإرسال.
 *  - **OTP لا يُطالَب به أبداً** (حمولته NULL ولا جسر OTP هنا)، و`unknown` لا يُعاد إرساله تلقائياً.
 *  - الاسترجاع: مزوّد يعلن `providerIdempotency` + محاولات متبقية + صلاحية قائمة ⇒ إعادة جدولة بالمفتاح الثابت نفسه؛ وإلا ⇒ `unknown`.
 *  - لا تسجيل لحمولة أو عنوان أو نص مزوّد: معرّفات المستأجر/الرسالة وأسماء الأصناف وSQLSTATE فقط.
 */
final class CommunicationDispatcher
{
    public const MAX_BATCH = 500;

    private const LEAVE_SENDING = ['lease_token' => null, 'lease_until' => null];

    public function __construct(
        private readonly TenantContext $tenantContext,
        private readonly CommunicationProviderRegistry $registry,
        private readonly DispatchPolicy $policy,
        private readonly int $baseTransactionLevel = 0,
    ) {
    }

    /**
     * `$baseTransactionLevel`: مستوى المعاملات الذي يُسمح بالتشغيل عنده. الإنتاج 0: يُرفض التشغيل داخل معاملة أعمال مفتوحة
     * لأن المطالبة لن تكون ملتزَمة قبل استدعاء المزوّد. الاختبارات داخل معاملة RefreshDatabase تمرّر مستواها الحالي.
     */
    public static function make(CommunicationProviderRegistry $registry, int $baseTransactionLevel = 0): self
    {
        return new self(app(TenantContext::class), $registry, DispatchPolicy::fromConfig(), $baseTransactionLevel);
    }

    /** يوزّع حتى `$limit` رسالة مستحقة للمستأجر المحدد (المتطابق مع سياق المستأجر الموثوق). */
    public function dispatchDue(string $tenantId, int $limit = 50): RunSummary
    {
        $this->assertTrustedTenant($tenantId);
        $summary = new RunSummary();

        $pairs = $this->registry->supportedPairs();
        if ($pairs === []) {
            return $summary; // بلا مزوّد: لا مطالبة ولا قراءة.
        }

        $now = CarbonImmutable::now();
        $candidates = CommunicationMessage::query()
            ->where('tenant_id', $tenantId)
            ->whereIn('status', [DeliveryStatus::Queued->value, DeliveryStatus::RetryScheduled->value])
            ->whereNotNull('payload_encrypted')
            ->where('next_attempt_at', '<=', $now)
            ->where('expires_at', '>', $now)
            ->whereColumn('attempt_count', '<', 'max_attempts')
            ->where(function ($query) use ($pairs): void {
                foreach ($pairs as [$channel, $classification]) {
                    $query->orWhere(fn ($pair) => $pair->where('channel', $channel->value)->where('classification', $classification->value));
                }
            })
            ->orderBy('next_attempt_at')->orderBy('id')
            ->limit(max(1, min($limit, self::MAX_BATCH)))
            ->get(['id', 'channel', 'classification']);

        foreach ($candidates as $candidate) {
            try {
                $this->dispatchOne($tenantId, $candidate, $summary);
            } catch (Throwable $e) {
                // فشل رسالة واحدة (قاعدة بيانات/حالة غير متوقعة) لا يوقف الدفعة؛ الإيجار المتروك يسترجعه المسار الآخر.
                $summary->increment('errors');
                Log::error('communications.dispatch.error', ['tenant_id' => $tenantId, 'message_id' => $candidate->id, 'exception' => $e::class]);
            }
        }

        return $summary;
    }

    /** يسترجع حتى `$limit` إيجاراً منقضياً: إعادة جدولة آمنة أو `unknown`، ويُسقط المحاولة الجارية كـ`abandoned`. */
    public function recoverExpiredLeases(string $tenantId, int $limit = 50): RunSummary
    {
        $this->assertTrustedTenant($tenantId);
        $summary = new RunSummary();

        $now = CarbonImmutable::now();
        $stale = CommunicationMessage::query()
            ->where('tenant_id', $tenantId)
            ->where('status', DeliveryStatus::Sending->value)
            ->where('lease_until', '<', $now)
            ->orderBy('lease_until')->orderBy('id')
            ->limit(max(1, min($limit, self::MAX_BATCH)))
            ->get(['id', 'classification', 'attempt_count', 'max_attempts', 'expires_at', 'lease_token']);

        foreach ($stale as $row) {
            try {
                $summary->increment($this->recoverOne($tenantId, $row));
            } catch (Throwable $e) {
                $summary->increment('errors');
                Log::error('communications.recovery.error', ['tenant_id' => $tenantId, 'message_id' => $row->id, 'exception' => $e::class]);
            }
        }

        return $summary;
    }

    // ───────────────────────── التوزيع ─────────────────────────

    private function dispatchOne(string $tenantId, CommunicationMessage $candidate, RunSummary $summary): void
    {
        $provider = $this->registry->resolve(
            CommunicationChannel::from($candidate->channel),
            MessageClassification::from($candidate->classification),
        );
        if ($provider === null) {
            $summary->increment('skipped_no_provider');

            return;
        }

        $token = (string) Str::uuid();
        $message = $this->claim($tenantId, $candidate->id, $token, $provider->key());
        if ($message === null) {
            $summary->increment('claim_lost'); // سباق: عامل آخر طالب بها أو لم تعد مستحقة.

            return;
        }
        $summary->increment('claimed');

        $result = $this->callProvider($provider, $message);
        $label = $this->finalize($tenantId, $message, $token, $result);
        $summary->increment($label);
    }

    /** مطالبة ذرّية: UPDATE محروس + صف المحاولة `started` في معاملة واحدة تلتزم قبل أي استدعاء للمزوّد. */
    private function claim(string $tenantId, string $messageId, string $token, string $providerKey): ?CommunicationMessage
    {
        return DB::transaction(function () use ($tenantId, $messageId, $token, $providerKey): ?CommunicationMessage {
            $now = CarbonImmutable::now();

            $claimed = CommunicationMessage::query()
                ->where('id', $messageId)
                ->where('tenant_id', $tenantId)
                ->whereIn('status', [DeliveryStatus::Queued->value, DeliveryStatus::RetryScheduled->value])
                ->whereNotNull('payload_encrypted')
                ->where('classification', '<>', MessageClassification::Otp->value)
                ->where('next_attempt_at', '<=', $now)
                ->where('expires_at', '>', $now)
                ->whereColumn('attempt_count', '<', 'max_attempts')
                ->update([
                    'status' => DeliveryStatus::Sending->value,
                    'attempt_count' => DB::raw('attempt_count + 1'),
                    'next_attempt_at' => null,
                    'lease_token' => $token,
                    'lease_until' => $now->addSeconds($this->policy->leaseSeconds),
                ]);

            if ($claimed !== 1) {
                return null;
            }

            $message = CommunicationMessage::query()->where('id', $messageId)->where('tenant_id', $tenantId)->firstOrFail();

            CommunicationMessageAttempt::query()->create([
                'tenant_id' => $tenantId,
                'message_id' => $messageId,
                'attempt_no' => (int) $message->attempt_count,
                'provider_key' => $providerKey,
                'outcome' => CommunicationMessageAttempt::OUTCOME_STARTED,
                'started_at' => $now,
            ]);

            return $message;
        });
    }

    /** يستدعي المزوّد خارج أي معاملة. أي استثناء بعد هذه النقطة يُعامَل غموضاً (قد تكون الرسالة خرجت). */
    private function callProvider(CommunicationProvider $provider, CommunicationMessage $message): DispatchResult
    {
        // المطالبة التزمت قبل هذه النقطة؛ لا استدعاء مزوّد داخل معاملة قاعدة بيانات أبداً.
        if (DB::transactionLevel() !== $this->baseTransactionLevel) {
            throw new LogicException('A provider must never be called inside a database transaction.');
        }

        try {
            $intent = $this->intentFor($message);
        } catch (DecryptException|\InvalidArgumentException|\TypeError) {
            return DispatchResult::permanentFailure('payload_unreadable'); // لم يُستدعَ المزوّد.
        }

        try {
            return $provider->send($intent);
        } catch (Throwable $e) {
            Log::error('communications.dispatch.provider_exception', [
                'tenant_id' => $message->tenant_id, 'message_id' => $message->id, 'exception' => $e::class,
            ]);

            return DispatchResult::unknown('provider_exception');
        }
    }

    /**
     * يعيد بناء النيّة من الحمولة المشفَّرة. مفتاح التكرار لدى المزوّد ثابت لكل رسالة (`cm:<id>`) فتتشاركه كل محاولاتها
     * (يعتمد عليه مزوّد يعلن `providerIdempotency` لمنع الإرسال المزدوج بعد استرجاع الإيجار).
     */
    private function intentFor(CommunicationMessage $message): MessageIntent
    {
        $payload = $message->payload_encrypted;
        if (! is_array($payload) || ! is_string($payload['address'] ?? null) || ! is_array($payload['variables'] ?? null)) {
            throw new \InvalidArgumentException('Unreadable payload.');
        }

        return new MessageIntent(
            tenantId: $message->tenant_id,
            classification: MessageClassification::from($message->classification),
            recipient: new MessageRecipient(CommunicationChannel::from($message->channel), $payload['address']),
            templateKey: $message->template_key,
            idempotencyKey: 'cm:'.$message->id,
            source: $message->source,
            variables: $payload['variables'],
        );
    }

    /** @return string وسم النتيجة للعدّادات */
    private function finalize(string $tenantId, CommunicationMessage $message, string $token, DispatchResult $result): string
    {
        return DB::transaction(function () use ($tenantId, $message, $token, $result): string {
            $now = CarbonImmutable::now();
            $windowEnd = $now->addSeconds($this->policy->receiptWindowSeconds);
            $code = $result->errorCode;
            $settled = ['settled_at' => $now, 'settled_reason' => CommunicationMessage::SETTLED_FINAL_STATUS];

            [$first, $values] = match ($result->outcome) {
                DispatchOutcome::Accepted => [DeliveryStatus::Accepted, [
                    'payload_encrypted' => null, 'next_attempt_at' => null, 'accepted_at' => $now,
                    'receipt_deadline_at' => $windowEnd, 'last_error_code' => null,
                ]],
                DispatchOutcome::PermanentFailure, DispatchOutcome::Unsupported => [DeliveryStatus::FailedPermanent, [
                    'payload_encrypted' => null, 'next_attempt_at' => null, 'last_error_code' => $code,
                ] + $settled],
                DispatchOutcome::Unknown => [DeliveryStatus::Unknown, [
                    'payload_encrypted' => null, 'next_attempt_at' => null, 'receipt_deadline_at' => $windowEnd,
                    'last_error_code' => $code,
                ]],
                DispatchOutcome::RetryableFailure => [DeliveryStatus::FailedRetryable, [
                    'next_attempt_at' => null, 'last_error_code' => $code,
                ]],
            };

            // فاصل الإيجار: لا انتقال إلا إن بقي الإيجار بيد هذه المطالبة.
            if ($this->transition($tenantId, $message->id, DeliveryStatus::Sending, $first, $values + self::LEAVE_SENDING, $token) !== 1) {
                return 'lease_lost';
            }

            $this->finishAttempt($tenantId, $message, $result, $now);

            if ($first !== DeliveryStatus::FailedRetryable) {
                return $first->value;
            }

            // إخفاق قابل لإعادة المحاولة: failed_retryable → (retry_scheduled | expired | failed_permanent).
            if ((int) $message->attempt_count < (int) $message->max_attempts && $now < $message->expires_at) {
                $this->mustTransition($tenantId, $message->id, DeliveryStatus::FailedRetryable, DeliveryStatus::RetryScheduled, [
                    'next_attempt_at' => $now->addSeconds($this->policy->backoffAfterAttempt((int) $message->attempt_count)),
                ]);

                return DeliveryStatus::RetryScheduled->value;
            }

            $terminal = $now >= $message->expires_at ? DeliveryStatus::Expired : DeliveryStatus::FailedPermanent;
            $this->mustTransition($tenantId, $message->id, DeliveryStatus::FailedRetryable, $terminal, ['payload_encrypted' => null] + $settled);

            return $terminal->value;
        });
    }

    private function finishAttempt(string $tenantId, CommunicationMessage $message, DispatchResult $result, CarbonImmutable $now): void
    {
        $updated = CommunicationMessageAttempt::query()
            ->where('tenant_id', $tenantId)
            ->where('message_id', $message->id)
            ->where('attempt_no', (int) $message->attempt_count)
            ->where('outcome', CommunicationMessageAttempt::OUTCOME_STARTED)
            ->update([
                'outcome' => $result->outcome->value,
                'error_code' => $result->errorCode,
                'provider_message_id' => $this->safeProviderMessageId($result->providerMessageId),
                'finished_at' => $now,
            ]);

        if ($updated !== 1) {
            // لا نكتب نتيجة بلا سجل محاولتها: التراجع يترك الرسالة `sending` فيسترجعها مسار الاسترجاع.
            throw new LogicException('The started attempt for this message could not be finalized.');
        }
    }

    /** معرّف المزوّد يُخزَّن فقط إن كان ASCII مطبوعاً ضمن طول العمود؛ وإلا يُهمل بدل كتابة قيمة مبتورة قد تطابق رسالة أخرى. */
    private function safeProviderMessageId(?string $id): ?string
    {
        return ($id !== null && preg_match('/^[\x21-\x7e]{1,191}\z/', $id) === 1) ? $id : null;
    }

    // ───────────────────────── الاسترجاع ─────────────────────────

    /** @return string وسم النتيجة للعدّادات */
    private function recoverOne(string $tenantId, CommunicationMessage $row): string
    {
        return DB::transaction(function () use ($tenantId, $row): string {
            $now = CarbonImmutable::now();

            $attempt = CommunicationMessageAttempt::query()
                ->where('tenant_id', $tenantId)
                ->where('message_id', $row->id)
                ->where('outcome', CommunicationMessageAttempt::OUTCOME_STARTED)
                ->first(['id', 'provider_key']);
            $provider = $attempt !== null ? $this->registry->byKey($attempt->provider_key) : null;

            $canRetry = $provider !== null
                && $provider->capabilities()->providerIdempotency
                && $row->classification !== MessageClassification::Otp->value
                && (int) $row->attempt_count < (int) $row->max_attempts
                && $now < $row->expires_at;

            // فاصل الإيجار: فقط إن بقي الإيجار نفسه منقضياً (لم ينهِه صاحبه ولم يسترجعه عامل آخر).
            $first = $canRetry ? DeliveryStatus::FailedRetryable : DeliveryStatus::Unknown;
            $values = $canRetry
                ? ['next_attempt_at' => null, 'last_error_code' => 'lease_expired']
                : ['payload_encrypted' => null, 'next_attempt_at' => null, 'receipt_deadline_at' => $now->addSeconds($this->policy->receiptWindowSeconds), 'last_error_code' => 'lease_expired'];

            $moved = CommunicationMessage::query()
                ->where('id', $row->id)
                ->where('tenant_id', $tenantId)
                ->where('status', DeliveryStatus::Sending->value)
                ->where('lease_token', $row->lease_token)
                ->where('lease_until', '<', $now)
                ->update(['status' => $first->value] + $values + self::LEAVE_SENDING);

            if ($moved !== 1) {
                return 'recovery_skipped';
            }

            CommunicationMessageAttempt::query()
                ->where('tenant_id', $tenantId)
                ->where('message_id', $row->id)
                ->where('outcome', CommunicationMessageAttempt::OUTCOME_STARTED)
                ->update([
                    'outcome' => CommunicationMessageAttempt::OUTCOME_ABANDONED,
                    'error_code' => 'lease_expired',
                    'finished_at' => $now,
                ]);

            if (! $canRetry) {
                return 'recovered_unknown';
            }

            $this->mustTransition($tenantId, $row->id, DeliveryStatus::FailedRetryable, DeliveryStatus::RetryScheduled, [
                'next_attempt_at' => $now->addSeconds($this->policy->backoffAfterAttempt((int) $row->attempt_count)),
            ]);

            return 'recovered_retry_scheduled';
        });
    }

    // ───────────────────────── أدوات ─────────────────────────

    /**
     * انتقال محروس بالحالة المصدر (وبالإيجار إن أُعطي). يرفض في الشيفرة أي انتقال خارج جدول `DeliveryStatus`.
     * التحديث عبر الباني (لا أحداث النموذج): القاعدة (CHECK/Triggers) هي الحارس الملزم.
     *
     * @param  array<string, mixed>  $values
     */
    private function transition(string $tenantId, string $messageId, DeliveryStatus $from, DeliveryStatus $to, array $values, ?string $leaseToken = null): int
    {
        if (! $from->canTransitionTo($to)) {
            throw new LogicException("Illegal delivery transition {$from->value} → {$to->value}.");
        }

        $query = CommunicationMessage::query()
            ->where('id', $messageId)
            ->where('tenant_id', $tenantId)
            ->where('status', $from->value);
        if ($leaseToken !== null) {
            $query->where('lease_token', $leaseToken);
        }

        return $query->update(['status' => $to->value] + $values);
    }

    /** @param  array<string, mixed>  $values */
    private function mustTransition(string $tenantId, string $messageId, DeliveryStatus $from, DeliveryStatus $to, array $values): void
    {
        if ($this->transition($tenantId, $messageId, $from, $to, $values) !== 1) {
            throw new LogicException("Expected delivery transition {$from->value} → {$to->value} did not apply.");
        }
    }

    private function assertTrustedTenant(string $tenantId): void
    {
        if (DB::transactionLevel() !== $this->baseTransactionLevel) {
            throw new LogicException('The dispatcher must not run inside an open business transaction.');
        }

        if (! $this->tenantContext->has() || $this->tenantContext->id() !== $tenantId) {
            throw new TenantMismatchException('The dispatcher tenant does not match the trusted tenant context.');
        }
    }
}
