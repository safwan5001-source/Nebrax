<?php

namespace App\Models;

use App\Support\GeneratesDocumentNumbers;
use App\Tenancy\BelongsToBranch;
use App\Tenancy\ResolvesBranchReferences;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * فاتورة مشتريات من مورد. تُنشأ draft ثم تُرحَّل عبر PurchaseService::post
 * الذي يولّد قيداً متوازناً عبر LedgerService ويُدخِل البضاعة للمخزون.
 * كل المبالغ بالـ minor units (هللات) كـ bigint.
 */
class Purchase extends BaseModel
{
    use ResolvesBranchReferences;
    use BelongsToBranch;
    use GeneratesDocumentNumbers;

    protected $fillable = [
        'branch_id',
        'tenant_id', 'number', 'partner_id', 'cost_center_id', 'payment_type',
        'purchase_date', 'due_date', 'supplier_invoice_no', 'status',
        'subtotal', 'tax_amount', 'total', 'tax_inclusive',
        'discount', 'shipping', 'adjustment',
        'paid_amount', 'payment_status', 'paid_on_post', 'payment_method',
        'received_status', 'received_date',
        'notes', 'journal_entry_id', 'print_template_revision_id', 'pdf_template_revision_id', 'created_by',
    ];

    protected $casts = [
        'purchase_date' => 'date',
        'due_date'      => 'date',
        'received_date' => 'date',
        'subtotal'      => 'integer',
        'tax_amount'    => 'integer',
        'total'         => 'integer',
        'tax_inclusive' => 'boolean',
        'paid_amount'   => 'integer',
        'paid_on_post'  => 'integer',
    ];

    protected $attributes = [
        'payment_type'   => 'credit',
        'status'         => 'draft',
        'subtotal'       => 0,
        'tax_amount'     => 0,
        'total'          => 0,
        'paid_amount'     => 0,
        'payment_status'  => 'unpaid',
        'paid_on_post'    => 0,
        'payment_method'  => 'cash',
        'received_status' => 'received',
    ];

    public function lines(): HasMany
    {
        return $this->hasMany(PurchaseLine::class);
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

    /** المرجع التاريخي للقالب الذي كان منشوراً عند ترحيل الفاتورة. */
    public function printTemplateRevision(): BelongsTo
    {
        return $this->belongsTo(PrintTemplateRevision::class, 'print_template_revision_id');
    }

    /** المرجع التاريخي للمراجعة المختارة لإخراج PDF. */
    public function pdfTemplateRevision(): BelongsTo
    {
        return $this->belongsTo(PrintTemplateRevision::class, 'pdf_template_revision_id');
    }

    public function isDraft(): bool
    {
        return $this->status === 'draft';
    }

    public function isPosted(): bool
    {
        return $this->status === 'posted';
    }

    /** المتبقي على الفاتورة للمورد (الإجمالي − المسدَّد). */
    public function remaining(): int
    {
        return max(0, $this->total - $this->paid_amount);
    }

    public function isFullyPaid(): bool
    {
        return $this->payment_status === 'paid';
    }

    public function isPartiallyPaid(): bool
    {
        return $this->payment_status === 'partial';
    }
}
