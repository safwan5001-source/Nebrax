<?php

namespace App\Models;

use App\Support\GeneratesDocumentNumbers;
use App\Support\RecordsRevisions;
use App\Support\UtcSecondInstant;
use App\Tenancy\BelongsToBranch;
use App\Tenancy\ResolvesBranchReferences;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Relations\HasOne;
use LogicException;

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
        'branch_id', 'warehouse_id', 'price_list_id', 'pos_session_id',
        'tenant_id', 'number', 'partner_id', 'type', 'payment_type', 'zatca_document_type',
        'invoice_date', 'due_date', 'cost_center_id', 'classification_id', 'salesperson_id', 'status',
        'subtotal', 'discount', 'shipping', 'adjustment', 'tax_amount', 'total',
        'tax_inclusive', 'paid_amount', 'payment_status',
        'is_paid', 'payment_method', 'payment_reference', 'cash_account_id',
        'notes', 'journal_entry_id', 'cogs_entry_id', 'created_by',
        'zatca_qr', 'zatca_hash',
        'zatca_uuid', 'zatca_icv', 'zatca_previous_hash', 'zatca_xml', 'zatca_cleared_xml', 'print_template_revision_id', 'pdf_template_revision_id', 'thermal_template_revision_id',
        'print_template_override_revision_id', 'pdf_template_override_revision_id',
        'language', 'language_frozen',
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
        // REM-13a: لحظة الإصدار القانونية (UTC، ثانية). ليست في $fillable عمداً — تُكتب مرة واحدة في post() فقط.
        'issued_at'    => UtcSecondInstant::class,
        // REM-14: لقطة البائع/المشتري لحظة الإصدار (v1). ليست في $fillable عمداً — تُكتب مرة واحدة في post() فقط.
        'party_snapshot' => 'array',
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

    /** مرساة idempotency لمسودة بنيت من سندات تسليم، إن وجدت. */
    public function deliveryNoteDraftBuild(): HasOne
    {
        return $this->hasOne(DeliveryNoteInvoiceDraftBuild::class);
    }

    /** تخصيصات سندات التسليم المدققة؛ تمنع حذف أو إعادة بناء المسودة بلا مسار تصحيح موثق. */
    public function deliveryNoteAllocations(): HasMany
    {
        return $this->hasMany(DeliveryNoteInvoiceAllocation::class);
    }

    /** مرجع جلسة POS محفوظ؛ لا يختفي عند تبديل سياق الفرع بعد ترحيل الفاتورة. */
    public function posSession(): BelongsTo
    {
        return $this->referenceBelongsTo(PosSession::class);
    }

    /** مواعيد تشغيلية مرتبطة بالمستند؛ لا تغيّر مالاً أو قيداً. */
    public function appointments(): HasMany
    {
        return $this->hasMany(Appointment::class)->orderByDesc('appointment_at');
    }

    /** سجل الملاحظات الداخلي ومرفقاته؛ يظل خارج حقول الفاتورة المحاسبية. */
    public function notesLog(): HasMany
    {
        return $this->hasMany(InvoiceNote::class)->orderByDesc('recorded_at');
    }

    /** مرجع مخزَّن — لا يُصفّى بالفرع أبداً (المستند حجّة قائمة، لا نتيجة تصفّح). */
    public function partner(): BelongsTo
    {
        return $this->referenceBelongsTo(Partner::class);
    }

    /** تصنيف تحليلي محفوظ على الفاتورة؛ لا يغيّر القيد أو الإجماليات. */
    public function classification(): BelongsTo
    {
        return $this->referenceBelongsTo(Classification::class);
    }

    /** مخزن مثبت على رأس الفاتورة؛ لا يعاد حله من سياق الفرع عند الترحيل. */
    public function warehouse(): BelongsTo
    {
        return $this->belongsTo(Warehouse::class);
    }

    public function journalEntry(): BelongsTo
    {
        return $this->belongsTo(JournalEntry::class, 'journal_entry_id');
    }

    /** قائمة السعر المختارة يدوياً؛ المرجع يبقى مقروءاً للمراجعة بعد تغيّر سياق الفرع. */
    public function priceList(): BelongsTo
    {
        return $this->referenceBelongsTo(PriceList::class, 'price_list_id');
    }

    /** مركز تكلفة مرجعي محفوظ على الفاتورة؛ لا يختفي عند تبديل نطاق الفرع. */
    public function costCenter(): BelongsTo
    {
        return $this->referenceBelongsTo(CostCenter::class, 'cost_center_id');
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

    /** مراجعة print المختارة لهذه المسودة فقط؛ لا تغيّر تعيين الشركة/الفرع. */
    public function printTemplateOverrideRevision(): BelongsTo
    {
        return $this->belongsTo(PrintTemplateRevision::class, 'print_template_override_revision_id');
    }

    /** مراجعة PDF المختارة لهذه المسودة فقط؛ مستقلة معمارياً عن لقطة التجميد. */
    public function pdfTemplateOverrideRevision(): BelongsTo
    {
        return $this->belongsTo(PrintTemplateRevision::class, 'pdf_template_override_revision_id');
    }

    /**
     * الأعمدة «تُكتب مرة واحدة» (من null) داخل معاملة الترحيل ثم تثبت: لحظة الإصدار (REM-13a) ولقطة الأطراف (REM-14).
     *
     * الحارس يرفض التعديل والمسح معاً، ويقارن القيمة المنطقية (JSON مفكوكاً للقطة) لا النص الخام فلا يختلف
     * بين SQLite وPostgreSQL. وإن لم يكن العمود محمَّلاً أصلاً في النموذج (select جزئي) يقرأ القيمة المخزَّنة من
     * الصف نفسه بالمفتاح الأساسي **بلا نطاقات** — كي لا يتيح نموذجٌ جزئي ما يمنعه الكامل.
     *
     * حدود Eloquent الموثَّقة (لا يغطيها أي حارس نموذج): `Invoice::query()->update()` والتحديث الجماعي،
     * `DB::table('invoices')` وSQL الخام، و`saveQuietly`. لا يوجد في التطبيق مسار منها (يحرس ذلك
     * `InvoicePartySnapshotTest::no_application_code_writes_the_write_once_columns_outside_the_posting_path`)،
     * ولا العمودان في $fillable ولا في أي FormRequest. ما يبقى نظرياً هو وصول مباشر إلى قاعدة البيانات.
     */
    protected static function booted(): void
    {
        static::updating(function (self $invoice): void {
            $attributes = $invoice->getAttributes();
            $rawOriginal = $invoice->getRawOriginal();

            foreach (['issued_at', 'party_snapshot'] as $column) {
                if (! array_key_exists($column, $attributes)) {
                    continue; // العمود لم يُحمَّل ولم يُسنَد: لن يُكتب.
                }

                $stored = array_key_exists($column, $rawOriginal)
                    ? $rawOriginal[$column]
                    : $invoice->newQueryWithoutScopes()->whereKey($invoice->getKey())->value($column);

                if ($stored === null) {
                    continue; // أول كتابة (الترحيل) مسموحة.
                }

                if (self::normalizeWriteOnce($column, $attributes[$column]) !== self::normalizeWriteOnce($column, $stored)) {
                    throw new LogicException(
                        "العمود {$column} في الفاتورة يُكتب مرة واحدة عند الترحيل ثم يثبت؛ لا يجوز تعديله أو مسحه."
                    );
                }
            }
        });
    }

    private static function normalizeWriteOnce(string $column, mixed $value): mixed
    {
        if ($value === null) {
            return null;
        }

        return $column === 'party_snapshot' && is_string($value) ? json_decode($value, true) : $value;
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
