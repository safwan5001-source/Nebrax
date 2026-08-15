<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * لقطة اختيار قالب الفاتورة عند الترحيل: null للمسوّدات والبيانات السابقة،
 * ومراجعة منشورة ثابتة للفواتير التي تصدر بعد تفعيل نظام القوالب.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('invoices', function (Blueprint $table) {
            $table->foreignUuid('print_template_revision_id')->nullable()
                ->after('zatca_xml')
                ->constrained('print_template_revisions')->nullOnDelete();
        });
    }

    public function down(): void
    {
        Schema::table('invoices', function (Blueprint $table) {
            $table->dropConstrainedForeignId('print_template_revision_id');
        });
    }
};
