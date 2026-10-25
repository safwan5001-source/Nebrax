<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * PAY-SETTINGS-UX-2 — إعدادات «إدارة» وسيلة الدفع الإلكتروني: بوابة افتراضية وأماكن الاستخدام. **إضافي فقط**، لا أثر محاسبي.
 *
 * - `default_gateway_id`: اتصال بوابة اختاره التاجر للوسيلة (nullable ⇒ أول اتصال جاهز كما كان). `nullOnDelete`: حذف الاتصال يعيد الوسيلة للسلوك التلقائي. لا تحويل تلقائي بين البوابات.
 * - `use_in_invoices` / `use_in_store`: أين تُعرض الوسيلة (روابط دفع الفواتير / متجر الويب). POS غير مدعوم بالتكامل فلا عمود له عمداً.
 * - الصفوف **القائمة** قبل هذه الهجرة لم يكن المتجر ضمن استعمالها ⇒ `use_in_store = false` لها (لا تغيير صامت في سلوك مستأجر قائم)؛ الصفوف الجديدة تبدأ `true`.
 * - `online_payment_method_setting_events.changes`: لقطة JSON لتغيّر غير `enabled` (بوابة/استعمال) في سجل التدقيق الثابت.
 * `down()` يرفض متى وُجدت صفوف إعدادات (إصلاح إلى الأمام).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('online_payment_method_settings', function (Blueprint $table) {
            $table->foreignUuid('default_gateway_id')->nullable()->after('enabled')->constrained('payment_gateways')->nullOnDelete();
            $table->boolean('use_in_invoices')->default(true)->after('default_gateway_id');
            $table->boolean('use_in_store')->default(true)->after('use_in_invoices');
        });
        DB::table('online_payment_method_settings')->update(['use_in_store' => false]);

        Schema::table('online_payment_method_setting_events', function (Blueprint $table) {
            $table->text('changes')->nullable()->after('reason');
        });
    }

    public function down(): void
    {
        if (Schema::hasTable('online_payment_method_settings') && DB::table('online_payment_method_settings')->exists()) {
            throw new RuntimeException('Rollback refused: online_payment_method_settings contains rows. Fix forward instead.');
        }
        Schema::table('online_payment_method_setting_events', function (Blueprint $table) {
            $table->dropColumn('changes');
        });
        Schema::table('online_payment_method_settings', function (Blueprint $table) {
            $table->dropConstrainedForeignId('default_gateway_id');
            $table->dropColumn(['use_in_invoices', 'use_in_store']);
        });
    }
};
