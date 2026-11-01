<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * AD-09 / S08a — فهرس يدعم مجمّع ترتيب `popularity` (مراجعة Codex): الاستعلام الفرعي المرتبط يبحث في `invoice_lines`
 * بـ(tenant_id, product_id) لكل منتج مرشّح، ولا فهرس سابق يغطيه (الموجود: tenant_id + invoice_id). إضافي بحت؛ لا يغيّر بيانات.
 * `down()` يسقط الفهرس وحده.
 */
return new class extends Migration
{
    private const INDEX = 'invoice_lines_tenant_product_idx';

    public function up(): void
    {
        Schema::table('invoice_lines', function (Blueprint $table) {
            $table->index(['tenant_id', 'product_id'], self::INDEX);
        });
    }

    public function down(): void
    {
        Schema::table('invoice_lines', function (Blueprint $table) {
            $table->dropIndex(self::INDEX);
        });
    }
};
