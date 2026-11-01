<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * AD-06 / S05d (DRF-08) — أرشفة التطبيق (soft) بدل الحذف: العمود `nullable` فلا يتغير أي صف قائم (null = نشط).
 * النسخ المنشورة تبقى محفوظة (ثابتة)؛ التطبيق المؤرشف لا يُخدَم ولا يُنشر ولا يُحرَّر، ولا يُؤرشف الحيّ.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('builder_apps', function (Blueprint $table) {
            $table->timestamp('archived_at')->nullable()->after('created_by');
        });
    }

    public function down(): void
    {
        Schema::table('builder_apps', function (Blueprint $table) {
            $table->dropColumn('archived_at');
        });
    }
};
