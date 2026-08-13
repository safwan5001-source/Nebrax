<?php

namespace App\Models;

use App\Tenancy\BelongsToBranch;
use App\Tenancy\ResolvesBranchReferences;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * سند قبض/صرف. تُنشأ بحالة draft ثم تُرحَّل عبر PaymentService::post
 * الذي يولّد قيداً متوازناً عبر LedgerService.
 *  - direction=received: قبض من عميل  (دائن 1130 العملاء)
 *  - direction=paid:     صرف لمورد    (مدين 2110 الموردون)
 * كل المبالغ بالـ minor units (هللات) كـ bigint.
 */
class Payment extends BaseModel
{
    use ResolvesBranchReferences;
    use BelongsToBranch;

    protected $fillable = [
        'branch_id',
        'tenant_id', 'number', 'partner_id', 'invoice_id',
        'direction', 'method', 'reference', 'cash_account_id', 'payment_date', 'amount',
        'status', 'notes', 'journal_entry_id', 'created_by',
    ];

    protected $casts = [
        'payment_date' => 'date',
        'amount'       => 'integer',
    ];

    protected $attributes = [
        'direction' => 'received',
        'method'    => 'cash',
        'status'    => 'draft',
        'amount'    => 0,
    ];

    /** مرجع مخزَّن — لا يُصفّى بالفرع أبداً (المستند حجّة قائمة، لا نتيجة تصفّح). */
    public function partner(): BelongsTo
    {
        return $this->referenceBelongsTo(Partner::class);
    }

    public function invoice(): BelongsTo
    {
        return $this->belongsTo(Invoice::class);
    }

    /** الخزينة/الحساب البنكي المستلِم — مرجع اختياري، غيابه يعني الافتراضي بحسب الطريقة. */
    public function cashAccount(): BelongsTo
    {
        return $this->belongsTo(Account::class, 'cash_account_id');
    }

    public function journalEntry(): BelongsTo
    {
        return $this->belongsTo(JournalEntry::class, 'journal_entry_id');
    }

    public function allocations(): HasMany
    {
        return $this->hasMany(PaymentAllocation::class);
    }

    public function isDraft(): bool
    {
        return $this->status === 'draft';
    }

    public function isPosted(): bool
    {
        return $this->status === 'posted';
    }
}
