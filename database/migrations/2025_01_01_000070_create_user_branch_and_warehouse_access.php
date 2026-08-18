<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * ═══════════════════════════════════════════════════════════════
 *  نطاق وصول المستخدم: فروعه ومستودعاته
 * ═══════════════════════════════════════════════════════════════
 *  حتى اليوم كان كل مستخدم في المستأجر يعمل في **أي فرع** ويتعامل مع **أي
 *  مستودع** — الصلاحيات بالدور تحكم *ماذا* يفعل لا *أين*. هذان الجدولان
 *  يضيفان بُعد «أين».
 *
 *  ═══ القاعدة الحاكمة: الفراغ يعني الكلّ ═══
 *
 *  مستخدمٌ بلا صفوف هنا يصل إلى كل الفروع والمستودعات — وهو سلوك اليوم
 *  حرفياً. فالترقية لا تُقيّد أحداً، ولا يحتاج مستأجرٌ قائم إلى أي إجراء
 *  ليواصل عمله. التقييد **فعلٌ صريح** بإسناد فرع أو مستودع.
 *
 *  ولذلك لا يحمل الجدولان بيانات أولية: خلوّهما هو الحالة الافتراضية
 *  الصحيحة، لا نقصٌ يُملأ.
 */
return new class extends Migration
{
    public function up(): void
    {
        // جدولا ربطٍ بمفتاح مركّب بلا عمود `id`: الإسناد **علاقةٌ لا كيان**،
        // فلا معرّف له ولا تتكرّر. (والمفتاح الاصطناعي هنا كان سيتطلّب توليد
        // UUID يدوياً في كل `sync` — و`sync` لا يفعل.)
        Schema::create('branch_user', function (Blueprint $table) {
            $table->foreignUuid('user_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('branch_id')->constrained()->cascadeOnDelete();
            $table->timestamps();

            $table->primary(['user_id', 'branch_id']);
            $table->index('branch_id');
        });

        Schema::create('user_warehouse', function (Blueprint $table) {
            $table->foreignUuid('user_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('warehouse_id')->constrained()->cascadeOnDelete();
            $table->timestamps();

            $table->primary(['user_id', 'warehouse_id']);
            $table->index('warehouse_id');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('user_warehouse');
        Schema::dropIfExists('branch_user');
    }
};
