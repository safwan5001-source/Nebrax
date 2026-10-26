<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * تخصيص بصري اختياري لطريقة الدفع (أيقونة Lucide بلون مختار، أو شعار مرفوع). إضافي بحت: كل الأعمدة nullable
     * بلا default ولا backfill؛ `visual_mode = NULL` = «افتراضي» والعرض القديم حرفياً. لا مساس بالتسوية أو الربط المحاسبي.
     * مؤشّر الشعار (path/disk) يتبع نمط صورة الموظف: صريح لا مستنبَط، والقراءة والحذف يتبعانه لا علم البيئة.
     */
    public function up(): void
    {
        Schema::table('payment_methods', function (Blueprint $table) {
            $table->string('visual_mode', 10)->nullable();
            $table->string('icon_key', 32)->nullable();
            $table->string('icon_color', 7)->nullable();
            $table->string('logo_path', 500)->nullable();
            $table->string('logo_disk', 50)->nullable();
        });
    }

    public function down(): void
    {
        Schema::table('payment_methods', function (Blueprint $table) {
            $table->dropColumn(['visual_mode', 'icon_key', 'icon_color', 'logo_path', 'logo_disk']);
        });
    }
};
