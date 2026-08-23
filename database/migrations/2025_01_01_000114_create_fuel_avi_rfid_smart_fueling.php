<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('fuel_avi_identity_tags', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->string('public_identifier');
            $table->string('credential_hash');
            $table->string('identity_type');
            $table->foreignUuid('partner_id')->constrained('partners')->restrictOnDelete();
            $table->foreignUuid('corporate_fuel_contract_id')->constrained()->restrictOnDelete();
            $table->foreignUuid('fuel_card_id')->nullable()->constrained('fuel_cards')->restrictOnDelete();
            $table->foreignUuid('fuel_fleet_vehicle_id')->nullable()->constrained()->restrictOnDelete();
            $table->foreignUuid('fuel_fleet_driver_id')->nullable()->constrained()->restrictOnDelete();
            $table->string('status')->default('active');
            $table->dateTime('effective_from');
            $table->dateTime('effective_until')->nullable();
            // مرجع الاستبدال يتحقق منه خادمياً داخل المستأجر، مثل FuelCard؛ لا
            // يفترض هذا النمط متعدد المستأجرين فهرس id منفرداً صالحاً لكل driver.
            $table->uuid('replaces_fuel_avi_identity_tag_id')->nullable()->index();
            $table->foreignUuid('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();

            $table->unique(['tenant_id', 'public_identifier'], 'fuel_avi_tag_public_identifier_unique');
            $table->unique(['tenant_id', 'credential_hash'], 'fuel_avi_tag_credential_hash_unique');
            $table->index(['tenant_id', 'partner_id', 'corporate_fuel_contract_id', 'status'], 'fuel_avi_tag_authorization_lookup');
        });

        Schema::create('fuel_avi_authorizations', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('branch_id')->constrained()->restrictOnDelete();
            $table->foreignUuid('fuel_station_id')->constrained('fuel_stations')->restrictOnDelete();
            $table->foreignUuid('fuel_nozzle_id')->constrained('fuel_nozzles')->restrictOnDelete();
            $table->foreignUuid('fuel_product_id')->constrained('fuel_products')->restrictOnDelete();
            $table->foreignUuid('vehicle_identity_tag_id')->nullable()->constrained('fuel_avi_identity_tags')->restrictOnDelete();
            $table->foreignUuid('driver_identity_tag_id')->nullable()->constrained('fuel_avi_identity_tags')->restrictOnDelete();
            $table->foreignUuid('partner_id')->nullable()->constrained('partners')->restrictOnDelete();
            $table->foreignUuid('corporate_fuel_contract_id')->nullable()->constrained()->restrictOnDelete();
            $table->foreignUuid('fuel_card_id')->nullable()->constrained('fuel_cards')->restrictOnDelete();
            $table->foreignUuid('fuel_fleet_vehicle_id')->nullable()->constrained()->restrictOnDelete();
            $table->foreignUuid('fuel_fleet_driver_id')->nullable()->constrained()->restrictOnDelete();
            $table->foreignUuid('fuel_sale_id')->nullable()->constrained('fuel_sales')->restrictOnDelete();
            $table->string('identity_mode');
            $table->unsignedBigInteger('quantity_milliliters');
            $table->unsignedBigInteger('odometer')->nullable();
            $table->string('idempotency_key', 128);
            $table->string('payload_checksum', 64);
            $table->string('decision');
            $table->string('reason_code')->nullable();
            $table->json('suspicion_signals')->nullable();
            $table->dateTime('authorized_at');
            $table->dateTime('expires_at')->nullable();
            $table->dateTime('finalization_checked_at')->nullable();
            $table->foreignUuid('requested_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();

            $table->unique(['tenant_id', 'fuel_station_id', 'idempotency_key'], 'fuel_avi_authorization_idempotency_unique');
            $table->unique('fuel_sale_id', 'fuel_avi_authorization_sale_unique');
            $table->index(['tenant_id', 'fuel_fleet_vehicle_id', 'decision', 'authorized_at'], 'fuel_avi_authorization_vehicle_window');
            $table->index(['tenant_id', 'fuel_station_id', 'decision', 'authorized_at'], 'fuel_avi_authorization_denial_window');
        });

        Schema::table('fuel_sales', function (Blueprint $table) {
            $table->foreignUuid('fuel_avi_authorization_id')->nullable()->constrained('fuel_avi_authorizations')->restrictOnDelete();
            $table->index(['tenant_id', 'fuel_avi_authorization_id'], 'fuel_sales_avi_authorization_lookup');
        });
    }

    public function down(): void
    {
        Schema::table('fuel_sales', function (Blueprint $table) {
            $table->dropIndex('fuel_sales_avi_authorization_lookup');
            $table->dropConstrainedForeignId('fuel_avi_authorization_id');
        });

        Schema::dropIfExists('fuel_avi_authorizations');
        Schema::dropIfExists('fuel_avi_identity_tags');
    }
};
