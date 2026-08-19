<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * لقطة مراجعة الطباعة الحرارية مستقلة عن لقطة الطباعة القياسية وPDF. تمتد
 * إلى الإشعارات الدائنة/المدينة وفواتير المشتريات بعدما أعلن سجل المستندات
 * دعم ورق 58 و80 مم لها. تبقى القيمة null للسجلات القديمة والمسودات، فلا
 * يتغير إخراج تاريخي أو يُحل تعيين حراري حيّ عند طباعته.
 */
return new class extends Migration
{
    private const TABLES = ['credit_notes', 'purchases'];

    public function up(): void
    {
        foreach (self::TABLES as $name) {
            Schema::table($name, function (Blueprint $table) {
                $table->foreignUuid('thermal_template_revision_id')->nullable()
                    ->after('pdf_template_revision_id')
                    ->constrained('print_template_revisions')->nullOnDelete();
            });
        }
    }

    public function down(): void
    {
        foreach (self::TABLES as $name) {
            Schema::table($name, function (Blueprint $table) {
                $table->dropConstrainedForeignId('thermal_template_revision_id');
            });
        }
    }
};
