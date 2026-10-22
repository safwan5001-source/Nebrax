<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * IMP-H1-S3c — خطّة المعاينة المجمَّدة (رقم الصف → ما سيُنفَّذ) تُحفَظ مضغوطةً في سجلّ المعاينة، ويقارنها التنفيذ بالواقع (`plan_drift`).
 * التشغيلة تقرؤها من سجلّ معاينتها وقت القطعة (لا تُنسَخ إلى `import_jobs`: عمودٌ ضخم كان سيُحمَّل مع كل قراءة للتشغيلة).
 * عمودٌ nullable بلا Backfill: المعاينات القائمة بلا خطّة = بلا مقارنة (العقد القديم).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('import_previews', function (Blueprint $table) {
            $table->longText('plan')->nullable()->after('options');
        });
    }

    public function down(): void
    {
        Schema::table('import_previews', function (Blueprint $table) {
            $table->dropColumn('plan');
        });
    }
};
