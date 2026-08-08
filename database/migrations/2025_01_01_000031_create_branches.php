<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // ═══════════════════════════════════════════════════════
        // الفروع (Branches) — بنية تنظيمية داخل المؤسسة، لا حاجز عزل.
        // العزل يبقى بالمستأجر (TenantScope)؛ الفرع بُعد تصفية اختياري
        // (كمراكز التكلفة) يُوسم به لاحقاً المستندات وسطور القيد.
        // بيانات رئيسية — لا أثر محاسبي.
        // ═══════════════════════════════════════════════════════
        Schema::create('branches', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->string('code');                              // تسلسلي تلقائي: 00001
            $table->string('name');
            $table->string('phone')->nullable();
            $table->string('mobile')->nullable();
            $table->string('address_line1')->nullable();
            $table->string('address_line2')->nullable();
            $table->string('city')->nullable();
            $table->string('region')->nullable();
            $table->string('country')->nullable();
            $table->text('description')->nullable();
            $table->text('working_hours')->nullable();
            // إحداثيات الموقع — ليست مبالغ مالية، فالعدد العشري مناسب هنا.
            $table->decimal('latitude', 10, 7)->nullable();
            $table->decimal('longitude', 10, 7)->nullable();
            $table->boolean('is_active')->default(true);
            $table->timestamps();

            $table->unique(['tenant_id', 'code']);
            $table->index(['tenant_id', 'is_active']);
        });

        // تخصيص الحسابات على مستوى الفروع: حساب ↔ فرع (متعدّد لمتعدّد).
        // غياب أي صفّ لحسابٍ = الحساب متاح لجميع الفروع (السلوك الافتراضي).
        Schema::create('account_branch', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('account_id')->constrained('accounts')->cascadeOnDelete();
            $table->foreignUuid('branch_id')->constrained('branches')->cascadeOnDelete();
            $table->timestamps();

            $table->unique(['account_id', 'branch_id']);
            $table->index(['tenant_id', 'branch_id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('account_branch');
        Schema::dropIfExists('branches');
    }
};
