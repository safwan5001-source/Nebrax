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
     * حراسة مركزية للجمود (§ Immutability) — لا تعتمد على انضباط الواجهة
     * أو طبقة الخدمة وحدها: أي محاولة تعديلٍ على لقطة تابعة لطلبٍ مؤكَّد
     * تُرفض هنا مباشرةً، بنفس أسلوب `CommerceOrder::booted()` لمنع حذف
     * المؤكَّد. `CommerceOrderService::updateSnapshot()` يتحقّق من نفس الشرط
     * مسبقاً لرسالة تطبيقية أوضح، لكن هذا الحارس هو الضمانة التي لا يمكن
     * تجاوزها مهما كان مسار الاستدعاء.
     */
    protected static function booted(): void
    {
        static::updating(function (self $snapshot): void {
            $order = $snapshot->order()->first();
            if ($order !== null && $order->isConfirmed()) {
                throw new LogicException('لا يمكن تعديل لقطة طلب Commerce مؤكَّد — لقطة تاريخية مجمَّدة.');
            }
        });
    }

    public function order(): BelongsTo
    {
        return $this->belongsTo(CommerceOrder::class, 'commerce_order_id');
    }
}
