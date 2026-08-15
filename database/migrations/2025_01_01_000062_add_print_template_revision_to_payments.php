<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * لقطة مراجعة قالب السند عند الترحيل.
 *
 * تبقى المسودات والسجلات السابقة بقيمة null، بينما يحمل كل سند يُرحّل بعد
 * تفعيل المنصة مراجعة منشورة ثابتة لا تتغير عند تعديل القالب أو تعيينه لاحقاً.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('payments', function (Blueprint $table) {
            $table->foreignUuid('print_template_revision_id')->nullable()
                ->after('journal_entry_id')
                ->constrained('print_template_revisions')->nullOnDelete();
        });
    }

    public function down(): void
    {
        Schema::table('payments', function (Blueprint $table) {
            $table->dropConstrainedForeignId('print_template_revision_id');
        });
    }
};
