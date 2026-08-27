<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * قراءة مساحة عمل دليل الحسابات ترتب البنية المشتركة بالمستأجر ثم الأب ثم
     * الكود. الفهرس يمنع مسحاً كاملاً واضحاً حين يتسع الدليل إلى آلاف الحسابات.
     */
    public function up(): void
    {
        Schema::table('accounts', function (Blueprint $table) {
            $table->index(['tenant_id', 'parent_id', 'code'], 'accounts_tenant_parent_code_index');
        });
    }

    public function down(): void
    {
        Schema::table('accounts', function (Blueprint $table) {
            $table->dropIndex('accounts_tenant_parent_code_index');
        });
    }
};
