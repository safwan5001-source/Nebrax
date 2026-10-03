<?php

namespace App\Models;

use App\Tenancy\BelongsToBranch;
use App\Tenancy\ResolvesBranchReferences;
use App\Tenancy\TenantContext;
use DomainException;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use LogicException;

/**
 * سياق منصة توصيل مثبّت على فاتورة — DLV-ACCOUNTING-1 (DG-2).
 *
 * **ليس توسيعاً لـ`invoices`**: جدول جانبي مستقل يحمل هوية المنصة/القناة/النسخة
 * وقت التسجيل. `Invoice.partner_id` يبقى طرف الفاتورة الافتراضي/الزائر دوماً —
 * هذا الصف توثيقٌ تحليلي، لا طرف محاسبي ولا بديل عنه.
 *
 * **إلحاقي ثابت**: لا تحديث ولا حذف بعد الإنشاء، تماماً كنسخ تكوين منصة
 * التوصيل نفسها (`DeliveryPlatformProfileVersion`) — تعديل لاحق على الملف أو
 * النسخة أو التجاوز الفرعي لا يغيّر ما ثُبِّت هنا. `unique(invoice_id)` على
 * الجدول هو مرساة idempotency التسجيل: فاتورة واحدة بسياق واحد.
 *
 * `BelongsToBranch`: فرعها الحُجّة **المشتقّ من فاتورتها** عند الإنشاء — لا
 * من الفرع النشط افتراضياً، فسياق مسجَّل من سياق فرع مختلف (مهمة خلفية لاحقاً)
 * يبقى محمولاً على فرع الفاتورة نفسها لا منفّذ التسجيل.
 *
 * `external_order_reference` معلوماتي بحت: **لا** يُستخدم في أي عملية بحث أو
 * تحقق هوية أو مطابقة؛ القناة المعتمدة دوماً `invoice_id`.
 */
class DeliveryInvoiceContext extends BaseModel
{
    use BelongsToBranch;
    use ResolvesBranchReferences;

    public $timestamps = false;

    protected $fillable = [
        'tenant_id', 'branch_id', 'invoice_id', 'sales_channel_id',
        'delivery_platform_profile_id', 'delivery_platform_profile_version_id',
        'collection_mode', 'external_order_reference', 'created_by', 'created_at',
    ];

    protected $casts = [
        'created_at' => 'datetime',
    ];

    protected static function booted(): void
    {
        static::creating(function (self $context): void {
            $tenantContext = app(TenantContext::class);
            if (! $tenantContext->has()) {
                throw new DomainException('Tenant context is required for delivery invoice context.');
            }
            $tenantId = (string) $tenantContext->id();
            if ($context->tenant_id !== null && (string) $context->tenant_id !== $tenantId) {
                throw new DomainException('Delivery invoice context tenant cannot be forged.');
            }
            $context->tenant_id = $tenantId;

            // TenantScope: فاتورة مستأجر آخر لا تُحلّ وتُعامَل كغير موجودة.
            // `lockForUpdate()`: يسلسل هذا الإنشاء مع أي `PaymentService::post()`
            // متزامن يقفل الفاتورة نفسها — كلاهما داخل معاملة (الخدمة تفتحها
            // دوماً؛ إنشاء مباشر خارج معاملة لا يستفيد من القفل، لكنه لا يفقد
            // شيئاً كان موجوداً). بلا هذا القفل: قراءة `paid_amount` هنا يمكن أن
            // تسبق التزام دفعة متزامنة تُحصِّل الفاتورة نقداً، فيُثبَّت سياق
            // platform_collected على فاتورة سيتبيّن أنها حُصِّلت نقداً للتو.
            $invoice = Invoice::query()->whereKey($context->invoice_id)->lockForUpdate()->first();
            if ($invoice === null) {
                throw new DomainException('Delivery invoice context invoice must belong to the active tenant.');
            }
            // يُفرَض هنا لا في الخدمة فقط — إنشاء مباشر يتجاوز
            // `DeliveryInvoiceContextService::record()` لا يُعفى من الشرط. مسودة
            // قابلة للحذف (`InvoiceService::deleteDraft()`)؛ قيد FK المقيَّد على
            // `invoice_id` كان سيعطّل حذفها لو حملت سياقاً.
            if (! $invoice->isPosted()) {
                throw new DomainException('Delivery invoice context requires a posted invoice.');
            }
            // فاتورة "مدفوعة بالفعل" (`InvoiceService::settle()`) تُحصَّل بسند
            // قبض نقد/بنك عادي **لحظة الترحيل** — قبل أن يُسجَّل أي سياق. سياقٌ
            // platform_collected على فاتورة مُحصَّلة فعلاً يناقض الواقع: لا قيد
            // مقاصة منصة موجود، والتحصيل الحقيقي أُغلق بالفعل على AR.
            if ($invoice->paid_amount > 0) {
                throw new DomainException('Delivery invoice context cannot be recorded after the invoice has already been collected.');
            }

            // الفرع دائماً فرع الفاتورة نفسها — حجّة واحدة، **تُفرَض دوماً** ولا
            // تُقارَن: `BelongsToBranch` (مُستخدَمة أدناه) تملأ الحقل من الفرع
            // النشط إن وجده فارغاً **قبل** هذا الحارس، فحتى تمريرٌ صريح لـ
            // `branch_id => null` (فاتورة بلا فرع) يُستبدل بفرعٍ نشطٍ مختلف من
            // سياق التنفيذ — بالضبط حالة تسجيلٍ من مهمة خلفية بفرع نشط آخر.
            // الفرع هنا بُعد كتابة بلا أثر عزل (توثيق `BelongsToBranch`)، فالفرض
            // غير المشروط آمن ولا يحتاج رفضاً: القيمة المخزَّنة تبقى صحيحة دوماً
            // بصرف النظر عمّا مُرِّر.
            $context->branch_id = $invoice->branch_id;

            $channel = SalesChannel::query()->whereKey($context->sales_channel_id)->first();
            if ($channel === null) {
                throw new DomainException('Delivery invoice context sales channel must belong to the active tenant.');
            }

            $profile = DeliveryPlatformProfile::query()->whereKey($context->delivery_platform_profile_id)->first();
            if ($profile === null) {
                throw new DomainException('Delivery invoice context platform profile must belong to the active tenant.');
            }
            if ((string) $profile->sales_channel_id !== (string) $channel->id) {
                throw new DomainException('Delivery invoice context channel must match its platform profile channel.');
            }

            $version = DeliveryPlatformProfileVersion::query()->whereKey($context->delivery_platform_profile_version_id)->first();
            if ($version === null) {
                throw new DomainException('Delivery invoice context profile version must belong to the active tenant.');
            }
            if ((string) $version->delivery_platform_profile_id !== (string) $profile->id) {
                throw new DomainException('Delivery invoice context version must belong to its platform profile.');
            }

            // collection_mode يُشتَقّ من سلسلة النسخة/التجاوز نفسها، لا يُؤخذ من
            // قيمة يرسلها المستدعي — إنشاء مباشر يتجاوز الخدمة (`DeliveryInvoiceContextService`)
            // لا يملك فرصة لإدخال قيمة مزيَّفة لا تطابق الإعداد المعتمد فعلاً.
            $override = $context->branch_id !== null
                ? DeliveryPlatformVersionOverride::query()
                    ->where('delivery_platform_profile_version_id', $version->id)
                    ->where('branch_id', $context->branch_id)
                    ->first()
                : null;
            $context->collection_mode = $override?->collection_mode ?? $version->collection_mode;

            // سياسة المرجع الخارجي تُفرَض هنا أيضاً — لا في الخدمة فقط — لنفس
            // سبب فرض collection_mode أعلاه: إنشاء مباشر يتجاوز الخدمة لا يُعفى.
            $reference = is_string($context->external_order_reference) ? trim($context->external_order_reference) : null;
            $context->external_order_reference = $reference === '' ? null : $reference;
            $referencePolicy = $override?->external_reference_policy ?? $version->external_reference_policy;
            if ($referencePolicy === DeliveryPlatformProfileVersion::REFERENCE_REQUIRED && $context->external_order_reference === null) {
                throw new DomainException('Delivery invoice context requires an external order reference under this platform\'s policy.');
            }
            if ($referencePolicy === DeliveryPlatformProfileVersion::REFERENCE_NONE && $context->external_order_reference !== null) {
                throw new DomainException('Delivery invoice context platform policy does not accept an external order reference.');
            }

            $context->created_at ??= now();
        });

        static::updating(static fn () => throw new LogicException('سياق منصة التوصيل على الفاتورة لا يُعدَّل.'));
        static::deleting(static fn () => throw new LogicException('سياق منصة التوصيل على الفاتورة لا يُحذف.'));
    }

    /** الفاتورة مرجع مخزَّن ثابت — لا تختفي من أثر السجل بتبديل نطاق الفرع. */
    public function invoice(): BelongsTo
    {
        return $this->referenceBelongsTo(Invoice::class);
    }

    public function salesChannel(): BelongsTo
    {
        return $this->belongsTo(SalesChannel::class);
    }

    public function profile(): BelongsTo
    {
        return $this->belongsTo(DeliveryPlatformProfile::class, 'delivery_platform_profile_id');
    }

    public function profileVersion(): BelongsTo
    {
        return $this->belongsTo(DeliveryPlatformProfileVersion::class, 'delivery_platform_profile_version_id');
    }

    public function creator(): BelongsTo
    {
        return $this->referenceBelongsTo(User::class, 'created_by');
    }
}
