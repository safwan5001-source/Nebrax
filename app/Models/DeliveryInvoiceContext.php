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
            $invoice = Invoice::query()->whereKey($context->invoice_id)->first();
            if ($invoice === null) {
                throw new DomainException('Delivery invoice context invoice must belong to the active tenant.');
            }

            // الفرع دائماً فرع الفاتورة نفسها — حجّة واحدة، لا تُنتحَل بفرع آخر.
            if ($context->branch_id !== null && (string) $context->branch_id !== (string) $invoice->branch_id) {
                throw new DomainException('Delivery invoice context branch must match its invoice branch.');
            }
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

            if (! in_array($context->collection_mode, DeliveryPlatformProfileVersion::COLLECTION_MODES, true)) {
                throw new DomainException('Invalid collection mode.');
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
