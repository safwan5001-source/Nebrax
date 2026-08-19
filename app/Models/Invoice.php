<?php

namespace App\Models;

use App\Support\GeneratesDocumentNumbers;
use App\Support\RecordsRevisions;
use App\Tenancy\BelongsToBranch;
use App\Tenancy\ResolvesBranchReferences;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * فاتورة مبيعات. تُنشأ بحالة draft ثم تُرحَّل عبر InvoiceService::post
 * الذي يولّد قيداً متوازناً تلقائياً عبر LedgerService.
 * كل المبالغ بالـ minor units (هللات) كـ bigint.
 */
class Invoice extends BaseModel
{
    use ResolvesBranchReferences;
    use RecordsRevisions;
    use BelongsToBranch;
    use GeneratesDocumentNumbers;

    protected $fillable = [
        'branch_id',
        'tenant_id', 'number', 'partner_id', 'type', 'payment_type',
        'invoice_date', 'due_date', 'cost_center_id', 'salesperson_id', 'status',
        'subtotal', 'discount', 'shipping', 'adjustment', 'tax_amount', 'total',
        'tax_inclusive', 'paid_amount', 'payment_status',
        'is_paid', 'payment_method', 'payment_reference', 'cash_account_id',
        'notes', 'journal_entry_id', 'cogs_entry_id', 'created_by',
        'zatca_qr', 'zatca_hash',
        'zatca_uuid', 'zatca_icv', 'zatca_previous_hash', 'zatca_xml', 'print_template_revision_id', 'pdf_template_revision_id', 'thermal_template_revision_id',
    ];

    protected $casts = [
        'invoice_date' => 'date',
        'due_date'     => 'date',
        'subtotal'     => 'integer',
        'discount'     => 'integer',
        'shipping'     => 'integer',
        'adjustment'   => 'integer',
        'tax_amount'   => 'integer',
        'total'        => 'integer',
        'tax_inclusive' => 'boolean',
        'paid_amount'  => 'integer',
        'is_paid'      => 'boolean',
    ];

    protected $attributes = [
        'type'           => 'sale',
        'payment_type'   => 'cash',
        'status'         => 'draft',
        'subtotal'       => 0,
        'discount'       => 0,
        'shipping'       => 0,
        'adjustment'     => 0,
        'tax_amount'     => 0,
        'total'          => 0,
        'tax_inclusive'  => false,
        'paid_amount'    => 0,
        'payment_status' => 'unpaid',
        'is_paid'        => false,
        'payment_method' => 'cash',
    ];

    public function lines(): HasMany
    {
        return $this->hasMany(InvoiceLine::class);
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

    public function cogsEntry(): BelongsTo
    {
        return $this->belongsTo(JournalEntry::class, 'cogs_entry_id');
    }

    /** مراجعة القالب المثبتة عند الترحيل؛ لا يعيد تغيير القالب تفسير الفاتورة. */
    public function printTemplateRevision(): BelongsTo
    {
        return $this->belongsTo(PrintTemplateRevision::class, 'print_template_revision_id');
    }

    /** مراجعة PDF المثبتة عند الترحيل؛ قد تختلف عن مراجعة الطباعة المعيّنة. */
    public function pdfTemplateRevision(): BelongsTo
    {
        return $this->belongsTo(PrintTemplateRevision::class, 'pdf_template_revision_id');
    }

    /** مراجعة الطباعة الحرارية المثبتة؛ لا تحل تعييناً حياً وقت إعادة الطباعة. */
    public function thermalTemplateRevision(): BelongsTo
    {
        return $this->belongsTo(PrintTemplateRevision::class, 'thermal_template_revision_id');
    }

    public function isDraft(): bool
    {
        return $this->status === 'draft';
    }

    public function isPosted(): bool
    {
        return $this->status === 'posted';
    }

    /** المتبقي على الفاتورة (الإجمالي − المسدَّد). */
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
