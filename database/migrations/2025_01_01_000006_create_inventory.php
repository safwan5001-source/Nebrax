<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // أعمدة المخزون على المنتج: الرصيد الكمي ومتوسط التكلفة (هللات)
        Schema::table('products', function (Blueprint $table) {
            $table->integer('quantity_on_hand')->default(0)->after('track_inventory');
            $table->bigInteger('avg_cost')->default(0)->after('quantity_on_hand'); // متوسط تكلفة الوحدة
        });

        // ربط قيد تكلفة البضاعة المباعة بالفاتورة (بدون FET في ALTER لتوافق SQLite)
        Schema::table('invoices', function (Blueprint $table) {
            $table->uuid('cogs_entry_id')->nullable()->after('journal_entry_id');
        });

        // ═══════════════════════════════════════════════════════
        // حركات المخزون (Stock Movements) — سجل دائم (perpetual)
        // ═══════════════════════════════════════════════════════
        Schema::create('stock_movements', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('product_id')->constrained('products')->cascadeOnDelete();
            $table->enum('type', ['in', 'out', 'adjustment']);
            $table->integer('quantity');                           // الكمية المتحركة
            $table->bigInteger('unit_cost')->default(0);           // تكلفة الوحدة (هللات)
            $table->bigInteger('total_cost')->default(0);          // إجمالي تكلفة الحركة
            $table->integer('balance_quantity')->default(0);       // الرصيد الكمي بعد الحركة
            $table->string('source_type')->nullable();             // المصدر (فاتورة، استلام...)
            $table->uuid('source_id')->nullable();
            $table->date('movement_date');
            $table->string('notes')->nullable();
            $table->timestamps();

            $table->index(['tenant_id', 'product_id']);
            $table->index(['source_type', 'source_id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('stock_movements');
        Schema::table('invoices', function (Blueprint $table) {
            $table->dropColumn('cogs_entry_id');
        });
        Schema::table('products', function (Blueprint $table) {
            $table->dropColumn(['quantity_on_hand', 'avg_cost']);
        });
    }
};
