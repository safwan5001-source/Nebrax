<?php

namespace App\Models;

use App\Support\GeneratesDocumentNumbers;
use App\Tenancy\BelongsToBranch;
use App\Tenancy\ResolvesBranchReferences;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * استرداد من مورّد: عودة النقد فعلاً مقابل مرتجعات مشتريات مرحّلة.
 *
 * `مرتجع المشتريات ≠ استرداد المورّد`: المرتجع يعكس الالتزام تجارياً (دائن
 * المخزون/المصروف/الضريبة مقابل مدين الموردين)، وهذا المستند وحده يُدخل
 * النقد — مدين الخزينة/البنك المختار (CashBankAccount) ودائن الموردين
 * (`accounts_payable` عبر AccountRoleResolver).
 *
 * دورة الحياة: draft → posted → reversed. المرحّل لا يُعدَّل ولا يُحذف؛
 * التصحيح بعكسٍ عبر `LedgerService::reverse()`.
 */
class SupplierRefund extends BaseModel
{
    use ResolvesBranchReferences;
    use BelongsToBranch;
    use GeneratesDocumentNumbers;

    protected $fillable = [
        'branch_id', 'tenant_id', 'number', 'partner_id', 'refund_date', 'amount',
        'method', 'payment_method_id', 'payment_method_name', 'cash_account_id',
        'reference', 'notes', 'status', 'journal_entry_id', 'reversal_entry_id',
        'posted_at', 'reversed_at', 'created_by',
    ];

    protected $casts = [
        'refund_date' => 'date',
        'amount'      => 'integer',
        'posted_at'   => 'datetime',
        'reversed_at' => 'datetime',
    ];

    protected $attributes = [
        'method' => 'cash',
        'status' => 'draft',
        'amount' => 0,
    ];

    public function allocations(): HasMany
    {
        return $this->hasMany(SupplierRefundAllocation::class);
    }

    /** مرجع مخزَّن — لا يُصفّى بالفرع أبداً (المستند حجّة قائمة، لا نتيجة تصفّح). */
    public function partner(): BelongsTo
    {
        return $this->referenceBelongsTo(Partner::class);
    }

    public function journalEntry(): BelongsTo
    {
        return $this->belongsTo(JournalEntry::class, 'journal_entry_id');
    }

    public function reversalEntry(): BelongsTo
    {
        return $this->belongsTo(JournalEntry::class, 'reversal_entry_id');
    }

    public function isDraft(): bool
    {
        return $this->status === 'draft';
    }

    public function isPosted(): bool
    {
        return $this->status === 'posted';
    }

    public function isReversed(): bool
    {
        return $this->status === 'reversed';
    }
}
