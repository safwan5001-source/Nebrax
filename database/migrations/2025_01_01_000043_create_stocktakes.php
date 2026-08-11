<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * ═══════════════════════════════════════════════════════════════
     *  الجرد — عدُّ الواقع ومطابقته بالدفتر
     * ═══════════════════════════════════════════════════════════════
     *  المخزون الدائم يفترض أن الدفتر يعرف كل حركة؛ والجرد هو اللحظة التي
     *  يُسأل فيها الواقعُ نفسه. الفرق (سرقة · تلف غير مسجَّل · خطأ عدّ سابق)
     *  يُرحَّل إلى **5180 فروق الجرد والتلف** — الحساب نفسه الذي تستعمله
     *  الأذون، فيقرأ صافي الفروق بنداً واحداً مهما تعدّدت مصادره.
     *
     *  **الكمية المعدودة تُخزَّن ولا تُشتقّ:** ورقة العدّ حجّةٌ على من عدّ،
     *  فلو حُسب الفرق وحده لضاع الأصل ولَما أمكن مراجعة العدّ بعد الترحيل.
     *  ويُخزَّن معها `system_quantity` **لحظة الالتقاط** لا وقت الترحيل، وإلا
     *  اختلف الفرق عمّا رآه العادّ إن تحرّك المخزون بينهما.
     */
    public function up(): void
    {
        Schema::create('stocktakes', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('branch_id')->nullable()->constrained('branches')->nullOnDelete();

            $table->string('number');                                   // STK-2026-00001
            $table->foreignUuid('warehouse_id')->constrained('warehouses')->restrictOnDelete();
            $table->date('stocktake_date');

            // draft: يُعدّ ويُعدَّل · posted: رُحِّل الفرق فصار حجّة
            $table->enum('status', ['draft', 'posted'])->default('draft');
            $table->string('notes')->nullable();

            // صافي الفرق بالهللات: موجبٌ زيادة وسالبٌ عجز.
            $table->bigInteger('difference_value')->default(0);

            $table->foreignUuid('journal_entry_id')->nullable()
                ->constrained('journal_entries')->nullOnDelete();
            $table->foreignUuid('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();

            $table->unique(['tenant_id', 'number']);
            $table->index(['tenant_id', 'status']);
            $table->index(['tenant_id', 'warehouse_id']);
        });

        Schema::create('stocktake_lines', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('stocktake_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('product_id')->constrained('products')->restrictOnDelete();

            $table->integer('system_quantity');                         // ما يقوله الدفتر لحظة الالتقاط
            $table->integer('counted_quantity')->nullable();            // ما عدّه العادّ (null = لم يُعدّ بعد)
            $table->bigInteger('unit_cost')->default(0);                // متوسط التكلفة لحظة الترحيل
            $table->bigInteger('difference_value')->default(0);         // (معدود − دفتري) × التكلفة
            $table->timestamps();

            $table->unique(['stocktake_id', 'product_id']);
            $table->index(['tenant_id', 'stocktake_id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('stocktake_lines');
        Schema::dropIfExists('stocktakes');
    }
};
