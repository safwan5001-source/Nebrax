<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * ═══════════════════════════════════════════════════════════════
     *  رقم المعرِّف + الخزينة على سند القبض/الصرف
     * ═══════════════════════════════════════════════════════════════
     *  ــ ١) `reference` — رقم المعرِّف
     *
     *  رقم الحوالة أو إيصال الشبكة أو مرجع البنك. كان لا موضع له، فمن أدخله
     *  دَفَنه في `notes` نصّاً حرّاً لا يُبحَث فيه ولا يُطابَق به كشفُ البنك.
     *  حقلٌ مستقل يجعله قابلاً للاستعلام وللعرض في سند القبض.
     *
     *  ــ ٢) `cash_account_id` — الخزينة
     *
     *  كان الحساب النقدي **مشتقّاً من الطريقة وحدها**: `cash` ⇒ 1110 و`bank`
     *  ⇒ 1120، بلا سبيل لمؤسسةٍ لها خزينتان (خزينة المعرض وخزينة الفرع) أو
     *  حسابان بنكيان أن تقول أيّهما استلم. الحقل **اختياري**: غيابه يُبقي
     *  الاشتقاق القديم حرفياً، فلا سلوكَ قائم يتغيّر — لا في `PosService` ولا
     *  في `PurchaseService` ولا في شاشة «تسجيل دفعة».
     *
     *  ويُقيَّد المقبول منه في `PaymentService`: حسابٌ فرعي (لا تجميعي) من
     *  عائلة النقد والبنوك وحدها. حسابٌ آخر يجعل القيد متوازناً وكاذباً معاً.
     */
    public function up(): void
    {
        Schema::table('payments', function (Blueprint $table) {
            $table->string('reference')->nullable()->after('method');
            $table->foreignUuid('cash_account_id')->nullable()->after('reference')
                ->constrained('accounts')->nullOnDelete();
        });
    }

    public function down(): void
    {
        Schema::table('payments', function (Blueprint $table) {
            $table->dropConstrainedForeignId('cash_account_id');
            $table->dropColumn('reference');
        });
    }
};
