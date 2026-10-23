<?php

namespace App\Models;

use App\Tenancy\BranchScoped;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use LogicException;

/**
 * طلب دفع على جهاز POS (PAY-H6-02): created → sent → approved → consumed (بيع) | voided (إلغاء على الجهاز) | compensation_required → voided|compensated.
 *
 * الحالة آلة رتيبة تُفرض هنا: هوية الطلب (المستأجر/الجلسة/الجهاز/الطريقة/المبلغ/المفتاح) ثابتة، والانتقال الوحيد المسموح من الحالات
 * النهائية هو لا شيء. الكتابة الخام SQL تتجاوز هذا الحارس (حارس القاعدة: مبلغ>0، حالة معروفة، طلب نشط واحد لكل جهاز، استهلاك واحد للسند).
 */
class PosTerminalRequest extends BaseModel
{
    use BranchScoped;

    public const STATUS_CREATED = 'created';

    public const STATUS_SENT = 'sent';

    public const STATUS_APPROVED = 'approved';

    public const STATUS_DECLINED = 'declined';

    public const STATUS_CANCELLED = 'cancelled';

    public const STATUS_EXPIRED = 'expired';

    public const STATUS_ERROR = 'error';

    public const STATUS_CONSUMED = 'consumed';

    public const STATUS_VOIDED = 'voided';

    public const STATUS_COMPENSATION_REQUIRED = 'compensation_required';

    public const STATUS_COMPENSATED = 'compensated';

    /** حالات "قيد التنفيذ" على الجهاز: طلب نشط واحد لكل جهاز، وتمنع إقفال الجلسة. */
    public const IN_FLIGHT = [self::STATUS_CREATED, self::STATUS_SENT, self::STATUS_APPROVED];

    private const TRANSITIONS = [
        self::STATUS_CREATED => [self::STATUS_SENT, self::STATUS_ERROR, self::STATUS_CANCELLED, self::STATUS_EXPIRED, self::STATUS_DECLINED, self::STATUS_APPROVED],
        self::STATUS_SENT => [self::STATUS_APPROVED, self::STATUS_DECLINED, self::STATUS_CANCELLED, self::STATUS_EXPIRED, self::STATUS_ERROR],
        self::STATUS_APPROVED => [self::STATUS_CONSUMED, self::STATUS_VOIDED, self::STATUS_COMPENSATION_REQUIRED],
        self::STATUS_COMPENSATION_REQUIRED => [self::STATUS_VOIDED, self::STATUS_COMPENSATED],
    ];

    private const IMMUTABLE = ['tenant_id', 'branch_id', 'pos_session_id', 'pos_payment_terminal_id', 'payment_method_id', 'idempotency_key', 'amount', 'currency', 'created_by'];

    protected $fillable = [
        'tenant_id', 'branch_id', 'pos_session_id', 'pos_payment_terminal_id', 'payment_method_id', 'idempotency_key', 'amount', 'currency',
        'status', 'provider_ref', 'approval_code', 'rrn', 'last4', 'failure_code', 'void_attempts', 'last_void_error', 'compensating_until', 'lease_token', 'lease_op',
        'consumed_payment_id', 'consumed_invoice_id', 'created_by', 'resolved_by', 'resolution_note',
        'approved_at', 'consumed_at', 'voided_at', 'resolved_at',
    ];

    protected $casts = [
        'amount' => 'integer',
        'void_attempts' => 'integer',
        'compensating_until' => 'datetime',
        'approved_at' => 'datetime',
        'consumed_at' => 'datetime',
        'voided_at' => 'datetime',
        'resolved_at' => 'datetime',
    ];

    protected $attributes = [
        'status' => self::STATUS_CREATED,
        'currency' => 'SAR',
        'void_attempts' => 0,
    ];

    protected static function booted(): void
    {
        static::updating(function (self $request) {
            foreach (self::IMMUTABLE as $field) {
                if ($request->isDirty($field)) {
                    throw new LogicException("حقل {$field} في طلب جهاز الدفع لا يتغير.");
                }
            }
            if ($request->isDirty('status')) {
                $from = (string) $request->getOriginal('status');
                $to = (string) $request->status;
                if (! in_array($to, self::TRANSITIONS[$from] ?? [], true)) {
                    throw new LogicException("انتقال حالة غير مسموح لطلب جهاز الدفع: {$from} → {$to}.");
                }
            }
        });
        static::deleting(fn () => throw new LogicException('طلب جهاز الدفع دليل مالي ولا يُحذف.'));
    }

    public function terminal(): BelongsTo
    {
        return $this->belongsTo(PosPaymentTerminal::class, 'pos_payment_terminal_id');
    }

    public function session(): BelongsTo
    {
        return $this->belongsTo(PosSession::class, 'pos_session_id');
    }

    public function paymentMethod(): BelongsTo
    {
        return $this->belongsTo(PaymentMethod::class);
    }

    /**
     * عملية مزوّد/تعويض لم تُنهِ نفسها: الإيجار حيّ **أو** رمزه باقٍ بعد انتهاء مدته (نداء قد لا يزال جارياً عند المزوّد).
     * الموافقة المرتبطة به غير متاحة للاستهلاك ولا للحلّ اليدوي حتى تنتهي العملية أو يُعيد المجدول المحاولة.
     */
    public function hasOutstandingLease(): bool
    {
        return $this->lease_token !== null || ($this->compensating_until !== null && $this->compensating_until->isFuture());
    }

    public function isApprovalAvailable(): bool
    {
        return $this->status === self::STATUS_APPROVED && ! $this->hasOutstandingLease();
    }
}
