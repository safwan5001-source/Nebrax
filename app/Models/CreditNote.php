<?php

namespace App\Models;

use App\Tenancy\BelongsToBranch;
use App\Tenancy\ResolvesBranchReferences;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * إشعار دائن (Credit Note) — مستند مالي للعميل (بلا حركة مخزون).
 * يُنشأ draft ثم يُرحَّل عبر CreditNoteService::post الذي يولّد قيداً
 * عكسياً متوازناً عبر LedgerService. كل المبالغ بالهللات كـ bigint.
 */
class CreditNote extends BaseModel
{
    use ResolvesBranchReferences;
    use BelongsToBranch;

    protected $fillable = [
        'branch_id',
        'tenant_id', 'number', 'type', 'partner_id', 'refund_type', 'note_date',
        'status', 'subtotal', 'tax_amount', 'total', 'reason',
        'original_invoice_id', 'original_purchase_id', 'journal_entry_id', 'created_by',
    ];

    protected $casts = [
        'note_date'  => 'date',
        'subtotal'   => 'integer',
        'tax_amount' => 'integer',
        'total'      => 'integer',
    ];

    protected $attributes = [
        'refund_type' => 'credit',
        'status'      => 'draft',
        'subtotal'    => 0,
        'tax_amount'  => 0,
        'total'       => 0,
    ];

    public function lines(): HasMany
    {
        return $this->hasMany(CreditNoteLine::class);
    }

    /** مرجع مخزَّن — لا يُصفّى بالفرع أبداً (المستند حجّة قائمة، لا نتيجة تصفّح). */
    public function partner(): BelongsTo
    {
        return $this->referenceBelongsTo(Partner::class);
    }

    public function isDraft(): bool
    {
        return $this->status === 'draft';
    }

    /** إشعار مدين (للمورّد) بخلاف الإشعار الدائن الافتراضي (للعميل). */
    public function isPurchase(): bool
    {
        return $this->type === 'purchase';
    }
}
