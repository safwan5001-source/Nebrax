<?php

namespace App\Models;

use App\Tenancy\CompanyWide;
use App\Tenancy\ResolvesBranchReferences;
use App\Tenancy\TenantContext;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use RuntimeException;

/**
 * وسائط خاصة ببطاقة المنتج (صور فقط في هذه المرحلة) — ثلاث نطاقاتٍ حصرية
 * (VAR-MEDIA-1):
 *
 *   منتجٌ (مشترك)   → product_option_value_id فارغ، product_variant_id فارغ
 *   قيمة خيارٍ (مثل اللون=أسود) → product_option_value_id معبَّأ، الآخر فارغ
 *   متغيّرٌ فعليٌّ بعينه       → product_variant_id معبَّأ، الآخر فارغ
 *
 * **لا صفّ يستهدف قيمة خيارٍ ومتغيّراً معاً** — يُفرض في `booted()` أدناه لا
 * بقيد قاعدة بيانات (السبب: قيدٌ عابرٌ للمحرّكين كان يحتاج إعادة بناء جدول
 * SQLite كاملة على عمودٍ قائم، وهي فئة المخاطرة التي حذّر منها عقد VAR-MEDIA-1
 * صراحةً). كلا العمودين يحملان `cascadeOnDelete()` من القاعدة كطبقة أمانٍ إضافية.
 *
 * الغلاف المحلول **ليس عموداً منفصلاً** — أوّل عنصرٍ في المعرض المحلول
 * (`ProductMediaGalleryService::resolveGallery()`) هو الغلاف دائماً، بنفس
 * العرف القائم فعلياً قبل هذا المعيار (كل استهلاكٍ سابق كان يأخذ «أوّل صفٍّ
 * بترتيب sort_order») — لا سلطة غلافٍ ثانية مختلقة.
 *
 * المسار الداخلي لا يظهر في API؛ تُستدعى الوسائط من خلال مسار تنزيل محروس
 * يثبت تبعيتها للمنتج والمستأجر أولاً.
 */
class ProductMedia extends BaseModel implements CompanyWide
{
    use ResolvesBranchReferences;

    protected $fillable = [
        'tenant_id', 'product_id', 'product_option_value_id', 'product_variant_id',
        'disk', 'path', 'original_name', 'mime_type', 'size', 'sort_order', 'uploaded_by',
    ];

    protected $casts = [
        'size' => 'integer',
        'sort_order' => 'integer',
    ];

    protected static function booted(): void
    {
        static::saving(function (ProductMedia $media): void {
            if ($media->product_option_value_id !== null && $media->product_variant_id !== null) {
                throw new RuntimeException('لا يمكن لوسيطٍ واحد أن يستهدف قيمة خيارٍ ومتغيّراً معاً.');
            }

            // `BelongsToTenant::bootBelongsToTenant()` يملأ `tenant_id` عند
            // `creating`، وهذا الحارس يعمل في `saving` **قبله** (الترتيب
            // الفعلي لأحداث Eloquent عند الإدراج) — فلا يُعتمَد على العمود
            // نفسه هنا لإنشاءٍ جديد بلا `tenant_id` صريح، بل على السياق
            // النشط بنفس منطق `BelongsToTenant` حرفياً.
            $tenantId = $media->tenant_id ?: app(TenantContext::class)->id();

            if ($media->product_option_value_id !== null) {
                $value = ProductOptionValue::with('option')->find($media->product_option_value_id);
                if ($value === null || $value->option === null || $value->option->product_id !== $media->product_id) {
                    throw new RuntimeException('قيمة الخيار المحدَّدة لا تخصّ هذا المنتج.');
                }
                if ($value->tenant_id !== $tenantId) {
                    throw new RuntimeException('تعارض عزل مستأجر بين المنتج وقيمة الخيار.');
                }
            }

            if ($media->product_variant_id !== null) {
                $variant = ProductVariant::find($media->product_variant_id);
                if ($variant === null || $variant->product_id !== $media->product_id) {
                    throw new RuntimeException('المتغيّر المحدَّد لا يتبع هذا المنتج.');
                }
                if ($variant->tenant_id !== $tenantId) {
                    throw new RuntimeException('تعارض عزل مستأجر بين المنتج والمتغيّر.');
                }
            }
        });
    }

    public function product(): BelongsTo
    {
        return $this->referenceBelongsTo(Product::class);
    }

    public function optionValue(): BelongsTo
    {
        return $this->belongsTo(ProductOptionValue::class, 'product_option_value_id');
    }

    public function variant(): BelongsTo
    {
        return $this->belongsTo(ProductVariant::class, 'product_variant_id');
    }

    public function uploader(): BelongsTo
    {
        return $this->referenceBelongsTo(User::class, 'uploaded_by');
    }

    public function isProductLevel(): bool
    {
        return $this->product_option_value_id === null && $this->product_variant_id === null;
    }
}
