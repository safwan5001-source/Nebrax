<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // ═══════════════════════════════════════════════════════
        // دليل الحسابات (Chart of Accounts) — شجري
        // ═══════════════════════════════════════════════════════
        Schema::create('accounts', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('parent_id')->nullable()->constrained('accounts')->nullOnDelete();
            $table->string('code');                        // رقم الحساب (1010, 4010 ...)
            $table->string('name');                        // الاسم العربي
            $table->string('name_en')->nullable();
            // النوع الأساسي يحدد الطبيعة المدينة/الدائنة
            $table->enum('type', [
                'asset',       // أصول       (طبيعة مدينة)
                'liability',   // خصوم       (طبيعة دائنة)
                'equity',      // حقوق ملكية (طبيعة دائنة)
                'revenue',     // إيرادات    (طبيعة دائنة)
                'expense',     // مصروفات    (طبيعة مدينة)
            ]);
            $table->enum('normal_balance', ['debit', 'credit']); // الطبيعة
            $table->boolean('is_group')->default(false);   // حساب تجميعي (لا يقبل قيوداً مباشرة)
            $table->boolean('is_system')->default(false);  // حساب نظام (لا يُحذف)
            $table->string('currency', 3)->default('SAR');
            $table->boolean('is_active')->default(true);
            $table->timestamps();

            $table->unique(['tenant_id', 'code']);
            $table->index(['tenant_id', 'type']);
        });

        // ═══════════════════════════════════════════════════════
        // القيود اليومية (Journal Entries) — رأس القيد
        // immutable بعد الترحيل
        // ═══════════════════════════════════════════════════════
        Schema::create('journal_entries', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->string('number');                      // رقم القيد التسلسلي (JE-2025-00001)
            $table->date('entry_date');                    // تاريخ القيد
            $table->string('description')->nullable();
            $table->enum('status', ['draft', 'posted', 'reversed'])->default('draft');
            // المصدر الذي ولّد القيد (polymorphic): فاتورة، دفعة، مشترى...
            $table->string('source_type')->nullable();
            $table->uuid('source_id')->nullable();
            $table->foreignUuid('reversal_of')->nullable()->constrained('journal_entries')->nullOnDelete();
            $table->foreignUuid('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamp('posted_at')->nullable();
            $table->timestamps();

            $table->unique(['tenant_id', 'number']);
            $table->index(['tenant_id', 'entry_date']);
            $table->index(['source_type', 'source_id']);
        });

        // ═══════════════════════════════════════════════════════
        // سطور القيد (Journal Lines) — التفاصيل المدينة/الدائنة
        // المبالغ بالـ minor units (هللات) كـ bigint
        // ═══════════════════════════════════════════════════════
        Schema::create('journal_lines', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('journal_entry_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('account_id')->constrained('accounts')->restrictOnDelete();
            $table->bigInteger('debit')->default(0);       // مدين (هللات)
            $table->bigInteger('credit')->default(0);      // دائن (هللات)
            $table->string('description')->nullable();
            // ربط اختياري بطرف (عميل/مورد) لكشوف الحساب
            $table->string('partner_type')->nullable();
            $table->uuid('partner_id')->nullable();
            $table->timestamps();

            $table->index(['tenant_id', 'account_id']);
            $table->index(['partner_type', 'partner_id']);
        });

        // ═══════════════════════════════════════════════════════
        // لقطات أرصدة الحسابات (للأداء — تُحدّث عند الترحيل)
        // ═══════════════════════════════════════════════════════
        Schema::create('account_balances', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('account_id')->constrained()->cascadeOnDelete();
            $table->bigInteger('balance')->default(0);     // الرصيد الجاري (موجب = حسب الطبيعة)
            $table->bigInteger('total_debit')->default(0);
            $table->bigInteger('total_credit')->default(0);
            $table->timestamps();

            $table->unique(['tenant_id', 'account_id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('account_balances');
        Schema::dropIfExists('journal_lines');
        Schema::dropIfExists('journal_entries');
        Schema::dropIfExists('accounts');
    }
};
