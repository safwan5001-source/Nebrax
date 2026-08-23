<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('corporate_fuel_contracts', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->string('number');
            $table->foreignUuid('partner_id')->constrained('partners')->restrictOnDelete();
            $table->string('status')->default('draft');
            $table->dateTime('effective_from');
            $table->dateTime('effective_until')->nullable();
            $table->bigInteger('credit_limit_minor');
            $table->unsignedInteger('payment_terms_days')->default(0);
            $table->string('station_restriction_mode')->default('all');
            $table->string('fuel_restriction_mode')->default('all');
            $table->string('billing_mode')->default('per_sale');
            $table->string('odometer_policy')->nullable();
            $table->boolean('driver_required')->nullable();
            $table->boolean('vehicle_required')->nullable();
            $table->boolean('fuel_card_required')->nullable();
            $table->foreignUuid('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->foreignUuid('activated_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamp('activated_at')->nullable();
            $table->foreignUuid('suspended_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamp('suspended_at')->nullable();
            $table->text('suspension_reason')->nullable();
            $table->timestamps();

            $table->unique(['tenant_id', 'number']);
            $table->index(['tenant_id', 'partner_id', 'status', 'effective_from'], 'corporate_fuel_contract_lookup');
        });

        Schema::create('corporate_fuel_contract_stations', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('corporate_fuel_contract_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('fuel_station_id')->constrained('fuel_stations')->restrictOnDelete();
            $table->timestamps();

            $table->unique(['corporate_fuel_contract_id', 'fuel_station_id'], 'corporate_contract_station_unique');
        });

        Schema::create('corporate_fuel_contract_products', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('corporate_fuel_contract_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('fuel_product_id')->constrained('fuel_products')->restrictOnDelete();
            $table->timestamps();

            $table->unique(['corporate_fuel_contract_id', 'fuel_product_id'], 'corporate_contract_product_unique');
        });

        Schema::create('corporate_fuel_contract_prices', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('corporate_fuel_contract_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('fuel_product_id')->constrained('fuel_products')->restrictOnDelete();
            $table->bigInteger('price_per_liter_minor');
            $table->string('tax_mode');
            $table->dateTime('effective_from');
            $table->dateTime('effective_until')->nullable();
            $table->string('status')->default('active');
            $table->foreignUuid('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->foreignUuid('approved_by')->nullable()->constrained('users')->nullOnDelete();
            $table->text('reason')->nullable();
            $table->timestamps();

            $table->index(['tenant_id', 'corporate_fuel_contract_id', 'fuel_product_id', 'status', 'effective_from'], 'corporate_contract_price_lookup');
        });

        // صف القفل لا يمثل دفتر ذمم موازياً؛ إنه mutex متين لمبيعات العقود
        // المتزامنة لنفس العميل عند فحص رصيد 1130 الرسمي المتوقع.
        Schema::create('corporate_fuel_credit_locks', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('partner_id')->constrained('partners')->restrictOnDelete();
            $table->timestamps();

            $table->unique(['tenant_id', 'partner_id']);
        });

        Schema::create('fuel_fleet_vehicles', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('partner_id')->nullable()->constrained('partners')->restrictOnDelete();
            $table->foreignUuid('corporate_fuel_contract_id')->nullable()->constrained()->restrictOnDelete();
            $table->string('plate_number');
            $table->string('plate_country')->nullable();
            $table->string('vin')->nullable();
            $table->string('fleet_number')->nullable();
            $table->string('fuel_type')->nullable();
            $table->unsignedBigInteger('tank_capacity_milliliters')->nullable();
            $table->unsignedBigInteger('odometer')->nullable();
            $table->string('status')->default('active');
            $table->foreignUuid('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();

            $table->unique(['tenant_id', 'plate_country', 'plate_number'], 'fuel_fleet_vehicle_plate_unique');
            $table->unique(['tenant_id', 'vin'], 'fuel_fleet_vehicle_vin_unique');
            $table->index(['tenant_id', 'partner_id', 'status']);
        });

        Schema::create('fuel_fleet_vehicle_products', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('fuel_fleet_vehicle_id')->constrained('fuel_fleet_vehicles')->cascadeOnDelete();
            $table->foreignUuid('fuel_product_id')->constrained('fuel_products')->restrictOnDelete();
            $table->timestamps();

            $table->unique(['fuel_fleet_vehicle_id', 'fuel_product_id'], 'fuel_fleet_vehicle_product_unique');
        });

        Schema::create('fuel_fleet_drivers', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('partner_id')->nullable()->constrained('partners')->restrictOnDelete();
            $table->foreignUuid('corporate_fuel_contract_id')->nullable()->constrained()->restrictOnDelete();
            $table->foreignUuid('employee_id')->nullable()->constrained('employees')->restrictOnDelete();
            $table->string('name');
            $table->string('identifier')->nullable();
            $table->string('mobile')->nullable();
            $table->string('status')->default('active');
            $table->foreignUuid('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();

            $table->unique(['tenant_id', 'identifier'], 'fuel_fleet_driver_identifier_unique');
            $table->index(['tenant_id', 'partner_id', 'status']);
        });

        Schema::create('fuel_fleet_driver_vehicles', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('fuel_fleet_driver_id')->constrained('fuel_fleet_drivers')->cascadeOnDelete();
            $table->foreignUuid('fuel_fleet_vehicle_id')->constrained('fuel_fleet_vehicles')->cascadeOnDelete();
            $table->timestamps();

            $table->unique(['fuel_fleet_driver_id', 'fuel_fleet_vehicle_id'], 'fuel_fleet_driver_vehicle_unique');
        });

        Schema::create('fuel_cards', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->string('public_identifier');
            $table->string('credential_hash');
            $table->foreignUuid('partner_id')->constrained('partners')->restrictOnDelete();
            $table->foreignUuid('corporate_fuel_contract_id')->constrained()->restrictOnDelete();
            $table->foreignUuid('fuel_fleet_vehicle_id')->nullable()->constrained()->restrictOnDelete();
            $table->foreignUuid('fuel_fleet_driver_id')->nullable()->constrained()->restrictOnDelete();
            $table->string('status')->default('active');
            $table->dateTime('effective_from');
            $table->dateTime('effective_until')->nullable();
            $table->unsignedBigInteger('per_transaction_milliliters')->nullable();
            $table->bigInteger('per_transaction_value_minor')->nullable();
            $table->unsignedBigInteger('daily_milliliters')->nullable();
            $table->bigInteger('daily_value_minor')->nullable();
            $table->unsignedBigInteger('weekly_milliliters')->nullable();
            $table->bigInteger('weekly_value_minor')->nullable();
            $table->unsignedBigInteger('monthly_milliliters')->nullable();
            $table->bigInteger('monthly_value_minor')->nullable();
            $table->unsignedInteger('daily_transaction_count')->nullable();
            $table->string('station_restriction_mode')->default('all');
            $table->string('fuel_restriction_mode')->default('all');
            $table->json('allowed_time_windows')->nullable();
            // لا يفرض PostgreSQL FK ذاتياً هنا لأن نمط Nebrax متعدد المستأجرين
            // لا يضمن فهرس id منفرداً في كل driver. المرجع مفهرس ويُتحقق منه
            // داخل FuelCardService ضمن المستأجر والعقد نفسه قبل الاستبدال.
            $table->uuid('replaces_fuel_card_id')->nullable()->index();
            $table->foreignUuid('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();

            $table->unique(['tenant_id', 'public_identifier']);
            $table->unique(['tenant_id', 'credential_hash']);
            $table->index(['tenant_id', 'partner_id', 'corporate_fuel_contract_id', 'status'], 'fuel_card_lookup');
        });

        Schema::create('fuel_card_stations', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('fuel_card_id')->constrained('fuel_cards')->cascadeOnDelete();
            $table->foreignUuid('fuel_station_id')->constrained('fuel_stations')->restrictOnDelete();
            $table->timestamps();

            $table->unique(['fuel_card_id', 'fuel_station_id']);
        });

        Schema::create('fuel_card_products', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('fuel_card_id')->constrained('fuel_cards')->cascadeOnDelete();
            $table->foreignUuid('fuel_product_id')->constrained('fuel_products')->restrictOnDelete();
            $table->timestamps();

            $table->unique(['fuel_card_id', 'fuel_product_id']);
        });

        Schema::create('fuel_vehicle_odometer_readings', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('fuel_fleet_vehicle_id')->constrained('fuel_fleet_vehicles')->restrictOnDelete();
            $table->foreignUuid('fuel_sale_id')->nullable()->constrained('fuel_sales')->restrictOnDelete();
            $table->unsignedBigInteger('odometer');
            $table->string('source')->default('fuel_sale');
            $table->foreignUuid('recorded_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamp('recorded_at');
            $table->timestamps();

            $table->unique(['tenant_id', 'fuel_sale_id']);
            $table->index(['tenant_id', 'fuel_fleet_vehicle_id', 'recorded_at']);
        });

        Schema::create('fuel_card_usages', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('branch_id')->constrained()->restrictOnDelete();
            $table->foreignUuid('fuel_card_id')->constrained('fuel_cards')->restrictOnDelete();
            $table->foreignUuid('fuel_sale_id')->constrained('fuel_sales')->restrictOnDelete();
            $table->foreignUuid('corporate_fuel_contract_id')->constrained()->restrictOnDelete();
            $table->foreignUuid('partner_id')->constrained('partners')->restrictOnDelete();
            $table->foreignUuid('fuel_station_id')->constrained('fuel_stations')->restrictOnDelete();
            $table->foreignUuid('fuel_product_id')->constrained('fuel_products')->restrictOnDelete();
            $table->unsignedBigInteger('quantity_milliliters');
            $table->bigInteger('invoice_total_minor');
            $table->timestamp('occurred_at');
            $table->timestamps();

            $table->unique(['tenant_id', 'fuel_sale_id']);
            $table->index(['tenant_id', 'fuel_card_id', 'occurred_at'], 'fuel_card_usage_window_lookup');
        });

        Schema::create('corporate_fuel_audit_events', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->string('subject_type');
            $table->uuid('subject_id');
            $table->string('action');
            $table->json('before')->nullable();
            $table->json('after')->nullable();
            $table->foreignUuid('changed_by')->nullable()->constrained('users')->nullOnDelete();
            $table->text('reason')->nullable();
            $table->timestamp('changed_at');
            $table->timestamps();

            $table->index(['tenant_id', 'subject_type', 'subject_id', 'changed_at'], 'corporate_fuel_audit_subject_lookup');
        });

        Schema::table('fuel_sales', function (Blueprint $table) {
            $table->foreignUuid('corporate_fuel_contract_id')->nullable()->constrained()->restrictOnDelete();
            $table->foreignUuid('corporate_fuel_contract_price_id')->nullable()->constrained()->restrictOnDelete();
            $table->foreignUuid('fuel_card_id')->nullable()->constrained()->restrictOnDelete();
            $table->foreignUuid('fuel_fleet_vehicle_id')->nullable()->constrained()->restrictOnDelete();
            $table->foreignUuid('fuel_fleet_driver_id')->nullable()->constrained()->restrictOnDelete();
            $table->string('corporate_price_source')->nullable();
            $table->unsignedInteger('contract_payment_terms_days')->nullable();
            $table->unsignedBigInteger('odometer_snapshot')->nullable();
        });
    }

    public function down(): void
    {
        Schema::table('fuel_sales', function (Blueprint $table) {
            $table->dropConstrainedForeignId('corporate_fuel_contract_id');
            $table->dropConstrainedForeignId('corporate_fuel_contract_price_id');
            $table->dropConstrainedForeignId('fuel_card_id');
            $table->dropConstrainedForeignId('fuel_fleet_vehicle_id');
            $table->dropConstrainedForeignId('fuel_fleet_driver_id');
            $table->dropColumn(['corporate_price_source', 'contract_payment_terms_days', 'odometer_snapshot']);
        });

        Schema::dropIfExists('corporate_fuel_audit_events');
        Schema::dropIfExists('fuel_card_usages');
        Schema::dropIfExists('fuel_vehicle_odometer_readings');
        Schema::dropIfExists('fuel_card_products');
        Schema::dropIfExists('fuel_card_stations');
        Schema::dropIfExists('fuel_cards');
        Schema::dropIfExists('fuel_fleet_driver_vehicles');
        Schema::dropIfExists('fuel_fleet_drivers');
        Schema::dropIfExists('fuel_fleet_vehicle_products');
        Schema::dropIfExists('fuel_fleet_vehicles');
        Schema::dropIfExists('corporate_fuel_credit_locks');
        Schema::dropIfExists('corporate_fuel_contract_prices');
        Schema::dropIfExists('corporate_fuel_contract_products');
        Schema::dropIfExists('corporate_fuel_contract_stations');
        Schema::dropIfExists('corporate_fuel_contracts');
    }
};
