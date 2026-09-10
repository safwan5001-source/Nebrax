<?php

namespace App\Models;

use App\Tenancy\CompanyWide;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use LogicException;

/**
 * لقطة العميل/الاتصال/الشحن/الفوترة وقت الطلب — PR-COM-6C.
 *
 * حجّة تاريخية مستقلة عن `Partner`/`CustomerIdentity`: تعديل أيٍّ منهما بعد
 * الالتقاط لا يغيّر هذه اللقطة إطلاقاً — لا قراءة حيّة، لا سقوط تلقائي (fallback)
 * لبيانات الطرف/الهوية الحالية بعد الالتقاط. ليست دفتر عناوين قابلاً لإعادة
 * الاستخدام؛ سطرٌ واحدٌ اختياريٌّ لكل `CommerceOrder` (صفرٌ للطلبات التاريخية
 * والضيوف السابقين على COM-7).
 *
 * **لا سلطة تفويض هنا إطلاقاً**: `email`/`phone`/`customer_name`/حقول العنوان
 * بيانات وصفية بحتة — لا تُستعمَل ولن تُستعمَل لتفويض وصولٍ لأي مورد. الملكية
 * الفعلية تبقى حصراً في `CommerceOrder.customer_identity_id` (PR-COM-6B).
 *
 * **`CompanyWide`**: تتبع تصنيف رأسها (`CommerceOrder`) تماماً كسطوره
 * (`CommerceOrderLine`) — لا فرعاً بعينه.
 */
class CommerceOrderSnapshot extends BaseModel implements CompanyWide
{
    protected $fillable = [
        'tenant_id', 'commerce_order_id',
        'customer_name', 'contact_name', 'company_name', 'email', 'phone', 'vat_number', 'cr_number',
        'shipping_recipient_name', 'shipping_phone', 'shipping_country', 'shipping_city', 'shipping_district',
        'shipping_street', 'shipping_building_no', 'shipping_postal_code', 'shipping_notes',
        'billing_recipient_name', 'billing_phone', 'billing_country', 'billing_city', 'billing_district',
        'billing_street', 'billing_building_no', 'billing_postal_code',
    ];

    /**
     * حراسة مركزية للجمود (§ Immutability, P1 hardening) — تغطي **كل** مسار
     * تحوير ممكن على النموذج، لا التعديل وحده: إنشاءٌ لطلبٍ مؤكَّدٍ سلفاً،
     * تعديلٌ، حذفٌ، أو إعادة ربطٍ بطلبٍ آخر عبر `commerce_order_id` — بلا
     * اعتمادٍ على انضباط الواجهة أو طبقة الخدمة وحدها. `CommerceOrderService::
     * updateSnapshot()` يتحقّق من نفس الشرط مسبقاً لرسالة تطبيقية أوضح، لكن
     * هذا الحارس هو الضمانة التي لا يمكن تجاوزها مهما كان مسار الاستدعاء
     * (بنفس أسلوب `CommerceOrder::booted()` لمنع حذف المؤكَّد).
     *
     * **`commerce_order_id` غير قابلٍ للتغيير بنيوياً بعد الإنشاء** — لا
     * فحص «هل الطلب الجديد مؤكَّد؟» وحده: ذلك كان سيسمح بإعادة ربط لقطةٍ
     * تابعة لطلبٍ مسودة بطلبٍ آخر مسودة أيضاً فتُفلت من كل قيدٍ مستقبلي على
     * تلك اللقطة تحديداً، أو الأخطر — إعادة ربط لقطةٍ مؤكَّدة الطلب بمسودة
     * لتحويرها ثم إعادتها. الحلّ الأضيق: `isDirty('commerce_order_id')`
     * يُرفَض مطلقاً قبل أي فحص حالة — لا حاجة لمقارنة المالك الأصلي بالجديد
     * لأن إعادة الربط نفسها ممنوعة، لا حالة بعينها منه.
     */
    protected static function booted(): void
    {
        static::creating(function (self $snapshot): void {
            self::rejectIfOwningOrderIsConfirmed(
                $snapshot,
                'لا يمكن إنشاء لقطة لطلب Commerce مؤكَّد — اللقطة تُلتقط وقت الطلب فقط، لا بعد تأكيده.'
            );
        });

        static::updating(function (self $snapshot): void {
            if ($snapshot->isDirty('commerce_order_id')) {
                throw new LogicException('لا يمكن إعادة ربط لقطة طلب Commerce بطلبٍ آخر — الملكية غير قابلة للتغيير بنيوياً بعد الإنشاء.');
            }

            self::rejectIfOwningOrderIsConfirmed(
                $snapshot,
                'لا يمكن تعديل لقطة طلب Commerce مؤكَّد — لقطة تاريخية مجمَّدة.'
            );
        });

        static::deleting(function (self $snapshot): void {
            self::rejectIfOwningOrderIsConfirmed(
                $snapshot,
                'لا يمكن حذف لقطة طلب Commerce مؤكَّد — لقطة تاريخية مجمَّدة.'
            );
        });
    }

    private static function rejectIfOwningOrderIsConfirmed(self $snapshot, string $message): void
    {
        $order = $snapshot->order()->first();
        if ($order !== null && $order->isConfirmed()) {
            throw new LogicException($message);
        }
    }

    public function order(): BelongsTo
    {
        return $this->belongsTo(CommerceOrder::class, 'commerce_order_id');
    }
}
