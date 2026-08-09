<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * الموجة الثالثة (P3-ج-٢) — عمودان بدلالتين مختلفتين:
     *
     *  • `products.branch_id`         → عزل **مشروط** بمفتاح «مشاركة المنتجات»
     *    (مفعّل افتراضياً، فلا تصفية إطلاقاً حتى يُطفئه المستخدم).
     *  • `stock_movements.branch_id`  → **وسم فقط** (BelongsToBranch) بفرع المخزن.
     *    تصفيتها التلقائية كانت ستكسر التقييم — المتوسط المتحرك عالمي على المنتج.
     */
    private const TABLES = ['products', 'stock_movements'];

    public function up(): void
    {
        foreach (self::TABLES as $name) {
            Schema::table($name, function (Blueprint $table) {
                $table->foreignUuid('branch_id')->nullable()
                    ->constrained('branches')->nullOnDelete();
                $table->index(['tenant_id', 'branch_id']);
            });
        }
    }

    public function down(): void
    {
        foreach (array_reverse(self::TABLES) as $name) {
            Schema::table($name, function (Blueprint $table) {
                $table->dropConstrainedForeignId('branch_id');
            });
        }
    }
};
