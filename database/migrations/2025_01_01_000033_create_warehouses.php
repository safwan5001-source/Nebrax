<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // ═══════════════════════════════════════════════════════
        // المخازن (Warehouses) — تحمل **الكميات** لكل موقع، ويتبع المخزن فرعاً
        // (أو لا فرع = مخزن مركزي). هذا ما يحقّق «توافر المخزون في كل فرع».
        //
        // **التقييم يبقى عالمياً للمنتج** (products.avg_cost): متوسط متحرك واحد
        // للمنشأة، فلا يتغيّر محرّك التكلفة ولا قيد تكلفة البضاعة المباعة ولا
        // رصيد 1140. الكميات تُفصَّل، والقيمة تبقى مجمّعة ومتّسقة مع الأستاذ.
        // ═══════════════════════════════════════════════════════
        Schema::create('warehouses', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('branch_id')->nullable()->constrained('branches')->nullOnDelete();
            $table->string('code');                       // تسلسلي تلقائي: 00001
            $table->string('name');
            $table->string('city')->nullable();
            $table->string('address')->nullable();
            $table->text('notes')->nullable();
            $table->boolean('is_default')->default(false); // المخزن الافتراضي للحركات بلا مخزن صريح
            $table->boolean('is_active')->default(true);
            $table->timestamps();

            $table->unique(['tenant_id', 'code']);
            $table->index(['tenant_id', 'branch_id']);
            $table->index(['tenant_id', 'is_active']);
        });

        // كميات المنتج لكل مخزن — تفصيل الرصيد. المجموع = products.quantity_on_hand.
        Schema::create('product_warehouse_stock', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('product_id')->constrained('products')->cascadeOnDelete();
            $table->foreignUuid('warehouse_id')->constrained('warehouses')->cascadeOnDelete();
            $table->integer('quantity')->default(0);
            $table->timestamps();

            $table->unique(['product_id', 'warehouse_id']);
            $table->index(['tenant_id', 'warehouse_id']);
        });

        // وسم الحركة بمخزنها (nullable — الحركات القائمة بلا مخزن).
        Schema::table('stock_movements', function (Blueprint $table) {
            $table->foreignUuid('warehouse_id')->nullable()->after('product_id')
                ->constrained('warehouses')->nullOnDelete();
            $table->index(['tenant_id', 'warehouse_id']);
        });
    }

    public function down(): void
    {
        Schema::table('stock_movements', function (Blueprint $table) {
            $table->dropConstrainedForeignId('warehouse_id');
        });
        Schema::dropIfExists('product_warehouse_stock');
        Schema::dropIfExists('warehouses');
    }
};
