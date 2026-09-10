<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * PR-COM-6C — لقطة العميل/الاتصال/الشحن/الفوترة وقت الطلب (Master Plan
 * «Revised PHASE 6»): جدولٌ إضافيٌّ منفصل، لا تعديل على `commerce_orders`
 * القائم — بنفس منطق `commerce_order_lines` كجدولٍ تابعٍ مستقل.
 *
 * **لماذا جدول مستقل لا أعمدة على الرأس مباشرة**: اللقطة الكاملة (هوية
 * العميل + عنوان شحن + عنوان فوترة) تحتاج نحو ٢٤ حقلاً — إضافتها مباشرة على
 * `commerce_orders` كانت ستُغرق رأساً صغيراً (٨ أعمدة اليوم) بحقولٍ اختيارية
 * غالباً فارغة (الضيف/الطلبات القديمة). فصلها في جدول تابعٍ اختياري (صفرٌ أو
 * سطرٌ واحدٌ لكل طلب) يبقي `commerce_orders` نظيفاً ويطابق التمييز القائم
 * فعلاً بين رأسٍ ومُلحقاتٍ تابعة (`commerce_order_lines`).
 *
 * **اختياريٌّ دائماً بلا استثناء**: طلبات COM-5A/5B/6A/6B القائمة (والضيوف
 * مستقبلاً بلا لقطة) لا تملك أي سطرٍ هنا إطلاقاً — لا قيمة مُختلَقة لأي طلبٍ
 * تاريخي. الوجود من عدمه هو الدليل: سطرٌ موجود = لقطة أُلتُقطت، غيابه = لم
 * تُلتقط (تاريخي أو ضيفٌ سابقٌ على COM-7).
 *
 * **لا علاقة بملكية الطلب**: هذا الجدول بيانات وصفية بحتة عن العميل/العنوان
 * وقت الطلب — وليس سلطة تفويض. `commerce_orders.customer_identity_id`
 * (PR-COM-6B) يبقى المصدر الوحيد للملكية؛ حقول هذا الجدول (بما فيها
 * `email`/`phone`/`vat_number`) لا تُستعمَل ولن تُستعمَل أبداً لتفويض الوصول.
 *
 * **حقول العنوان تطابق مفردات `partners` الحالية حرفياً** (`address→street`،
 * `city`، `building_no`، `district`، `postal_code`، `country`) — لا مفردات
 * جديدة تُخترَع لعنوانٍ مماثل. `customer_name` وحده إلزاميٌّ (المرساة التي
 * تُعرِّف اللقطة نفسها)؛ كل ما عداه اختياري لأن دفعاً/شحناً رقمياً مستقبلاً قد
 * لا يحتاج عنوان شحن أصلاً.
 *
 * **`vat_number`/`cr_number` على مستوى العميل لا الفوترة**: يطابقان الهوية
 * التجارية للمشتري (كما على `partners`)، فلا داعي لتكرارهما تحت `billing_*`.
 *
 * **`cascadeOnDelete` على `commerce_order_id`**: مسودة Commerce يجوز حذفها
 * (`CommerceOrder::booted()` يمنع حذف المؤكَّد فقط)؛ حذف مسودةٍ يُنظّف لقطتها
 * معها بلا يتيمٍ في القاعدة — لا يوجد سيناريو يُحذف فيه الرأس وتبقى اللقطة.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('commerce_order_snapshots', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('commerce_order_id')->constrained('commerce_orders')->cascadeOnDelete();

            // لقطة هوية العميل/جهة الاتصال — customer_name هو المرساة الإلزامية.
            $table->string('customer_name');
            $table->string('contact_name')->nullable();
            $table->string('company_name')->nullable();
            $table->string('email')->nullable();
            $table->string('phone')->nullable();
            $table->string('vat_number', 15)->nullable();
            $table->string('cr_number')->nullable();

            // لقطة عنوان الشحن/التسليم — مفردات مطابقة لـ partners.
            $table->string('shipping_recipient_name')->nullable();
            $table->string('shipping_phone')->nullable();
            $table->string('shipping_country')->nullable();
            $table->string('shipping_city')->nullable();
            $table->string('shipping_district')->nullable();
            $table->string('shipping_street')->nullable();
            $table->string('shipping_building_no')->nullable();
            $table->string('shipping_postal_code')->nullable();
            $table->text('shipping_notes')->nullable();

            // لقطة عنوان الفوترة — مستقلة عن الشحن عمداً (Master Plan: لا
            // افتراض بأنّ الفوترة = الشحن دائماً؛ COM-7 قد ينسخهما فقط).
            $table->string('billing_recipient_name')->nullable();
            $table->string('billing_phone')->nullable();
            $table->string('billing_country')->nullable();
            $table->string('billing_city')->nullable();
            $table->string('billing_district')->nullable();
            $table->string('billing_street')->nullable();
            $table->string('billing_building_no')->nullable();
            $table->string('billing_postal_code')->nullable();

            $table->timestamps();

            $table->unique(['tenant_id', 'commerce_order_id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('commerce_order_snapshots');
    }
};
