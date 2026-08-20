<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * توزيع تحليلي لخط فاتورة على أكثر من مركز تكلفة.
     * المبلغ بالهللات، والنسبة بوحدة نقطة أساس (10000 = 100.00%) لتفادي float.
     */
    public function up(): void
    {
        Schema::create('invoice_line_cost_center_allocations', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('branch_id')->nullable()->constrained('branches')->nullOnDelete();
            $table->foreignUuid('invoice_line_id')->constrained('invoice_lines')->cascadeOnDelete();
            $table->foreignUuid('cost_center_id')->constrained('cost_centers')->restrictOnDelete();
            $table->string('mode', 10); // percent | amount — يحفظ نية الإدخال للمسودة
            $table->unsignedSmallInteger('position'); // صاحب الباقي عند القسمة الصحيحة
            $table->unsignedInteger('basis_points');
            $table->unsignedBigInteger('amount');
            $table->timestamps();

            $table->unique(['invoice_line_id', 'cost_center_id'], 'invoice_line_cost_center_unique');
            $table->index(['tenant_id', 'cost_center_id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('invoice_line_cost_center_allocations');
    }
};
