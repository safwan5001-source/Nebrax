<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * FUEL-TANKS-V2 / PR-1 — مستند «رصيد افتتاحي للوقود»: جدولان إضافيان فقط.
 * لا تعديل على أي جدول قائم، ولا Backfill، ولا مَسّ لأي بيان تاريخي.
 *
 *  - `fuel_opening_balances`: رأس المستند (محطة واحدة، مسودة ← مرحَّل). يحمل لقطة التقييم والقيد بعد الترحيل.
 *  - `fuel_opening_balance_lines`: سطر لكل خزان (كمية بالمللتر الصحيح) + تكلفة اللتر **للمنتج** منسوخة على سطور منتجه.
 *    بعد الترحيل يربط السطر بحركة المخزون وصف الدفتر التشغيلي الناتجين.
 *
 * مبدآن يحرسهما المخطط لا الكود وحده:
 *  - المستند لا يُرحَّل مرتين: `journal_entry_id` فريد، وكل سطر مرحَّل يملك حركة مخزون وصف دفتر فريدين، ومفتاح الدفتر
 *    `fuel-opening:{document}:{tank}` فريد للمؤسسة أصلاً (`fuel_operational_ledger_idempotency_unique`).
 *  - تكرار إنشاء المسودة يُعاد بمفتاح `idempotency_key` فريد للمؤسسة مع بصمة المحتوى.
 *
 * التراجع يرفض متى وُجد أي مستند (لا حذف لأثر محاسبي).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('fuel_opening_balances', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('branch_id')->constrained()->restrictOnDelete();
            $table->foreignUuid('fuel_station_id')->constrained('fuel_stations')->restrictOnDelete();
            $table->foreignUuid('warehouse_id')->constrained()->restrictOnDelete();
            $table->string('number');
            $table->date('opening_date');
            $table->string('status', 16)->default('draft'); // draft | posted
            $table->string('notes', 1000)->nullable();
            // موافقة صريحة على التكلفة صفر تُحفظ مع المستند لا مع الطلب (نمط InventoryOpening).
            $table->boolean('allow_zero_cost')->default(false);
            $table->string('idempotency_key', 128)->nullable();
            $table->string('request_hash', 64)->nullable();
            $table->bigInteger('total_milliliters')->default(0);
            $table->bigInteger('total_value_minor')->nullable(); // null حتى الترحيل
            $table->foreignUuid('journal_entry_id')->nullable()->constrained('journal_entries')->restrictOnDelete();
            $table->foreignUuid('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->foreignUuid('posted_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamp('posted_at')->nullable();
            $table->timestamps();

            $table->unique(['tenant_id', 'branch_id', 'number']);
            $table->unique(['tenant_id', 'idempotency_key'], 'fuel_opening_balances_idempotency_unique');
            $table->unique('journal_entry_id', 'fuel_opening_balances_journal_unique');
            $table->index(['tenant_id', 'fuel_station_id', 'status'], 'fuel_opening_balances_station_status_index');
        });

        Schema::create('fuel_opening_balance_lines', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('branch_id')->constrained()->restrictOnDelete();
            $table->foreignUuid('fuel_opening_balance_id')->constrained('fuel_opening_balances')->cascadeOnDelete();
            $table->foreignUuid('fuel_tank_id')->constrained('fuel_tanks')->restrictOnDelete();
            $table->foreignUuid('fuel_product_id')->constrained('fuel_products')->restrictOnDelete();
            $table->unsignedSmallInteger('position');
            $table->bigInteger('quantity_milliliters');
            $table->bigInteger('unit_cost_per_liter_minor')->nullable(); // null = لم تُسجَّل (لا صفر مخترع)
            $table->bigInteger('value_minor')->nullable(); // يُحسب ويُثبَّت عند الترحيل فقط
            $table->foreignUuid('stock_movement_id')->nullable()->constrained('stock_movements')->restrictOnDelete();
            $table->foreignUuid('fuel_operational_ledger_id')->nullable()->constrained('fuel_operational_ledgers')->restrictOnDelete();
            $table->timestamps();

            $table->unique(['fuel_opening_balance_id', 'fuel_tank_id'], 'fuel_opening_lines_document_tank_unique');
            $table->unique('stock_movement_id', 'fuel_opening_lines_movement_unique');
            $table->unique('fuel_operational_ledger_id', 'fuel_opening_lines_ledger_unique');
            $table->index(['tenant_id', 'fuel_tank_id'], 'fuel_opening_lines_tank_index');
        });

        if (DB::getDriverName() === 'pgsql') {
            DB::statement("ALTER TABLE fuel_opening_balances ADD CONSTRAINT fuel_opening_balances_status_check CHECK (status IN ('draft','posted') AND ((status = 'posted') = (posted_at IS NOT NULL)))");
            DB::statement('ALTER TABLE fuel_opening_balance_lines ADD CONSTRAINT fuel_opening_lines_quantity_check CHECK (quantity_milliliters > 0 AND (unit_cost_per_liter_minor IS NULL OR unit_cost_per_liter_minor >= 0) AND (value_minor IS NULL OR value_minor >= 0))');
        }
    }

    public function down(): void
    {
        if (DB::table('fuel_opening_balances')->exists()) {
            throw new RuntimeException('لا يمكن التراجع عن هجرة الأرصدة الافتتاحية للوقود: توجد مستندات (لا حذف لأثر محاسبي).');
        }

        Schema::dropIfExists('fuel_opening_balance_lines');
        Schema::dropIfExists('fuel_opening_balances');
    }
};
