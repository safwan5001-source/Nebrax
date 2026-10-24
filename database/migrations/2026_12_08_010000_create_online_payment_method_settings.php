<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * AWJ-PAYMENTS-HZ-01 / PAY-SETTINGS-UX — إعداد **إظهار** وسائل الدفع الإلكتروني للعميل (mada/Visa/Mastercard/Apple Pay). **إضافي فقط**، لا أثر محاسبي.
 *
 * - `online_payment_method_settings`: صف لكل (مستأجر، وسيلة) — `enabled` افتراضياً `false`؛ غياب الصف = غير مفعَّلة. لا بوابة افتراضية مخزَّنة: لا توجيه متعدد البوابات اليوم (H2-04).
 * - `online_payment_method_setting_events`: تدقيق ثابت (append-only): الفاعل والقيمتان والسبب.
 * `down()` يرفض متى وُجدت صفوف (إصلاح إلى الأمام).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('online_payment_method_settings', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->string('method_key', 24);
            $table->boolean('enabled')->default(false);
            $table->foreignUuid('updated_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();

            $table->unique(['tenant_id', 'method_key'], 'opms_tenant_method_unique');
        });

        Schema::create('online_payment_method_setting_events', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->string('method_key', 24);
            $table->boolean('enabled_from')->nullable();
            $table->boolean('enabled_to');
            $table->foreignUuid('actor_id')->nullable()->constrained('users')->nullOnDelete();
            $table->text('reason')->nullable();
            $table->timestamp('created_at')->nullable();

            $table->index(['tenant_id', 'method_key', 'created_at'], 'opmse_tenant_method_idx');
        });

        if (DB::connection()->getDriverName() === 'pgsql') {
            DB::statement("ALTER TABLE online_payment_method_settings ADD CONSTRAINT opms_method_known CHECK (method_key IN ('mada', 'visa', 'mastercard', 'apple_pay'))");
            DB::statement("ALTER TABLE online_payment_method_setting_events ADD CONSTRAINT opmse_method_known CHECK (method_key IN ('mada', 'visa', 'mastercard', 'apple_pay'))");
        }
    }

    public function down(): void
    {
        foreach (['online_payment_method_setting_events', 'online_payment_method_settings'] as $table) {
            if (Schema::hasTable($table) && DB::table($table)->exists()) {
                throw new RuntimeException("Rollback refused: {$table} contains rows. Fix forward instead.");
            }
        }
        Schema::dropIfExists('online_payment_method_setting_events');
        Schema::dropIfExists('online_payment_method_settings');
    }
};
