<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * IMP-H1-S3c — خطّة المعاينة المجمَّدة (رقم الصف → ما سيُنفَّذ) تُحفَظ مضغوطةً في سجلّ المعاينة ثم تُنسَخ إلى التشغيلة عند إنفاقها،
 * فيقارنها التنفيذ بالواقع (`plan_drift`). عمودان nullable بلا Backfill: التشغيلات والمعاينات القائمة بلا خطّة = بلا مقارنة (العقد القديم).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('import_previews', function (Blueprint $table) {
            $table->longText('plan')->nullable()->after('options');
        });
        Schema::table('import_jobs', function (Blueprint $table) {
            $table->longText('apply_plan')->nullable()->after('apply_options');
        });
    }

    public function down(): void
    {
        Schema::table('import_jobs', function (Blueprint $table) {
            $table->dropColumn('apply_plan');
        });
        Schema::table('import_previews', function (Blueprint $table) {
            $table->dropColumn('plan');
        });
    }
};
