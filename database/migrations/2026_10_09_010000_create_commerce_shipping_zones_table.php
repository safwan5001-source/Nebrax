<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * COM-MOBILE-SHIPPING-1 (ADR-10) — أول محرك تسعير شحن حقيقي: مناطق شحن
 * مُهيَّأة من التاجر، بلا أي مزوّد/ناقل. يحلّ محل `delivery_amount_minor`
 * الصفري المُقفَل بنيوياً في `CommerceCheckoutService::updateDelivery()`.
 *
 * `CompanyWide` بنفس تصنيف `PaymentMethod`/`FulfillmentPolicy`: بيان تسعير
 * واحد للمؤسسة، لا فرعاً بعينه — قناة البيع (لا الفرع) هي حدود Commerce
 * (ADR-03 §1).
 *
 * V1 مطابقةٌ حرفية فقط (مدينة أو منطقة) — لا نطاقات جغرافية، لا مسافة، لا
 * وزن/أبعاد (ADR-10 §6). `match_type`+`match_value` بدل `city`/`region`
 * عمودين منفصلين: يمنع تناقضاً بنيوياً (صفٌّ لا يحمل قيمتي مطابقة معاً بلا
 * معنى لأيّهما يُقدَّم)، ويفتح الباب لمستوى مطابقة إضافي لاحقاً (حيّ، مثلاً)
 * بقيمة enum جديدة فقط — لا عمود جديد ولا هجرة بيانات.
 *
 * `unique(tenant_id, match_type, match_value)`: صفّان بنفس النوع والقيمة
 * تناقضٌ في التسعير («ما السعر الصحيح؟») يُمنع بنيوياً، لا بفحص تطبيق وحده.
 * المطابقة عند القراءة غير حسّاسة لحالة الأحرف (`ShippingRateService`)؛ هذا
 * القيد حسّاس لحالتها كقاعدة بيانات — تكرار بفارق حالة أحرف فقط (نادر عملياً
 * لعناوين عربية) يُترَك لفحص الخدمة وقت الإنشاء/التحديث، لا هذه الهجرة.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('commerce_shipping_zones', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->string('name');
            $table->string('match_type', 16); // city | region
            $table->string('match_value');
            $table->unsignedBigInteger('rate_amount_minor')->default(0);
            $table->boolean('is_active')->default(true);
            $table->timestamps();

            $table->unique(['tenant_id', 'match_type', 'match_value']);
            $table->index(['tenant_id', 'is_active']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('commerce_shipping_zones');
    }
};
