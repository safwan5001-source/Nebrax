<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('fuel_station_product_prices', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('fuel_station_id')->nullable()->constrained('fuel_stations')->cascadeOnDelete();
            $table->foreignUuid('fuel_product_id')->constrained('fuel_products')->restrictOnDelete();
            $table->bigInteger('price_per_liter_minor');
            $table->dateTime('effective_from');
            $table->dateTime('effective_until')->nullable();
            $table->string('status')->default('active');
            $table->foreignUuid('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->foreignUuid('approved_by')->nullable()->constrained('users')->nullOnDelete();
            $table->text('reason')->nullable();
            $table->timestamps();

            $table->index(['tenant_id', 'fuel_product_id', 'fuel_station_id', 'status', 'effective_from'], 'fuel_price_effective_lookup');
        });

        Schema::create('fuel_sales', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('branch_id')->constrained()->cascadeOnDelete();
            $table->string('number');
            $table->string('status')->default('draft');
            $table->foreignUuid('fuel_station_id')->constrained('fuel_stations')->cascadeOnDelete();
            $table->foreignUuid('warehouse_id')->constrained()->restrictOnDelete();
            $table->foreignUuid('fuel_shift_id')->nullable()->constrained('fuel_shifts')->restrictOnDelete();
            $table->foreignUuid('fuel_pump_id')->constrained('fuel_pumps')->restrictOnDelete();
            $table->foreignUuid('fuel_nozzle_id')->constrained('fuel_nozzles')->restrictOnDelete();
            $table->foreignUuid('fuel_tank_id')->constrained('fuel_tanks')->restrictOnDelete();
            $table->foreignUuid('fuel_product_id')->constrained('fuel_products')->restrictOnDelete();
            $table->foreignUuid('product_id')->constrained()->restrictOnDelete();
            $table->foreignUuid('partner_id')->nullable()->constrained('partners')->nullOnDelete();
            $table->unsignedBigInteger('quantity_milliliters');
            $table->bigInteger('price_per_liter_minor')->nullable();
            // Snapshot في لحظة finalization؛ لا يعيد تغير إعداد المحطة تفسير VAT لبيع تاريخي.
            $table->string('fuel_price_tax_mode')->nullable();
            $table->string('pricing_numerator')->nullable();
            $table->string('pricing_denominator')->nullable();
            $table->bigInteger('gross_minor')->nullable();
            $table->string('rounding_remainder_numerator')->nullable();
            $table->string('rounding_remainder_denominator')->nullable();
            $table->string('rounding_policy')->nullable();
            $table->unsignedBigInteger('meter_start_milliliters')->nullable();
            $table->unsignedBigInteger('meter_end_milliliters')->nullable();
            $table->string('meter_source_reference')->nullable();
            $table->json('source_references')->nullable();
            $table->foreignUuid('invoice_id')->nullable()->constrained()->restrictOnDelete();
            $table->foreignUuid('stock_movement_id')->nullable()->constrained()->restrictOnDelete();
            $table->foreignUuid('cogs_journal_entry_id')->nullable()->constrained('journal_entries')->restrictOnDelete();
            $table->bigInteger('cogs_minor')->nullable();
            $table->string('payment_status')->default('unpaid');
            $table->bigInteger('paid_minor')->default(0);
            $table->string('idempotency_key');
            $table->timestamp('finalized_at')->nullable();
            $table->foreignUuid('finalized_by')->nullable()->constrained('users')->nullOnDelete();
            $table->foreignUuid('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();

            $table->unique(['tenant_id', 'branch_id', 'number']);
            $table->unique(['tenant_id', 'idempotency_key']);
            $table->index(['tenant_id', 'branch_id', 'fuel_station_id', 'status']);
            $table->index(['tenant_id', 'fuel_shift_id', 'status']);
            $table->index(['tenant_id', 'invoice_id']);
        });

        Schema::create('fuel_sale_payment_receipts', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('branch_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('fuel_sale_id')->constrained('fuel_sales')->restrictOnDelete();
            $table->foreignUuid('payment_id')->constrained()->restrictOnDelete();
            $table->string('idempotency_key');
            $table->timestamp('recorded_at');
            $table->timestamps();

            $table->unique(['tenant_id', 'fuel_sale_id', 'idempotency_key'], 'fuel_sale_payment_idempotency_unique');
            $table->unique(['tenant_id', 'payment_id']);
            $table->index(['tenant_id', 'branch_id', 'fuel_sale_id']);
        });

        // توافق رجعي مؤرخ: دور حالي يملك fuel_stations.view/manage يحتفظ
        // بقدرة قراءة/إدارة مبيعات الوقود. الأدوار الجديدة تختار fuel.sale.* صراحةً.
        Schema::create('fuel_sale_role_permission_backfills', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('role_id')->constrained('roles')->cascadeOnDelete();
            $table->json('before_permissions');
            $table->json('after_permissions');
            $table->timestamps();
            $table->unique('role_id');
        });
        $saleManage = ['fuel.sale.view', 'fuel.sale.create', 'fuel.sale.finalize', 'fuel.sale.collect', 'fuel.sale.price.manage'];
        foreach (DB::table('roles')->whereNull('deleted_at')->select('id', 'permissions')->cursor() as $role) {
            $before = json_decode($role->permissions, true) ?: [];
            if (in_array('*', $before, true)) {
                continue;
            }
            $after = $before;
            if (in_array('fuel_stations.view', $before, true)) {
                $after[] = 'fuel.sale.view';
            }
            if (in_array('fuel_stations.manage', $before, true)) {
                $after = array_merge($after, $saleManage);
            }
            $after = array_values(array_unique($after));
            if ($after === $before) {
                continue;
            }
            DB::table('fuel_sale_role_permission_backfills')->insert([
                'id' => (string) \Illuminate\Support\Str::uuid(),
                'role_id' => $role->id,
                'before_permissions' => json_encode($before),
                'after_permissions' => json_encode($after),
                'created_at' => now(),
                'updated_at' => now(),
            ]);
            DB::table('roles')->where('id', $role->id)->update(['permissions' => json_encode($after), 'updated_at' => now()]);
        }

        Schema::table('invoice_lines', function (Blueprint $table) {
            $table->unsignedBigInteger('quantity_numerator')->nullable();
            $table->unsignedBigInteger('quantity_denominator')->nullable();
            $table->string('pricing_numerator')->nullable();
            $table->string('pricing_denominator')->nullable();
            $table->bigInteger('rounded_gross_minor')->nullable();
            $table->string('rounding_remainder_numerator')->nullable();
            $table->string('rounding_remainder_denominator')->nullable();
            $table->string('rounding_policy')->nullable();
        });
    }

    public function down(): void
    {
        if (Schema::hasTable('fuel_sale_role_permission_backfills')) {
            $backfills = DB::table('fuel_sale_role_permission_backfills')->get();
            foreach ($backfills as $backfill) {
                $role = DB::table('roles')->where('id', $backfill->role_id)->first();
                if ($role !== null && json_decode($role->permissions, true) !== json_decode($backfill->after_permissions, true)) {
                    throw new RuntimeException('لا يمكن rollback لصلاحيات Cycle 5 بأمان بعد تعديل دور مستأجر؛ راجع الدور صراحةً أولاً.');
                }
            }
            foreach ($backfills as $backfill) {
                if (DB::table('roles')->where('id', $backfill->role_id)->exists()) {
                    DB::table('roles')->where('id', $backfill->role_id)->update([
                        'permissions' => $backfill->before_permissions,
                        'updated_at' => now(),
                    ]);
                }
            }
            Schema::dropIfExists('fuel_sale_role_permission_backfills');
        }

        Schema::table('invoice_lines', function (Blueprint $table) {
            $table->dropColumn([
                'quantity_numerator', 'quantity_denominator', 'pricing_numerator', 'pricing_denominator',
                'rounded_gross_minor', 'rounding_remainder_numerator', 'rounding_remainder_denominator', 'rounding_policy',
            ]);
        });

        Schema::dropIfExists('fuel_sale_payment_receipts');
        Schema::dropIfExists('fuel_sales');
        Schema::dropIfExists('fuel_station_product_prices');
    }
};
