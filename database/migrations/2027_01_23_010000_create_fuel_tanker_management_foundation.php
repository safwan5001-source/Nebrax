<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * TANKER-PR1 — أساس «إدارة أصحاب الصهاريج»: بيانات رئيسية فقط (إضافية بالكامل، لا تعديل لأي جدول قائم، لا Backfill).
 *
 *  - `fuel_tanker_owners`: ملف صاحب الصهريج المستقل (CompanyWide). **ليس** `Partner` ولا يُنشئ طرفاً: ربط `partner_id` اختياري ومؤجَّل
 *    لقرار دفع المستحقات (D-T5). لا حقول عمولة/تسعير/رصيد هنا عمداً — قراراتها المحاسبية مفتوحة وتأتي بهجرات لاحقة.
 *  - `fuel_tankers`: الصهريج/المركبة التابع لصاحب صهريج. `plate_key` = لوحة مطبَّعة (تُحسب في الخدمة) لمنع التكرار باختلاف المسافات/الأحرف/الأرقام.
 *  - `fuel_tanker_owner_company_links`: ربط شركة (Partner عميل) بصاحب صهريج **مؤرَّخاً** (valid_from..valid_to). لا حذف ولا إعادة كتابة: الإنهاء بتاريخ
 *    فقط، فلا يُعاد نسب أي عملية تاريخية تلقائياً (متطلب سيناريو 12).
 *
 * لا أثر مالي أو مخزني: لا قيد ولا حركة مخزون ولا فاتورة ولا قبض. الميزة خلف بوابة `fuel_stations.tanker_management_enabled` (مغلقة افتراضياً).
 * التراجع يرفض متى وُجد أي صف في أي من الجداول الثلاثة.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('fuel_tanker_owners', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->string('code', 64)->nullable();
            $table->string('name');
            $table->string('phone', 50)->nullable();
            $table->text('notes')->nullable();
            $table->string('status', 16)->default('active');
            // ربط اختياري بطرف أَوْج (مؤجَّل: يُنشأ/يُربط عند الحاجة لدفع المستحقات — D-T5). لا يُملأ في هذه الشريحة.
            $table->foreignUuid('partner_id')->nullable()->constrained('partners')->restrictOnDelete();
            $table->foreignUuid('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();

            $table->unique(['tenant_id', 'code'], 'fuel_tanker_owner_code_unique');
            $table->index(['tenant_id', 'status']);
        });

        Schema::create('fuel_tankers', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('fuel_tanker_owner_id')->constrained('fuel_tanker_owners')->restrictOnDelete();
            $table->string('plate_number', 64);
            $table->string('plate_key', 64);
            $table->string('plate_country', 8)->nullable();
            $table->unsignedBigInteger('capacity_milliliters')->nullable();
            $table->text('notes')->nullable();
            $table->string('status', 16)->default('active');
            $table->foreignUuid('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();

            $table->unique(['tenant_id', 'plate_key'], 'fuel_tanker_plate_unique');
            $table->index(['tenant_id', 'fuel_tanker_owner_id', 'status'], 'fuel_tanker_owner_status_idx');
        });

        Schema::create('fuel_tanker_owner_company_links', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('fuel_tanker_owner_id')->constrained('fuel_tanker_owners')->restrictOnDelete();
            $table->foreignUuid('partner_id')->constrained('partners')->restrictOnDelete();
            $table->date('valid_from');
            $table->date('valid_to')->nullable();
            $table->text('note')->nullable();
            $table->text('end_reason')->nullable();
            $table->foreignUuid('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->foreignUuid('ended_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamp('ended_at')->nullable();
            $table->timestamps();

            // لا ربطان بالبداية نفسها لزوج (صاحب صهريج، شركة)؛ التداخل العام تفحصه الخدمة تحت قفل صف صاحب الصهريج.
            $table->unique(['fuel_tanker_owner_id', 'partner_id', 'valid_from'], 'fuel_tanker_link_start_unique');
            $table->index(['tenant_id', 'partner_id'], 'fuel_tanker_link_partner_idx');
        });
    }

    public function down(): void
    {
        foreach (['fuel_tanker_owner_company_links', 'fuel_tankers', 'fuel_tanker_owners'] as $table) {
            if (Schema::hasTable($table) && DB::table($table)->exists()) {
                throw new RuntimeException("Rollback refused: {$table} contains tanker-management data.");
            }
        }

        Schema::dropIfExists('fuel_tanker_owner_company_links');
        Schema::dropIfExists('fuel_tankers');
        Schema::dropIfExists('fuel_tanker_owners');
    }
};
