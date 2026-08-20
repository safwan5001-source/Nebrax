<?php

namespace App\Models;

use App\Support\GeneratesDocumentNumbers;
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
    use GeneratesDocumentNumbers;

    protected $fillable = [
        'branch_id',
        'tenant_id', 'number', 'partner_id', 'invoice_id',
        'direction', 'method', 'payment_method_id', 'payment_method_name', 'reference', 'payment_details', 'cash_account_id', 'payment_date', 'amount',
        'status', 'notes', 'journal_entry_id', 'print_template_revision_id', 'pdf_template_revision_id', 'thermal_template_revision_id', 'created_by', 'collector_employee_id',
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

    /** الطريقة المختارة؛ تبقى لقطة الاسم على السند حتى بعد تعديل الإعداد. */
    public function paymentMethod(): BelongsTo
    {
        return $this->belongsTo(PaymentMethod::class);
    }

    public function journalEntry(): BelongsTo
    {
        return $this->belongsTo(JournalEntry::class, 'journal_entry_id');
    }

    /** الموظف الذي استلم التحصيل؛ مستقل عن المستخدم الذي أنشأ السند. */
    public function collectorEmployee(): BelongsTo
    {
        return $this->referenceBelongsTo(Employee::class, 'collector_employee_id');
    }

    /** مرفقات إثبات الدفع الخاصة بالسند. */
    public function attachments(): HasMany
    {
        return $this->hasMany(PaymentAttachment::class);
    }

    /** المرجع التاريخي للقالب الذي كان منشوراً عند ترحيل السند. */
    public function printTemplateRevision(): BelongsTo
    {
        return $this->belongsTo(PrintTemplateRevision::class, 'print_template_revision_id');
    }

    /** المرجع التاريخي للمراجعة المختارة لإخراج PDF. */
    public function pdfTemplateRevision(): BelongsTo
    {
        return $this->belongsTo(PrintTemplateRevision::class, 'pdf_template_revision_id');
    }

    /** المرجع التاريخي للمراجعة المختارة للطباعة الحرارية. */
    public function thermalTemplateRevision(): BelongsTo
    {
        return $this->belongsTo(PrintTemplateRevision::class, 'thermal_template_revision_id');
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
