<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('fuel_stations', function (Blueprint $table) {
            $table->string('country_code', 2)->nullable()->after('name');
            $table->string('region', 120)->nullable()->after('country_code');
            $table->string('city', 120)->nullable()->after('region');
            $table->string('address', 1000)->nullable()->after('city');
            $table->decimal('latitude', 10, 7)->nullable()->after('address');
            $table->decimal('longitude', 10, 7)->nullable()->after('latitude');
            $table->foreignUuid('manager_id')->nullable()->after('branch_id')->constrained('users')->nullOnDelete();
            $table->json('operating_hours')->nullable()->after('operating_day_starts_at');
            $table->string('license_number', 128)->nullable()->after('operating_hours');
            $table->date('license_expires_at')->nullable()->after('license_number');
            // معرف موقع/فرع ZATCA وصفي في هذه الدورة؛ لا يخلق شهادة أو عدّاد ICV.
            $table->string('zatca_branch_reference', 128)->nullable()->after('license_expires_at');
            // خرائط افتراضية مستقبلية فقط؛ لا تستخدم في أي قيد ضمن Cycle 1.
            $table->foreignUuid('default_inventory_account_id')->nullable()->constrained('accounts')->nullOnDelete();
            $table->foreignUuid('default_revenue_account_id')->nullable()->constrained('accounts')->nullOnDelete();
            $table->foreignUuid('default_cogs_account_id')->nullable()->constrained('accounts')->nullOnDelete();
            $table->index(['tenant_id', 'manager_id']);
        });

        // الكيان التجاري للوقود لا ينسخ محرك المنتجات؛ product_id هو مرجع
        // المخزون والضريبة والحسابات الموجود. الكثافة بوحدة kg/m³، لا float.
        Schema::create('fuel_products', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('product_id')->constrained()->restrictOnDelete();
            $table->string('code', 64);
            $table->string('name');
            $table->unsignedInteger('density_kg_per_m3')->nullable();
            $table->string('tax_category', 64)->nullable();
            $table->boolean('is_active')->default(true);
            $table->timestamps();

            $table->unique(['tenant_id', 'code']);
            $table->unique(['tenant_id', 'product_id']);
            $table->index(['tenant_id', 'is_active']);
        });

        // كل قياس حجمي يكتب بالمليلتر حتى لا تدخل الكسور العشرية إلى قراءة/حساب
        // تشغيلي. Cycle 2 وحده يملك إنشاء مخزون أو تسوية أو قيد مالي.
        Schema::create('fuel_tanks', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('branch_id')->nullable()->constrained()->restrictOnDelete();
            $table->foreignUuid('fuel_station_id')->constrained('fuel_stations')->restrictOnDelete();
            $table->foreignUuid('fuel_product_id')->constrained('fuel_products')->restrictOnDelete();
            $table->string('code', 64);
            $table->string('name');
            $table->unsignedBigInteger('capacity_milliliters');
            $table->unsignedBigInteger('safe_capacity_milliliters');
            $table->unsignedBigInteger('minimum_level_milliliters')->default(0);
            $table->unsignedBigInteger('dead_stock_milliliters')->default(0);
            $table->unsignedBigInteger('opening_volume_milliliters')->default(0);
            $table->json('measurement_configuration')->nullable();
            $table->string('atg_source_key', 128)->nullable();
            $table->string('status', 32)->default('active');
            $table->timestamps();

            $table->unique(['tenant_id', 'fuel_station_id', 'code']);
            $table->unique(['tenant_id', 'atg_source_key']);
            $table->index(['tenant_id', 'branch_id', 'fuel_station_id', 'status']);
        });

        Schema::create('fuel_tank_calibration_points', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('branch_id')->nullable()->constrained()->restrictOnDelete();
            $table->foreignUuid('fuel_tank_id')->constrained('fuel_tanks')->cascadeOnDelete();
            $table->unsignedInteger('level_millimeters');
            $table->unsignedBigInteger('volume_milliliters');
            $table->timestamps();

            $table->unique(['tenant_id', 'fuel_tank_id', 'level_millimeters'], 'fuel_tank_calibration_level_unique');
            $table->index(['tenant_id', 'branch_id', 'fuel_tank_id']);
        });

        Schema::create('fuel_pumps', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('branch_id')->nullable()->constrained()->restrictOnDelete();
            $table->foreignUuid('fuel_station_id')->constrained('fuel_stations')->restrictOnDelete();
            $table->string('pump_number', 64);
            $table->string('name')->nullable();
            $table->string('controller_key', 128)->nullable();
            $table->string('status', 32)->default('active');
            $table->timestamps();

            $table->unique(['tenant_id', 'fuel_station_id', 'pump_number']);
            $table->unique(['tenant_id', 'controller_key']);
            $table->index(['tenant_id', 'branch_id', 'fuel_station_id', 'status']);
        });

        Schema::create('fuel_nozzles', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('branch_id')->nullable()->constrained()->restrictOnDelete();
            $table->foreignUuid('fuel_station_id')->constrained('fuel_stations')->restrictOnDelete();
            $table->foreignUuid('fuel_pump_id')->constrained('fuel_pumps')->restrictOnDelete();
            $table->foreignUuid('fuel_tank_id')->constrained('fuel_tanks')->restrictOnDelete();
            $table->foreignUuid('fuel_product_id')->constrained('fuel_products')->restrictOnDelete();
            $table->string('nozzle_number', 64);
            $table->string('controller_key', 128)->nullable();
            $table->unsignedBigInteger('meter_opening_milliliters')->default(0);
            $table->string('status', 32)->default('active');
            $table->timestamps();

            $table->unique(['tenant_id', 'fuel_pump_id', 'nozzle_number']);
            $table->unique(['tenant_id', 'controller_key']);
            $table->index(['tenant_id', 'branch_id', 'fuel_station_id', 'fuel_tank_id', 'status']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('fuel_nozzles');
        Schema::dropIfExists('fuel_pumps');
        Schema::dropIfExists('fuel_tank_calibration_points');
        Schema::dropIfExists('fuel_tanks');
        Schema::dropIfExists('fuel_products');

        Schema::table('fuel_stations', function (Blueprint $table) {
            $table->dropIndex(['tenant_id', 'manager_id']);
            $table->dropConstrainedForeignId('default_cogs_account_id');
            $table->dropConstrainedForeignId('default_revenue_account_id');
            $table->dropConstrainedForeignId('default_inventory_account_id');
            $table->dropConstrainedForeignId('manager_id');
            $table->dropColumn([
                'country_code', 'region', 'city', 'address', 'latitude', 'longitude',
                'operating_hours', 'license_number', 'license_expires_at', 'zatca_branch_reference',
            ]);
        });
    }
};
