<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * جوال المالك + جعل البريد فريداً عالمياً (الدخول بالبريد وحده).
 * هجرة منفصلة كي تُطبَّق على القواعد الحيّة التي رُحّلت بنسخة 000001 القديمة
 * (لا يُعاد تشغيل هجرة سبق تنفيذها). مكتوبة بحراسة كي تعمل على fresh أيضاً.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('users', function (Blueprint $table) {
            if (! Schema::hasColumn('users', 'phone')) {
                $table->string('phone')->nullable()->after('email');
            }
        });

        // تحويل قيد البريد من (tenant_id, email) إلى (email) عالمياً.
        Schema::table('users', function (Blueprint $table) {
            try {
                $table->dropUnique('users_tenant_id_email_unique');
            } catch (\Throwable $e) {
                // القيد المركّب غير موجود (قاعدة أُنشئت بالفعل بالقيد العالمي) — نتجاهل
            }
        });

        Schema::table('users', function (Blueprint $table) {
            try {
                $table->unique('email');
            } catch (\Throwable $e) {
                // القيد العالمي موجود مسبقاً — نتجاهل
            }
        });
    }

    public function down(): void
    {
        Schema::table('users', function (Blueprint $table) {
            try {
                $table->dropUnique('users_email_unique');
            } catch (\Throwable $e) {
            }
            $table->unique(['tenant_id', 'email']);
            if (Schema::hasColumn('users', 'phone')) {
                $table->dropColumn('phone');
            }
        });
    }
};
