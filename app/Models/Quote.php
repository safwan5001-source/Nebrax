<?php

namespace App\Models;

use App\Support\GeneratesDocumentNumbers;
use App\Support\RecordsRevisions;
use App\Tenancy\BelongsToBranch;
use App\Tenancy\ResolvesBranchReferences;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * عرض سعر (Quote) — مستند تجاري غير محاسبي: لا يولّد قيوداً.
 * يُحوَّل إلى فاتورة مبيعات عبر QuoteService::convert عند القبول.
 * كل المبالغ بالـ minor units (هللات) كـ bigint.
 */
class Quote extends BaseModel
{
    use ResolvesBranchReferences;
    use RecordsRevisions;
    use BelongsToBranch;
    use GeneratesDocumentNumbers;

    protected $fillable = [
        'branch_id',
        'tenant_id', 'number', 'partner_id', 'quote_date', 'valid_until',
        'status', 'subtotal', 'tax_amount', 'total', 'tax_inclusive', 'notes',
        'converted_invoice_id', 'print_issued_at', 'print_template_revision_id',
        'pdf_template_revision_id', 'thermal_template_revision_id', 'revised_from_id', 'created_by',
    ];

    protected $casts = [
        'quote_date'    => 'date',
        'valid_until'   => 'date',
        'subtotal'      => 'integer',
        'tax_amount'    => 'integer',
        'total'         => 'integer',
        'tax_inclusive' => 'boolean',
        'print_issued_at' => 'datetime',
    ];

    protected $attributes = [
        'status'     => 'draft',
        'subtotal'   => 0,
        'tax_amount' => 0,
        'total'      => 0,
    ];

    public function lines(): HasMany
    {
        return $this->hasMany(QuoteLine::class);
    }

    /** مرجع مخزَّن — لا يُصفّى بالفرع أبداً (المستند حجّة قائمة، لا نتيجة تصفّح). */
    public function partner(): BelongsTo
    {
        return $this->referenceBelongsTo(Partner::class);
    }

    /** مراجعة الطباعة المثبتة عند الإصدار الصريح؛ لا تعاد قراءتها من تعيين حي. */
    public function printTemplateRevision(): BelongsTo
    {
        return $this->belongsTo(PrintTemplateRevision::class, 'print_template_revision_id');
    }

    /** مراجعة PDF المثبتة عند الإصدار الصريح؛ قد تختلف عن مراجعة الطباعة. */
    public function pdfTemplateRevision(): BelongsTo
    {
        return $this->belongsTo(PrintTemplateRevision::class, 'pdf_template_revision_id');
    }

    /** مراجعة الإخراج الحراري المثبتة عند الإصدار الصريح. */
    public function thermalTemplateRevision(): BelongsTo
    {
        return $this->belongsTo(PrintTemplateRevision::class, 'thermal_template_revision_id');
    }

    /** المستند الصادر الذي نشأت منه هذه النسخة القابلة للتعديل. */
    public function revisedFrom(): BelongsTo
    {
        return $this->referenceBelongsTo(self::class, 'revised_from_id');
    }

    public function isConverted(): bool
    {
        return $this->status === 'converted';
    }

    public function isPrintIssued(): bool
    {
        return $this->print_issued_at !== null;
    }
}
