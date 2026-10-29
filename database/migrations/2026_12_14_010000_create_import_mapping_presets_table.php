<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * IMP-H8-S2a — مطابقات أعمدة محفوظة لمعالجات الاستيراد (مشتركة على مستوى المؤسسة، لكل مجال). **إضافية فقط**: لا تعديل لأي جدول قائم ولا Backfill.
 *
 * المطابقة تُحفظ بـ**نصّ عنوان العمود** لا بفهرسه (فهرس العمود يتغيّر بين ملفين لنفس المورّد)، مع المفتاح المطبَّع (`ImportHeaderMatcher::normalize`) الذي
 * يجري عليه التطابق عند الاستعمال. الاسم فريد لكل (مؤسسة، مجال) بمفتاحه المطبَّع. لا سياسات تشغيل في الإعداد المحفوظ: تلك قرارات عملٍ لكل تشغيلة
 * (القاعدة 6) ولا تُفرض بصمتٍ من ملف محفوظ. `down()` يرفض متى وُجد صف (إصلاح إلى الأمام فقط).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('import_mapping_presets', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->string('domain', 40);
            $table->string('name', 80);
            $table->string('name_key', 80);
            // قائمة {header, header_key, field|null} بترتيب أعمدة الملف المحفوظ منه.
            $table->json('columns');
            $table->foreignUuid('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();

            $table->unique(['tenant_id', 'domain', 'name_key'], 'import_mapping_presets_name_unique');
            $table->index(['tenant_id', 'domain'], 'import_mapping_presets_domain_index');
        });
    }

    public function down(): void
    {
        if (Schema::hasTable('import_mapping_presets') && \Illuminate\Support\Facades\DB::table('import_mapping_presets')->exists()) {
            throw new RuntimeException('Rollback refused: import_mapping_presets contains rows. Fix forward instead.');
        }
        Schema::dropIfExists('import_mapping_presets');
    }
};
