<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * PR-DUR-2 — إضافة أعمدة تقدّم الترحيل الدائم لـ`import_jobs` فقط. إضافية بحتة،
 * لا تعدّل عموداً موجوداً ولا تمسّ أي جدول آخر. `row_count`/`error_message`/
 * `started_at`/`finished_at` الحاليّة تُعاد استعمالها كما هي (إجمالي الصفوف،
 * سبب الفشل، بداية/نهاية الترحيل) فلا تكرار.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('import_jobs', function (Blueprint $table) {
            $table->unsignedInteger('processed_rows')->default(0)->after('row_count');
            $table->json('apply_options')->nullable()->after('processed_rows');
            $table->json('apply_result')->nullable()->after('apply_options');
        });
    }

    public function down(): void
    {
        Schema::table('import_jobs', function (Blueprint $table) {
            $table->dropColumn(['processed_rows', 'apply_options', 'apply_result']);
        });
    }
};
