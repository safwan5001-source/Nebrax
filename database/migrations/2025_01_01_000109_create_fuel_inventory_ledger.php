<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('fuel_stations', function (Blueprint $table) {
            // تكوين تشغيلي صريح، nullable لحماية المحطات القائمة. لا fallback في الخدمة.
            $table->foreignUuid('warehouse_id')->nullable()->after('branch_id')->constrained()->restrictOnDelete();
            $table->index(['tenant_id', 'branch_id', 'warehouse_id']);
        });

        Schema::table('fuel_products', function (Blueprint $table) {
            // Cycle 2 contract: Product/StockMovement quantity is mL only for this fuel mapping.
            $table->string('inventory_base_unit', 16)->default('mL')->after('name');
            $table->string('display_unit', 16)->default('L')->after('inventory_base_unit');
        });

        Schema::create('fuel_tank_readings', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('branch_id')->nullable()->constrained()->restrictOnDelete();
            $table->foreignUuid('fuel_station_id')->constrained('fuel_stations')->restrictOnDelete();
            $table->foreignUuid('fuel_tank_id')->constrained('fuel_tanks')->restrictOnDelete();
            $table->string('reading_type', 20); // physical | atg
            $table->unsignedBigInteger('quantity_milliliters');
            $table->timestamp('measured_at');
            // مصدر القياس فريد: لا يعاد استخدام الدليل لتسوية أخرى.
            $table->string('evidence_key', 128);
            $table->json('evidence')->nullable();
            $table->foreignUuid('recorded_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();

            $table->unique(['tenant_id', 'evidence_key'], 'fuel_reading_evidence_unique');
            $table->index(['tenant_id', 'branch_id', 'fuel_tank_id', 'reading_type', 'measured_at']);
        });

        Schema::create('fuel_reconciliations', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('branch_id')->nullable()->constrained()->restrictOnDelete();
            $table->foreignUuid('fuel_station_id')->constrained('fuel_stations')->restrictOnDelete();
            $table->foreignUuid('fuel_tank_id')->constrained('fuel_tanks')->restrictOnDelete();
            $table->foreignUuid('fuel_product_id')->constrained('fuel_products')->restrictOnDelete();
            // لقطة المخزن الفعلي حتى لا يغير إعداد المحطة معنى تسوية تاريخية.
            $table->foreignUuid('warehouse_id')->constrained()->restrictOnDelete();
            $table->string('status', 20)->default('draft');
            $table->unsignedBigInteger('opening_book_milliliters');
            $table->unsignedBigInteger('deliveries_milliliters')->default(0);
            $table->unsignedBigInteger('sales_milliliters')->default(0);
            $table->bigInteger('transfers_milliliters')->default(0);
            $table->bigInteger('prior_adjustments_milliliters')->default(0);
            $table->bigInteger('expected_closing_milliliters');
            $table->unsignedBigInteger('physical_closing_milliliters')->nullable();
            $table->unsignedBigInteger('atg_closing_milliliters')->nullable();
            $table->bigInteger('variance_milliliters')->nullable();
            $table->integer('variance_basis_points')->nullable();
            $table->unsignedBigInteger('tolerance_absolute_milliliters')->default(0);
            $table->integer('tolerance_basis_points')->default(0);
            $table->boolean('requires_approval')->default(true);
            // جميع الأموال بالهللات وتُلتقط وقت الاعتماد، لا يعاد حساب التاريخ بمتوسط لاحق.
            $table->unsignedBigInteger('unit_cost_minor')->nullable();
            $table->bigInteger('financial_variance_minor')->nullable();
            $table->foreignUuid('physical_reading_id')->nullable()->constrained('fuel_tank_readings')->restrictOnDelete();
            $table->foreignUuid('atg_reading_id')->nullable()->constrained('fuel_tank_readings')->restrictOnDelete();
            $table->foreignUuid('stock_movement_id')->nullable()->constrained()->restrictOnDelete();
            $table->foreignUuid('journal_entry_id')->nullable()->constrained()->restrictOnDelete();
            $table->foreignUuid('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->foreignUuid('approved_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamp('approved_at')->nullable();
            $table->string('reason', 1000)->nullable();
            $table->timestamps();

            // نوع القراءة يتحقق منه المجال؛ الفهارسان الفريدان يحسمان السباق على الدليل نفسه.
            $table->unique('physical_reading_id', 'fuel_reconciliations_physical_reading_unique');
            $table->unique('atg_reading_id', 'fuel_reconciliations_atg_reading_unique');
            $table->index(['tenant_id', 'branch_id', 'fuel_tank_id', 'status', 'created_at']);
        });

        Schema::create('fuel_operational_ledgers', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('branch_id')->nullable()->constrained()->restrictOnDelete();
            $table->foreignUuid('fuel_station_id')->constrained('fuel_stations')->restrictOnDelete();
            $table->foreignUuid('fuel_tank_id')->constrained('fuel_tanks')->restrictOnDelete();
            $table->foreignUuid('fuel_product_id')->constrained('fuel_products')->restrictOnDelete();
            $table->foreignUuid('warehouse_id')->constrained()->restrictOnDelete();
            $table->foreignUuid('fuel_reconciliation_id')->nullable()->constrained('fuel_reconciliations')->restrictOnDelete();
            $table->foreignUuid('stock_movement_id')->nullable()->constrained()->restrictOnDelete();
            $table->string('movement_type', 32);
            $table->bigInteger('quantity_milliliters');
            $table->bigInteger('book_balance_milliliters');
            $table->unsignedBigInteger('unit_cost_minor')->nullable();
            $table->bigInteger('value_minor')->nullable();
            $table->string('idempotency_key', 128);
            $table->nullableUuidMorphs('source');
            $table->timestamp('occurred_at');
            $table->string('notes', 1000)->nullable();
            $table->timestamps();

            $table->unique(['tenant_id', 'idempotency_key'], 'fuel_operational_ledger_idempotency_unique');
            $table->index(['tenant_id', 'branch_id', 'fuel_tank_id', 'occurred_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('fuel_operational_ledgers');
        Schema::dropIfExists('fuel_reconciliations');
        Schema::dropIfExists('fuel_tank_readings');
        Schema::table('fuel_products', fn (Blueprint $table) => $table->dropColumn(['inventory_base_unit', 'display_unit']));
        Schema::table('fuel_stations', function (Blueprint $table) {
            $table->dropIndex(['tenant_id', 'branch_id', 'warehouse_id']);
            $table->dropConstrainedForeignId('warehouse_id');
        });
    }
};
