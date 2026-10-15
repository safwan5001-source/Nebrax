<?php

namespace App\Models;

use App\Tenancy\CompanyWide;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use LogicException;

/**
 * محاولة إرسال واحدة لرسالة اتصال (AWJ-COMMS-FOUNDATION-02-A — Schema فقط).
 *
 * تُلتزَم `started` **قبل** أي استدعاء للمزوّد (سجل النيّة)، ثم تنتقل مرة واحدة إلى نتيجة نهائية
 * (`DispatchOutcome` + `abandoned`) وتتجمّد بعدها. `CompanyWide` ويرث `BaseModel`.
 *
 * القاعدة هي المرجع الملزم: FK المركّبة `(tenant_id, message_id)` تمنع الربط بين مستأجرين، والفريد
 * الجزئي يمنع أكثر من محاولة `started` لرسالة، وTrigger يجمّد الهوية والمحاولة بعد نتيجتها. الحارس هنا
 * يعطي خطأً مبكراً واضحاً على كل المحرّكين، ولا يغطي التحديثات الخام.
 *
 * لا يخزّن أي نص خطأ حرّ من المزوّد: `error_code` رمز مصنَّف فقط.
 */
class CommunicationMessageAttempt extends BaseModel implements CompanyWide
{
    public const OUTCOME_STARTED = 'started';

    public const OUTCOME_ABANDONED = 'abandoned';

    /** مطابقة لـ`DispatchOutcome` + started + abandoned. */
    public const OUTCOMES = [
        self::OUTCOME_STARTED, 'accepted', 'retryable_failure', 'permanent_failure',
        'unsupported', 'unknown', self::OUTCOME_ABANDONED,
    ];

    /** أعمدة الهوية: ثابتة دائماً. */
    public const IDENTITY_COLUMNS = ['id', 'tenant_id', 'message_id', 'attempt_no', 'provider_key', 'started_at'];

    public $timestamps = false;

    protected $table = 'communication_message_attempts';

    protected $fillable = [
        'tenant_id', 'message_id', 'attempt_no', 'provider_key', 'outcome',
        'error_code', 'provider_message_id', 'started_at', 'finished_at',
    ];

    /** @var array<string, mixed> */
    protected $attributes = [
        'outcome' => self::OUTCOME_STARTED,
    ];

    protected function casts(): array
    {
        return [
            'attempt_no' => 'integer',
            'started_at' => 'datetime',
            'finished_at' => 'datetime',
        ];
    }

    protected static function booted(): void
    {
        static::saving(function (self $attempt): void {
            if ($attempt->exists) {
                if ($attempt->getOriginal('outcome') !== self::OUTCOME_STARTED) {
                    throw new LogicException('Finalized communication message attempts are immutable.');
                }
                if (array_intersect(array_keys($attempt->getDirty()), self::IDENTITY_COLUMNS) !== []) {
                    throw new LogicException('Communication message attempt identity columns are immutable.');
                }
            }

            if (! in_array($attempt->outcome, self::OUTCOMES, true)
                || (int) $attempt->attempt_no < 1
                || (($attempt->outcome === self::OUTCOME_STARTED) !== ($attempt->finished_at === null))) {
                throw new LogicException('Communication message attempt violates schema invariant.');
            }
        });
    }

    public function message(): BelongsTo
    {
        return $this->belongsTo(CommunicationMessage::class, 'message_id');
    }
}
