<?php

namespace App\Models;

use App\Support\GeneratesDocumentNumbers;
use App\Support\RecordsRevisions;
use App\Tenancy\BelongsToBranch;
use App\Tenancy\ResolvesBranchReferences;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * مستند دورة الشراء — طلب شراء · طلب عروض · عرض مورّد · أمر شراء.
 *
 * **مستند تجاري غير محاسبي: لا يولّد قيوداً إطلاقاً.** الأثر المحاسبي يبدأ
 * فقط عند ترحيل فاتورة المشتريات الناتجة عن أمر الشراء (عبر المحرك).
 * كل المبالغ بالـ minor units (هللات) كـ bigint.
 */
/** @see design-system/foundations/multi-branch-architecture.md — موسوم: مستند، تصفيته صريحة في المتحكّم */
class ProcurementDocument extends BaseModel
{
    use ResolvesBranchReferences;
    use RecordsRevisions;
    use BelongsToBranch;
    use GeneratesDocumentNumbers;

    /** أنواع المستندات بترتيب السلسلة. */
    public const TYPES = ['request', 'rfq', 'quotation', 'order'];

    protected $fillable = [
        'branch_id',
        'tenant_id', 'type', 'number', 'partner_id', 'doc_date', 'due_date',
        'requested_by', 'status', 'subtotal', 'tax_amount', 'total',
        'tax_inclusive', 'notes', 'source_document_id', 'converted_purchase_id',
        'print_issued_at', 'print_template_revision_id', 'pdf_template_revision_id',
        'thermal_template_revision_id', 'revised_from_id', 'created_by',
    ];

    protected $casts = [
        'doc_date'      => 'date',
        'due_date'      => 'date',
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
        return $this->hasMany(ProcurementLine::class);
    }

    /** الموردون المدعوّون (لطلب العروض فقط). */
    public function invitations(): HasMany
    {
        return $this->hasMany(RfqInvitation::class);
    }

    /** المستند الذي وُلد منه هذا — يبني سلسلة التتبّع رجوعاً إلى الطلب الأصلي. */
    public function sourceDocument(): BelongsTo
    {
        return $this->referenceBelongsTo(self::class, 'source_document_id');
    }

    /** مرجع مخزَّن — لا يُصفّى بالفرع أبداً (المستند حجّة قائمة، لا نتيجة تصفّح). */
    public function partner(): BelongsTo
    {
        return $this->referenceBelongsTo(Partner::class);
    }

    public function purchase(): BelongsTo
    {
        return $this->referenceBelongsTo(Purchase::class, 'converted_purchase_id');
    }

    /** مراجعة الطباعة المثبتة عند إجراء الإصدار الصريح. */
    public function printTemplateRevision(): BelongsTo
    {
        return $this->belongsTo(PrintTemplateRevision::class, 'print_template_revision_id');
    }

    /** مراجعة PDF المثبتة عند إجراء الإصدار الصريح. */
    public function pdfTemplateRevision(): BelongsTo
    {
        return $this->belongsTo(PrintTemplateRevision::class, 'pdf_template_revision_id');
    }

    /** مراجعة الإخراج الحراري المثبتة عند إجراء الإصدار الصريح. */
    public function thermalTemplateRevision(): BelongsTo
    {
        return $this->belongsTo(PrintTemplateRevision::class, 'thermal_template_revision_id');
    }

    /** المستند الصادر الذي نشأت منه هذه النسخة القابلة للتعديل. */
    public function revisedFrom(): BelongsTo
    {
        return $this->referenceBelongsTo(self::class, 'revised_from_id');
    }

    public function isDraft(): bool
    {
        return $this->status === 'draft';
    }

    public function isConverted(): bool
    {
        return $this->status === 'converted';
    }

    /** حالة نهائية — لا تعديل ولا انتقال بعدها. */
    public function isClosed(): bool
    {
        return $this->isPrintIssued() || in_array($this->status, ['converted', 'cancelled'], true);
    }

    public function isPrintIssued(): bool
    {
        return $this->print_issued_at !== null;
    }
}
