<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * COM-CHECKOUT-1B — عمودان إضافيان بحتان على `commerce_checkouts` (COM-CHECKOUT-1A)
 * لحمل النصف التطبيقي من عقد Idempotency-Key الإلزامي لإتمام Checkout
 * (AWJ_CHECKOUT_V1_ARCHITECTURE.md §9): تجزئة المفتاح الخام (لا يُخزَّن خاماً،
 * بنفس مبدأ `PublicApiIdempotencyKey`/`PublicApiIdempotency::hashKey()`)
 * وبصمة الطلب المُقنّنة (`PublicApiIdempotency::fingerprintParts()`) — تُملآن
 * معاً **في نفس معاملة الإتمام** التي تنشئ `CommerceOrder` وتنقل
 * `commerce_checkouts.status` إلى `completed`.
 *
 * **لماذا على صفّ Checkout نفسه لا جدولٍ عام منفصل مثل
 * `public_api_idempotency_keys`**: ذاك الجدول مربوطٌ بنيوياً بـ`api_client_id`
 * (مصادقة M2M) — `store/v1` بلا مصادقة (تصفّح مجهول، بوابة Host الموثوقة
 * وحدها). Checkout نفسه **هو** حدّ المطالبة الطبيعي: قفل صفّه
 * (`lockForUpdate()` داخل معاملة الإتمام، نفس نمط CHECKOUT-1A) يسلسل كل
 * محاولات الإتمام المتزامنة لنفس Checkout بنيوياً — لا حاجة لجدول
 * "in_progress" منفصل، فالقفل على الصفّ الوحيد ذاته هو آلية التسلسل.
 * إعادة محاولة بنفس المفتاح بعد فشل (rollback) لا تترك أثراً: هذان العمودان
 * لا يُكتبان إلا مع `status = completed` في نفس الالتزام تماماً — فشلٌ يُبقيهما
 * `null` دون حاجة لتحريرٍ صريح.
 *
 * **الضمان المزدوج المطلوب صراحةً (لا أحدهما بديل عن الآخر)**:
 *  - هذان العمودان = العقد التطبيقي (نفس مفتاح + نفس بصمة ⇐ إعادة تشغيل؛ نفس
 *    مفتاح + بصمة مختلفة ⇐ تعارض 409؛ مفتاح مختلف على Checkout مكتمل ⇐ رفض).
 *  - `commerce_orders.commerce_checkout_id` الفريد (migration السابقة) = ضمان
 *    القاعدة الصلب: حتى لو انحرف التطبيق، لا يمكن إدراج طلبين لنفس Checkout.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('commerce_checkouts', function (Blueprint $table) {
            $table->string('completion_idempotency_key_hash', 64)->nullable()->after('delivery_amount_minor');
            $table->string('completion_idempotency_fingerprint', 64)->nullable()->after('completion_idempotency_key_hash');
        });
    }

    public function down(): void
    {
        Schema::table('commerce_checkouts', function (Blueprint $table) {
            $table->dropColumn(['completion_idempotency_key_hash', 'completion_idempotency_fingerprint']);
        });
    }
};
