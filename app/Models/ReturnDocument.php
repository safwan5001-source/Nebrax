<?php

namespace App\Models;

use App\Support\GeneratesDocumentNumbers;
use App\Tenancy\BelongsToBranch;
use App\Tenancy\ResolvesBranchReferences;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Relations\MorphTo;

/**
 * مرتجع مبيعات (إشعار دائن) أو مشتريات (إشعار مدين).
 * يُنشأ draft ثم يُرحَّل عبر ReturnService::post الذي يولّد قيداً عكسياً
 * عبر LedgerService ويعالج المخزون. المبالغ بالـ minor units (هللات).
 */
class ReturnDocument extends BaseModel
{
    use ResolvesBranchReferences;
    use BelongsToBranch;
    use GeneratesDocumentNumbers;

    protected $table = 'return_documents';

    protected $fillable = [
        'branch_id', 'warehouse_id', 'pos_session_id',
        'tenant_id', 'number', 'type', 'partner_id', 'payment_type', 'tax_inclusive',
        'restock',
        'return_date', 'status', 'subtotal', 'tax_amount', 'total',
        'notes', 'original_type', 'original_id',
        'journal_entry_id', 'cogs_entry_id', 'created_by',
    ];

    protected $casts = [
        'return_date' => 'date',
        'restock'     => 'boolean',
        'tax_inclusive' => 'boolean',
        'subtotal'    => 'integer',
        'tax_amount'  => 'integer',
        'total'       => 'integer',
    ];

    protected $attributes = [
        'payment_type' => 'credit',
        'status'       => 'draft',
        'subtotal'     => 0,
        'tax_amount'   => 0,
        'total'        => 0,
    ];

    public function lines(): HasMany
    {
        return $this->hasMany(ReturnLine::class, 'return_id');
    }

    /** مرجع مخزَّن — لا يُصفّى بالفرع أبداً (المستند حجّة قائمة، لا نتيجة تصفّح). */
    public function partner(): BelongsTo
    {
        return $this->referenceBelongsTo(Partner::class);
    }

    /** مخزن فعلي مثبت للمرتجع؛ قد يطابق مخزن المصدر أو يختلف عند نقل البضاعة. */
    public function warehouse(): BelongsTo
    {
        return $this->belongsTo(Warehouse::class);
    }

    /** جلسة POS اختيارية؛ مرجع تشغيلي محفوظ لا يختفي بتبدل سياق الفرع. */
    public function posSession(): BelongsTo
    {
        return $this->referenceBelongsTo(PosSession::class);
    }

    public function original(): MorphTo
    {
        return $this->morphTo();
    }

    public function journalEntry(): BelongsTo
    {
        return $this->belongsTo(JournalEntry::class, 'journal_entry_id');
    }

    public function isDraft(): bool
    {
        return $this->status === 'draft';
    }

    public function isPosted(): bool
    {
        return $this->status === 'posted';
    }

    public function isSales(): bool
    {
        return $this->type === 'sales';
    }
}
