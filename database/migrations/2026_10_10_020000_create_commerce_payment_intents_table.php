<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * COM-MOBILE-PAYMENTS-1 (ADR-04 §1/§2, ADR-09) — أول تطبيق لحدّ Payment
 * Intent المعماري المعتمد: `Commerce Order → Payment Intent → ... →
 * Successful Settlement → AWJ Payment Core القائم`. مقيَّدٌ بصراحة لطريقتين
 * لا تحتاجان مزوّداً (`cod`/`pay_on_pickup`، ADR-09 §1) — لا مزوّد دفع، لا
 * بوابة، لا التقاط عبر الإنترنت.
 *
 * **`unique(commerce_order_id)`**: واحدٌ لكل طلب في V1 — لا محاولات متعددة
 * (`Attempt A/B/C`، ADR-04 §2) لأن COD/الاستلام لا "محاولة فاشلة" لهما
 * مفهوماً؛ يُوسَّع لاحقاً بجدول محاولات منفصل إن احتاج مزوّدٌ حقيقي إعادة
 * محاولة، لا بتعديل هذا العمود.
 *
 * **`cascadeOnDelete()` على `commerce_order_id`**: نفس نمط `commerce_order_
 * lines`/`commerce_order_snapshots` حرفياً — التزام دفعٍ بلا طلبه لا معنى
 * له، فليس مرجعاً مستقلاً يستحق `restrictOnDelete()` (بخلاف `payment_
 * method_id` أدناه، وهو مرجعٌ لكيانٍ قائمٍ بذاته تشترك فيه طلباتٌ كثيرة).
 *
 * **`amount_minor` لقطة لا مرجع**: يُنسَخ من `CommerceOrder.total` وقت
 * الإنشاء (ADR-04 §3: "مبلغ Payment Intent يطابق لقطة تجارية معتمدة") —
 * تغيّر الطلب لاحقاً (لا يحدث اليوم أصلاً؛ الطلب المؤكَّد غير قابل للتعديل)
 * لا يُغيّر الالتزام المالي المسجَّل هنا بصمت.
 *
 * **`payment_method_id`+`payment_method_name`**: نفس نمط `payments` تماماً
 * (سند دفع/قبض) — مرجعٌ + لقطة اسم تبقي السجل مقروءاً بعد تعديل/تعطيل طريقة
 * الدفع لاحقاً. `restrictOnDelete()` يطابق قيد `payments.payment_method_id`.
 *
 * **لا أثر محاسبي هنا صراحةً**: `markCollected()` (`CommercePaymentIntentService`)
 * ينقل الحالة فقط في هذا الإصدار — لا يستدعي `PaymentService`/`LedgerService`.
 * ADR-09 §4 يجعل ذلك اختيارياً صراحةً لهذا الإصدار ("if built in this pass")؛
 * ربطه بسند قبض حقيقي (`Payment`، partner-centric) يحتاج قراراً منفصلاً حول
 * تمثيل عملاء Commerce (`CustomerIdentity` لا `Partner` بالضرورة) في محرك
 * الدفع الحالي — مسجَّلٌ كعملٍ مكتشَف مؤجَّل، لا بوابة قرار توقف هذه المهمة.
 *
 * **`CompanyWide`**: يتبع تصنيف رأسه (`CommerceOrder`) — لا فرعاً بعينه.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('commerce_payment_intents', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('commerce_order_id')->constrained('commerce_orders')->cascadeOnDelete();
            $table->foreignUuid('payment_method_id')->nullable()->constrained('payment_methods')->restrictOnDelete();
            $table->string('payment_method_name')->nullable();

            $table->string('method', 32); // cod | pay_on_pickup
            $table->string('status', 32)->default('awaiting_collection'); // pending | awaiting_collection | collected | cancelled

            $table->bigInteger('amount_minor');
            $table->string('currency', 3);

            $table->timestamp('collected_at')->nullable();
            $table->timestamp('cancelled_at')->nullable();
            $table->string('collection_note', 1000)->nullable();

            $table->timestamps();

            $table->unique('commerce_order_id');
            $table->index(['tenant_id', 'status']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('commerce_payment_intents');
    }
};
