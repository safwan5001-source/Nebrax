<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // ═══════════════════════════════════════════════════════
        // مراكز التكلفة (Cost Centers) — بُعد تحليلي يُوسم به سطر القيد
        // (قسم/فرع/مشروع) لتقارير الربحية. بيانات رئيسية لا مستند مالي.
        // ═══════════════════════════════════════════════════════
        Schema::create('cost_centers', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->string('code');
            $table->string('name');
            $table->boolean('is_active')->default(true);
            $table->timestamps();

            $table->unique(['tenant_id', 'code']);
            $table->index(['tenant_id', 'is_active']);
        });

        // وسم اختياري لسطر القيد بمركز التكلفة (إضافة غير كاسرة — القيم الحالية null).
        Schema::table('journal_lines', function (Blueprint $table) {
            $table->foreignUuid('cost_center_id')->nullable()->after('partner_id')
                ->constrained('cost_centers')->nullOnDelete();
            $table->index(['tenant_id', 'cost_center_id']);
        });
    }

    public function down(): void
    {
        Schema::table('journal_lines', function (Blueprint $table) {
            $table->dropConstrainedForeignId('cost_center_id');
        });
        Schema::dropIfExists('cost_centers');
    }
};
