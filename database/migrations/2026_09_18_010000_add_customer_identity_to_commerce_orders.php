<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * PR-COM-6B — الملكية الرقمية للطلب (Master Plan «Revised PHASE 6»):
 * `customer_identity_id` عمودٌ إضافيٌّ بحت — لا جدول جديد، لا تغيير على عمود
 * قائم. اختياريٌّ دائماً (`nullable`): الطلبات الحالية (COM-5A/5B) وطلبات
 * الضيف تبقى صالحة بلا أي تعديل بيانات.
 *
 * **مصدره الوحيد:** `App\Tenancy\CustomerContext::customerIdentityId()` عبر
 * `CommerceOrderService::create()` — لا مُدخَل طالبٍ يصل إليه إطلاقاً (لا حتى
 * عبر `trustedPartnerSelection`، الذي يبقى محصوراً بـ`partner_id` وحده).
 * راجع `docs/plans/store/COMMERCE_TRUSTED_PARTNER_SELECTION_SECURITY_NOTE.md`.
 *
 * **مفتاح مركّب لأمان المستأجر على مستوى القاعدة:** `customer_identities`
 * يحمل بالفعل `unique(tenant_id, id)` منذ أساس منصة العميل
 * (`2026_09_11_010000_create_customer_digital_access_foundation.php`)، فيُستعمَل
 * هنا حرفياً كما استُعمِل في `customer_partner_links` — لا يكفي تطابق `id`
 * فقط، بل `(tenant_id, id)` معاً، فيرفض القيد نفسه أي هوية من مستأجرٍ آخر
 * حتى لو حاول كودٌ مستقبليٌّ إدخالها مباشرة (دفاعٌ في العمق على مستوى القاعدة،
 * لا فقط في `CommerceOrderService`).
 *
 * **`restrictOnDelete()`** — لا `nullOnDelete()` — بنفس منطق `partner_id`
 * الحالي على هذا الجدول: `CommerceOrder` سجلٌّ تاريخي لالتزامٍ تجاري؛ حذفٌ
 * صلبٌ لهوية عميل مملوكة له يُمحي أثراً يجب أن يبقى قابلاً للتفسير، فيُرفض
 * الحذف صريحاً لا أن يتحوّل الطلب صمتاً إلى طلب ضيف.
 *
 * لا علاقة بـ COM-6C: لا حقل عنوان/جهة اتصال/لقطة هنا — هذا عمود ملكيةٍ
 * مباشر، بنفس طبيعة `partner_id` القائم، لا لقطة تاريخية جديدة.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('commerce_orders', function (Blueprint $table) {
            $table->uuid('customer_identity_id')->nullable()->after('partner_id');

            $table->foreign(['tenant_id', 'customer_identity_id'], 'commerce_orders_customer_identity_fk')
                ->references(['tenant_id', 'id'])->on('customer_identities')->restrictOnDelete();

            $table->index(['tenant_id', 'customer_identity_id'], 'commerce_orders_tenant_customer_identity_index');
        });
    }

    public function down(): void
    {
        Schema::table('commerce_orders', function (Blueprint $table) {
            $table->dropForeign('commerce_orders_customer_identity_fk');
            $table->dropIndex('commerce_orders_tenant_customer_identity_index');
            $table->dropColumn('customer_identity_id');
        });
    }
};
