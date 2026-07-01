<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // ═══════════════════════════════════════════════════════
        // الأصول الثابتة (Fixed Assets) — اقتناء + إهلاك بالقسط الثابت.
        // الاقتناء يُرحَّل بقيد:
        //   مدين 12xx حساب الأصل + مدين 1150 ضريبة المدخلات
        //   دائن 1110/1120/2110 (الإجمالي)
        // كل إهلاك دوري يُرحَّل بقيد:
        //   مدين 5160 مصروف الإهلاك / دائن 1230 مجمع الإهلاك
        // كل المبالغ بالـ minor units (هللات) كـ bigint.
        // ═══════════════════════════════════════════════════════
        Schema::create('assets', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->string('number');                                   // FA-2025-00001
            $table->string('name');
            $table->foreignUuid('account_id')->constrained('accounts')->restrictOnDelete(); // حساب الأصل (12xx)
            $table->foreignUuid('partner_id')->nullable()->constrained('partners')->nullOnDelete(); // المورّد
            $table->date('acquisition_date');
            $table->enum('payment_method', ['cash', 'bank', 'credit'])->default('cash');
            $table->bigInteger('cost')->default(0);                     // تكلفة الاقتناء (قبل الضريبة)
            $table->unsignedSmallInteger('tax_rate')->default(15);
            $table->bigInteger('tax_amount')->default(0);
            $table->bigInteger('total')->default(0);
            $table->bigInteger('salvage_value')->default(0);            // القيمة التخريدية
            $table->unsignedInteger('useful_life_months')->default(60); // العمر الإنتاجي بالأشهر
            $table->bigInteger('accumulated_depreciation')->default(0); // مجمع الإهلاك المتراكم
            $table->enum('status', ['draft', 'active', 'disposed'])->default('draft');
            $table->foreignUuid('acquisition_entry_id')->nullable()->constrained('journal_entries')->nullOnDelete();
            $table->foreignUuid('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();

            $table->unique(['tenant_id', 'number']);
            $table->index(['tenant_id', 'status']);
            $table->index(['tenant_id', 'account_id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('assets');
    }
};
