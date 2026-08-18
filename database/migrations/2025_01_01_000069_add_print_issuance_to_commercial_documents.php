<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * يثبت إجراء «إصدار للطباعة» مراجع القوالب المنشورة على المستند التجاري نفسه.
 * لا يفسر مستند صادر تعييناً حياً لاحقاً، وتربط نسخة العمل الجديدة بالمستند
 * الصادر الذي انطلقت منه من دون إعادة كتابة السجل التاريخي.
 */
return new class extends Migration
{
    private const TABLES = ['quotes', 'procurement_documents'];

    public function up(): void
    {
        foreach (self::TABLES as $name) {
            Schema::table($name, function (Blueprint $table) use ($name) {
                $table->timestamp('print_issued_at')->nullable();
                $table->foreignUuid('print_template_revision_id')->nullable()
                    ->constrained('print_template_revisions')->nullOnDelete();
                $table->foreignUuid('pdf_template_revision_id')->nullable()
                    ->constrained('print_template_revisions')->nullOnDelete();
                $table->foreignUuid('thermal_template_revision_id')->nullable()
                    ->constrained('print_template_revisions')->nullOnDelete();
                $table->foreignUuid('revised_from_id')->nullable()
                    ->constrained($name)->nullOnDelete();
            });
        }
    }

    public function down(): void
    {
        foreach (self::TABLES as $name) {
            Schema::table($name, function (Blueprint $table) {
                $table->dropConstrainedForeignId('revised_from_id');
                $table->dropConstrainedForeignId('thermal_template_revision_id');
                $table->dropConstrainedForeignId('pdf_template_revision_id');
                $table->dropConstrainedForeignId('print_template_revision_id');
                $table->dropColumn('print_issued_at');
            });
        }
    }
};
