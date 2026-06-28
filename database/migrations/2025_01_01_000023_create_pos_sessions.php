<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // جلسات نقطة البيع (الورديات) — سجلّ تشغيلي لمطابقة النقدية.
        // غير محاسبي: لا يولّد قيوداً (البيع نفسه يُرحَّل عبر InvoiceService).
        // المبالغ بالـ minor units (هللات) كـ bigint.
        Schema::create('pos_sessions', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->string('number');                          // POS-2025-00001
            $table->enum('status', ['open', 'closed'])->default('open');
            $table->bigInteger('opening_balance')->default(0);  // النقدية الافتتاحية
            $table->bigInteger('closing_balance')->nullable();  // المعدود عند الإغلاق
            $table->bigInteger('expected_balance')->nullable(); // المتوقع = افتتاحي + مبيعات نقدية
            $table->bigInteger('difference')->nullable();       // معدود − متوقع
            $table->dateTime('opened_at');
            $table->dateTime('closed_at')->nullable();
            $table->string('notes')->nullable();
            $table->foreignUuid('opened_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();

            $table->unique(['tenant_id', 'number']);
            $table->index(['tenant_id', 'status']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('pos_sessions');
    }
};
