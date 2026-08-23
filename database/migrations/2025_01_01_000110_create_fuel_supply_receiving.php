<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('fuel_deliveries', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('branch_id')->nullable()->constrained()->restrictOnDelete();
            $table->foreignUuid('fuel_station_id')->constrained('fuel_stations')->restrictOnDelete();
            $table->foreignUuid('fuel_tank_id')->constrained('fuel_tanks')->restrictOnDelete();
            $table->foreignUuid('fuel_product_id')->constrained('fuel_products')->restrictOnDelete();
            $table->foreignUuid('warehouse_id')->constrained()->restrictOnDelete();
            $table->foreignUuid('supplier_id')->constrained('partners')->restrictOnDelete();
            $table->foreignUuid('procurement_order_id')->nullable()->constrained('procurement_documents')->restrictOnDelete();
            $table->string('purchase_reference', 128)->nullable();
            $table->string('delivery_note_number', 128)->nullable();
            $table->string('tanker_identifier', 128)->nullable();
            $table->string('driver_name', 255)->nullable();
            $table->json('compartments')->nullable();
            $table->unsignedBigInteger('dispatched_milliliters');
            $table->unsignedBigInteger('received_milliliters');
            // received - dispatched: موجب = زائد عن الكمية المرسلة، وسالب = عجز نقل.
            $table->bigInteger('transit_variance_milliliters');
            $table->integer('temperature_milli_celsius')->nullable();
            $table->unsignedInteger('density_kg_per_m3')->nullable();
            $table->foreignUuid('before_physical_reading_id')->nullable()->constrained('fuel_tank_readings')->restrictOnDelete();
            $table->foreignUuid('after_physical_reading_id')->nullable()->constrained('fuel_tank_readings')->restrictOnDelete();
            $table->foreignUuid('before_atg_reading_id')->nullable()->constrained('fuel_tank_readings')->restrictOnDelete();
            $table->foreignUuid('after_atg_reading_id')->nullable()->constrained('fuel_tank_readings')->restrictOnDelete();
            $table->json('evidence')->nullable();
            $table->string('status', 32)->default('draft');
            // قيمة الاستلام هي أساس المتوسط المتحرك وGRNI؛ لا تُستمد من dispatched أو فاتورة لاحقة.
            $table->unsignedBigInteger('received_unit_cost_minor');
            $table->unsignedBigInteger('received_total_cost_minor');
            $table->foreignUuid('grni_account_id')->nullable()->constrained('accounts')->restrictOnDelete();
            $table->foreignUuid('stock_movement_id')->nullable()->constrained()->restrictOnDelete();
            $table->foreignUuid('journal_entry_id')->nullable()->constrained()->restrictOnDelete();
            $table->foreignUuid('fuel_operational_ledger_id')->nullable()->constrained('fuel_operational_ledgers')->restrictOnDelete();
            $table->string('idempotency_key', 128);
            $table->timestamp('received_at');
            $table->foreignUuid('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->foreignUuid('approved_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamp('approved_at')->nullable();
            $table->string('notes', 1000)->nullable();
            $table->timestamps();

            $table->unique(['tenant_id', 'idempotency_key'], 'fuel_delivery_idempotency_unique');
            $table->unique(['tenant_id', 'supplier_id', 'delivery_note_number'], 'fuel_delivery_supplier_note_unique');
            $table->index(['tenant_id', 'branch_id', 'fuel_station_id', 'status', 'received_at'], 'fuel_delivery_station_status_index');
            $table->index(['tenant_id', 'fuel_tank_id', 'received_at'], 'fuel_delivery_tank_received_index');
        });

        Schema::create('fuel_supplier_invoices', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('supplier_id')->constrained('partners')->restrictOnDelete();
            $table->foreignUuid('procurement_order_id')->nullable()->constrained('procurement_documents')->restrictOnDelete();
            // رابط اختياري لمستند Purchase موجود؛ لا يرحل PurchaseService مخزونه عند ربطه هنا.
            $table->foreignUuid('purchase_id')->nullable()->constrained('purchases')->restrictOnDelete();
            $table->string('invoice_number', 128);
            $table->date('invoice_date');
            $table->char('currency', 3)->default('SAR');
            $table->string('status', 32)->default('unmatched');
            $table->unsignedBigInteger('total_quantity_milliliters')->default(0);
            $table->unsignedBigInteger('total_value_minor')->default(0);
            $table->unsignedBigInteger('matched_quantity_milliliters')->default(0);
            $table->unsignedBigInteger('matched_value_minor')->default(0);
            $table->foreignUuid('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->foreignUuid('reviewed_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamp('reviewed_at')->nullable();
            $table->json('evidence')->nullable();
            $table->string('notes', 1000)->nullable();
            $table->timestamps();

            $table->unique(['tenant_id', 'supplier_id', 'invoice_number'], 'fuel_supplier_invoice_supplier_number_unique');
            $table->unique('purchase_id', 'fuel_supplier_invoice_purchase_unique');
            $table->index(['tenant_id', 'supplier_id', 'status', 'invoice_date'], 'fuel_supplier_invoice_supplier_status_index');
        });

        Schema::create('fuel_supplier_invoice_lines', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('fuel_supplier_invoice_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('fuel_product_id')->constrained('fuel_products')->restrictOnDelete();
            $table->unsignedInteger('line_number');
            $table->unsignedBigInteger('quantity_milliliters');
            $table->unsignedBigInteger('value_minor');
            $table->unsignedBigInteger('matched_quantity_milliliters')->default(0);
            $table->unsignedBigInteger('matched_value_minor')->default(0);
            $table->timestamps();

            $table->unique(['fuel_supplier_invoice_id', 'line_number'], 'fuel_supplier_invoice_line_number_unique');
            $table->index(['tenant_id', 'fuel_product_id']);
        });

        Schema::create('fuel_supplier_invoice_matches', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('branch_id')->nullable()->constrained()->restrictOnDelete();
            $table->foreignUuid('fuel_supplier_invoice_id')->constrained()->restrictOnDelete();
            $table->foreignUuid('fuel_supplier_invoice_line_id')->constrained()->restrictOnDelete();
            $table->foreignUuid('fuel_delivery_id')->constrained()->restrictOnDelete();
            // لقطات موضعية تحفظ معنى المطابقة إن تغيرت العلاقات الرئيسية مستقبلاً.
            $table->foreignUuid('supplier_id')->constrained('partners')->restrictOnDelete();
            $table->foreignUuid('fuel_station_id')->constrained('fuel_stations')->restrictOnDelete();
            $table->foreignUuid('fuel_tank_id')->constrained('fuel_tanks')->restrictOnDelete();
            $table->foreignUuid('fuel_product_id')->constrained('fuel_products')->restrictOnDelete();
            $table->foreignUuid('warehouse_id')->constrained()->restrictOnDelete();
            $table->foreignUuid('grni_account_id')->constrained('accounts')->restrictOnDelete();
            $table->unsignedBigInteger('matched_quantity_milliliters');
            $table->unsignedBigInteger('matched_receipt_value_minor');
            $table->unsignedBigInteger('matched_invoice_value_minor');
            // invoice - receipt؛ لا يعالج محاسبياً آلياً عندما لا يساوي صفراً.
            $table->bigInteger('value_variance_minor');
            $table->bigInteger('quantity_variance_milliliters')->default(0);
            $table->string('variance_direction', 32)->default('none');
            $table->char('currency', 3)->default('SAR');
            $table->string('status', 32)->default('matched');
            $table->unsignedBigInteger('cleared_value_minor')->default(0);
            $table->foreignUuid('journal_entry_id')->nullable()->constrained()->restrictOnDelete();
            $table->string('idempotency_key', 128);
            $table->foreignUuid('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->foreignUuid('reviewed_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamp('reviewed_at')->nullable();
            $table->timestamps();

            $table->unique(['tenant_id', 'idempotency_key'], 'fuel_supplier_match_idempotency_unique');
            $table->index(['tenant_id', 'branch_id', 'fuel_delivery_id', 'status'], 'fuel_supplier_match_delivery_status_index');
            $table->index(['tenant_id', 'fuel_supplier_invoice_line_id', 'status'], 'fuel_supplier_match_invoice_line_status_index');
        });

        Schema::create('fuel_inventory_cost_states', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('warehouse_id')->constrained()->restrictOnDelete();
            $table->foreignUuid('fuel_product_id')->constrained('fuel_products')->restrictOnDelete();
            // القيمة الدفترية المتبقية بالهللات والكمية الفعلية بـmL.
            $table->unsignedBigInteger('quantity_milliliters')->default(0);
            $table->unsignedBigInteger('cost_pool_minor')->default(0); // القيمة الدفترية الصحيحة فقط
            $table->string('cost_numerator_minor', 128)->default('0');
            $table->string('cost_denominator', 128)->default('1');
            // قاعدة توزيع البواقي الحالية. لا يُخزّن متوسط مقرب لكل mL.
            $table->string('allocation_mode', 16)->default('none'); // none | issue | gain
            $table->unsignedBigInteger('allocation_basis_quantity_milliliters')->default(0);
            $table->unsignedBigInteger('allocation_basis_cost_pool_minor')->default(0);
            $table->unsignedBigInteger('allocation_issued_milliliters')->default(0);
            $table->unsignedBigInteger('allocation_posted_minor')->default(0);
            $table->string('carry_remainder_numerator', 128)->default('0');
            $table->string('carry_remainder_denominator', 128)->default('1');
            $table->timestamps();

            $table->unique(['tenant_id', 'warehouse_id', 'fuel_product_id'], 'fuel_cost_state_unique');
        });

        Schema::create('fuel_inventory_cost_movements', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('warehouse_id')->constrained()->restrictOnDelete();
            $table->foreignUuid('fuel_product_id')->constrained('fuel_products')->restrictOnDelete();
            $table->foreignUuid('stock_movement_id')->constrained()->restrictOnDelete();
            $table->foreignUuid('journal_entry_id')->nullable()->constrained()->restrictOnDelete();
            $table->foreignUuid('fuel_delivery_id')->nullable()->constrained('fuel_deliveries')->restrictOnDelete();
            $table->string('movement_type', 24); // receipt | issue | adjustment
            $table->unsignedBigInteger('quantity_milliliters');
            $table->unsignedBigInteger('posted_cost_minor');
            $table->unsignedBigInteger('cost_pool_minor_before');
            $table->string('cost_numerator_before', 128)->default('0');
            $table->string('cost_denominator_before', 128)->default('1');
            $table->unsignedBigInteger('quantity_milliliters_before');
            $table->string('carry_remainder_numerator_before', 128)->default('0');
            $table->string('carry_remainder_denominator_before', 128)->default('1');
            $table->unsignedBigInteger('cost_pool_minor_after');
            $table->string('cost_numerator_after', 128)->default('0');
            $table->string('cost_denominator_after', 128)->default('1');
            $table->unsignedBigInteger('quantity_milliliters_after');
            $table->string('carry_remainder_numerator_after', 128)->default('0');
            $table->string('carry_remainder_denominator_after', 128)->default('1');
            $table->timestamp('occurred_at');
            $table->timestamps();

            $table->unique('stock_movement_id', 'fuel_cost_movement_stock_unique');
            $table->index(['tenant_id', 'warehouse_id', 'fuel_product_id', 'occurred_at'], 'fuel_cost_movement_scope_index');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('fuel_inventory_cost_movements');
        Schema::dropIfExists('fuel_inventory_cost_states');
        Schema::dropIfExists('fuel_supplier_invoice_matches');
        Schema::dropIfExists('fuel_supplier_invoice_lines');
        Schema::dropIfExists('fuel_supplier_invoices');
        Schema::dropIfExists('fuel_deliveries');
    }
};
