<?php

namespace App\Models;

use App\Support\GeneratesDocumentNumbers;
use App\Tenancy\BelongsToBranch;
use App\Tenancy\ResolvesBranchReferences;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * جلسة نقطة بيع — سجل تشغيلي لمطابقة النقدية. غير محاسبي.
 * المبالغ بالهللات كـ bigint.
 */
class PosSession extends BaseModel
{
    use BelongsToBranch;
    use GeneratesDocumentNumbers;
    use ResolvesBranchReferences;

    protected $fillable = [
        'branch_id',
        'tenant_id', 'number', 'status', 'handover_status', 'single_cashier_guard', 'opening_balance', 'closing_balance',
        'counted_balance_locked_at', 'closing_count_revealed_at', 'recounted_by', 'recounted_at',
        'expected_balance', 'difference', 'opened_at', 'closed_at', 'notes', 'handover_note',
        'handover_submitted_at', 'opened_by', 'closed_by', 'handover_confirmed_by',
        'handover_confirmed_at', 'handover_confirmation_note',
        'pos_device_id', 'warehouse_id', 'pos_shift_id', 'shift_id', 'cash_account_id',
        'difference_status', 'difference_acknowledged_by', 'difference_acknowledged_at', 'difference_acknowledgement_note',
        'variance_journal_entry_id',
    ];

    protected $casts = [
        'opening_balance'  => 'integer',
        'closing_balance'  => 'integer',
        'expected_balance' => 'integer',
        'difference'       => 'integer',
        'opened_at'        => 'datetime',
        'closed_at'        => 'datetime',
        'handover_submitted_at' => 'datetime',
        'handover_confirmed_at' => 'datetime',
        'single_cashier_guard' => 'boolean',
        'difference_acknowledged_at' => 'datetime',
        'counted_balance_locked_at' => 'datetime',
        'closing_count_revealed_at' => 'datetime',
        'recounted_at' => 'datetime',
    ];

    protected $attributes = [
        'status'          => 'open',
        'opening_balance' => 0,
    ];

    /** جهاز البيع المثبت عند فتح الجلسة؛ يحل تاريخياً خارج عزل الفرع. */
    public function posDevice(): BelongsTo
    {
        return $this->referenceBelongsTo(PosDevice::class);
    }

    /** مخزن خروج البضائع المثبت للجلسة؛ لا يعاد حله من إعداد الجهاز الحي. */
    public function warehouse(): BelongsTo
    {
        return $this->belongsTo(Warehouse::class);
    }

    /** وردية تشغيل POS المثبتة عند الفتح؛ مستقلة عن جداول دوام HR. */
    public function posShift(): BelongsTo
    {
        return $this->referenceBelongsTo(PosShift::class);
    }

    /**
     * مرجع HR التاريخي القديم. يبقى للتوافق مع الجلسات السابقة فقط ولا يستخدم
     * لفتح جلسات POS الجديدة بعد إدخال PosShift.
     */
    public function shift(): BelongsTo
    {
        return $this->referenceBelongsTo(Shift::class);
    }

    public function openedBy(): BelongsTo
    {
        return $this->belongsTo(User::class, 'opened_by');
    }

    public function closedBy(): BelongsTo
    {
        return $this->belongsTo(User::class, 'closed_by');
    }

    public function cashMovements(): HasMany
    {
        return $this->hasMany(PosCashMovement::class);
    }

    public function events(): HasMany
    {
        return $this->hasMany(PosSessionEvent::class);
    }

    public function reconciliations(): HasMany
    {
        return $this->hasMany(PosSessionReconciliation::class)->orderBy('reconciliation_key');
    }

    public function handoverConfirmedBy(): BelongsTo
    {
        return $this->belongsTo(User::class, 'handover_confirmed_by');
    }

    /** مرتجعات POS المرتبطة بالجلسة؛ لا تشمل المرتجعات العامة أو التاريخية. */
    public function returns(): HasMany
    {
        return $this->hasMany(ReturnDocument::class);
    }

    /** عمليات الاستبدال الذرية التي نفذت في هذه الجلسة. */
    public function exchanges(): HasMany
    {
        return $this->hasMany(PosExchange::class);
    }

    public function differenceAcknowledgedBy(): BelongsTo
    {
        return $this->belongsTo(User::class, 'difference_acknowledged_by');
    }

    /** مستخدم إعادة العد؛ يظل مستقلاً عن معتمد الاستثناء. */
    public function recountedBy(): BelongsTo
    {
        return $this->belongsTo(User::class, 'recounted_by');
    }

    /** قيد تسوية فرق الصندوق المثبت؛ وجوده يعني أن الفرق سوي محاسبياً مرة واحدة. */
    public function varianceJournalEntry(): BelongsTo
    {
        return $this->belongsTo(JournalEntry::class, 'variance_journal_entry_id');
    }

    /** حساب خزينة الجلسة المثبت وقت الفتح؛ عليه ترحل تسوية الفرق لا على الرئيسية. */
    public function cashAccount(): BelongsTo
    {
        return $this->belongsTo(Account::class, 'cash_account_id');
    }

    public function isOpen(): bool
    {
        return $this->status === 'open';
    }
}
