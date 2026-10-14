<?php

namespace App\Models;

use App\Support\Communications\CommunicationChannel;
use App\Support\Communications\DeliveryStatus;
use App\Support\Communications\MessageClassification;
use App\Tenancy\CompanyWide;
use Illuminate\Database\Eloquent\Relations\HasMany;
use LogicException;

/**
 * رسالة اتصال واحدة = سجل Outbox واحد (AWJ-COMMS-FOUNDATION-02-A — Schema فقط).
 *
 * `CompanyWide` (إقرار واعٍ): سجل اتصالات على مستوى المؤسسة، بلا وسم فرع بعد (يُضاف nullable عند
 * وجود مستهلك). يرث `BaseModel`: UUID + عزل مستأجر تلقائي.
 *
 * حدود المسؤولية (انظر تقرير الاعتماد النهائي):
 *  - **القاعدة** هي المرجع الملزم: الفرادات، FK المركّبة، Triggers تثبيت الهوية، وCHECK الخصوصية
 *    (PostgreSQL: كل القواعد؛ SQLite: Triggers الخصوصية والهوية فقط).
 *  - **النموذج** يحرس الشكل على كل المحرّكين (`assertShape`) لأن SQLite لا يضيف CHECK بعد الإنشاء —
 *    فجوة موثَّقة. الحارس لا يغني عن القاعدة: التحديثات الجماعية/الخام لا تمرّ به.
 *
 * لا منطق أعمال هنا (لا Enqueue ولا مطالبة ولا إرسال). الحمولة `payload_encrypted` مشفَّرة، مخفيّة في
 * التسلسل، ولا توجد لرسائل OTP أبداً. أي انتقال يُخرج الرسالة من الحالات القابلة للإرسال يجب أن يمسح
 * الحمولة **في الجملة نفسها** وإلا يُجهضه الحارس/CHECK.
 */
class CommunicationMessage extends BaseModel implements CompanyWide
{
    /** أعمدة الهوية: ثابتة بعد الإنشاء (Trigger في القاعدة + حارس هنا). */
    public const IDENTITY_COLUMNS = [
        'id', 'tenant_id', 'channel', 'classification', 'template_key', 'source',
        'idempotency_hash', 'recipient_masked', 'max_attempts', 'expires_at', 'created_at',
    ];

    public const SETTLED_FINAL_STATUS = 'final_status';

    public const SETTLED_RECEIPT_WINDOW_ELAPSED = 'receipt_window_elapsed';

    public const SETTLED_REASONS = [self::SETTLED_FINAL_STATUS, self::SETTLED_RECEIPT_WINDOW_ELAPSED];

    /** الحالات التي قد تحمل حمولة (يمكن أن يجري فيها إرسال). */
    public const PAYLOAD_STATUSES = ['queued', 'retry_scheduled', 'sending', 'failed_retryable'];

    protected $table = 'communication_messages';

    protected $fillable = [
        'tenant_id', 'channel', 'classification', 'template_key', 'source', 'idempotency_hash',
        'recipient_masked', 'payload_encrypted', 'status', 'attempt_count', 'max_attempts',
        'next_attempt_at', 'expires_at', 'lease_token', 'lease_until', 'last_error_code',
        'accepted_at', 'receipt_deadline_at', 'settled_at', 'settled_reason',
    ];

    /** @var array<string, mixed> */
    protected $attributes = [
        'status' => 'queued',
        'attempt_count' => 0,
    ];

    protected $hidden = ['payload_encrypted'];

    protected function casts(): array
    {
        return [
            'payload_encrypted' => 'encrypted:array',
            'attempt_count' => 'integer',
            'max_attempts' => 'integer',
            'next_attempt_at' => 'datetime',
            'expires_at' => 'datetime',
            'lease_until' => 'datetime',
            'accepted_at' => 'datetime',
            'receipt_deadline_at' => 'datetime',
            'settled_at' => 'datetime',
        ];
    }

    protected static function booted(): void
    {
        static::saving(function (self $message): void {
            if ($message->exists) {
                $changed = array_intersect(array_keys($message->getDirty()), self::IDENTITY_COLUMNS);
                if ($changed !== []) {
                    throw new LogicException('Communication message identity columns are immutable.');
                }
            }

            $message->assertShape();
        });
    }

    public function attempts(): HasMany
    {
        return $this->hasMany(CommunicationMessageAttempt::class, 'message_id');
    }

    /**
     * يعكس قواعد CHECK الشكلية في القاعدة (PostgreSQL) لحماية SQLite وللحصول على رسالة خطأ مبكرة.
     * رسائل الاستثناء ثابتة بلا قيم (لا تسريب عنوان/حمولة).
     */
    private function assertShape(): void
    {
        $status = DeliveryStatus::tryFrom((string) $this->status)
            ?? throw new LogicException('Communication message status is not a known delivery status.');
        CommunicationChannel::tryFrom((string) $this->channel)
            ?? throw new LogicException('Communication message channel is not supported.');
        $classification = MessageClassification::tryFrom((string) $this->classification)
            ?? throw new LogicException('Communication message classification is not supported.');

        $this->ensure($this->settled_reason === null || in_array($this->settled_reason, self::SETTLED_REASONS, true), 'settled_reason');

        $hasPayload = $this->getRawOriginalOrAttribute('payload_encrypted') !== null;
        $isOtp = $classification === MessageClassification::Otp;

        // الخصوصية: OTP بلا حمولة، محاولة واحدة، ولا retry_scheduled.
        $this->ensure(! $isOtp || (! $hasPayload && (int) $this->max_attempts === 1 && $status !== DeliveryStatus::RetryScheduled), 'otp privacy');
        // الحمولة فقط في الحالات القابلة للإرسال، وغير OTP القابلة للمطالبة تحملها.
        $this->ensure(! $hasPayload || in_array($status->value, self::PAYLOAD_STATUSES, true), 'payload lifecycle');
        $this->ensure($isOtp || ! in_array($status, [DeliveryStatus::Queued, DeliveryStatus::RetryScheduled], true) || $hasPayload, 'deferred payload');

        $this->ensure((int) $this->max_attempts >= 1 && (int) $this->attempt_count >= 0 && (int) $this->attempt_count <= (int) $this->max_attempts, 'attempt counters');

        $sending = $status === DeliveryStatus::Sending;
        $leased = $this->lease_token !== null && $this->lease_until !== null;
        $unleased = $this->lease_token === null && $this->lease_until === null;
        $this->ensure($sending ? $leased : $unleased, 'lease');

        $this->ensure(! in_array($status, [DeliveryStatus::Queued, DeliveryStatus::RetryScheduled], true) || $this->next_attempt_at !== null, 'due');
        $this->ensure(
            (! in_array($status, [DeliveryStatus::Accepted, DeliveryStatus::Unknown, DeliveryStatus::Delivered], true) || $this->receipt_deadline_at !== null)
            && ($status !== DeliveryStatus::Accepted || $this->accepted_at !== null),
            'receipt'
        );
        $this->ensure(
            (! $status->isTerminal() || $this->settled_at !== null)
            && (($this->settled_at === null) === ($this->settled_reason === null)),
            'settlement'
        );
    }

    private function getRawOriginalOrAttribute(string $key): mixed
    {
        // القيمة الخام (المشفَّرة) دون فكّها: وجودها هو المهم لا محتواها.
        return $this->attributes[$key] ?? null;
    }

    private function ensure(bool $condition, string $rule): void
    {
        if (! $condition) {
            throw new LogicException("Communication message violates schema invariant: {$rule}.");
        }
    }
}
