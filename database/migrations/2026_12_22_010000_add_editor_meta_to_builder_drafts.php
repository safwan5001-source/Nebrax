<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * AD-05 (S20a) — بيانات المحرر المستقلة عن المخطط: اسم القسم، إخفاؤه، نوعه الجاهز (preset)، عناوين الصفحات.
 *
 * عمود إضافي `nullable` على المسودة وحدها: **لا يدخل النسخة المنشورة ولا جلسات المعاينة** (يُسقَط الإخفاء منها بالإسقاط
 * `EditorMeta::project`)، ويُحفظ بالقفل التفاؤلي نفسه (معاملة الحفظ ذاتها). null = لا بيانات (كل المسودات القائمة).
 * التراجع آمن: العمود إضافي ولا يكتبه سوى مسار الحفظ.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('builder_draft_experiences', function (Blueprint $table) {
            $table->json('editor_meta')->nullable()->after('schema');
        });
    }

    public function down(): void
    {
        Schema::table('builder_draft_experiences', function (Blueprint $table) {
            $table->dropColumn('editor_meta');
        });
    }
};
