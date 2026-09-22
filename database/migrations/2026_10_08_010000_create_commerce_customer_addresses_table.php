<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * COM-MOBILE-ADDRESSES-1 (ADR-08) — a dedicated address book owned by
 * `CustomerIdentity`, not `Partner` (most Commerce customers have no
 * `Partner` at all, per ADR-05; `Partner.address` is a single flat address,
 * not a book, and stays untouched here). Mirrors the exact
 * `CustomerIdentity` child-table pattern `CustomerOtpCode`/
 * `CustomerPartnerLink` already established: UUID PK, tenant FK, composite
 * tenant-scoped FK against `customer_identities`' existing `(tenant_id, id)`
 * unique index.
 *
 * Saudi National Address fields (`building_no`, `additional_number`,
 * `short_address`) are present but never unconditionally required —
 * validation is country-aware at the application layer
 * (`CommerceCustomerAddressRequest`), never enforced by a database
 * constraint that would reject a non-Saudi address.
 *
 * `is_default_shipping`/`is_default_billing`: partial unique indexes (same
 * PostgreSQL/SQLite-portable pattern as
 * `customer_partner_links_one_active_per_identity`) enforce at most one
 * default of each kind per customer at the database level, not only in
 * `CommerceCustomerAddressService`.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('commerce_customer_addresses', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained('tenants')->cascadeOnDelete();
            $table->uuid('customer_identity_id');
            $table->string('label')->nullable();
            $table->string('recipient_name');
            $table->string('phone');
            $table->string('country');
            $table->string('region')->nullable();
            $table->string('city');
            $table->string('district')->nullable();
            $table->string('street');
            $table->string('building_no')->nullable();
            $table->string('additional_number')->nullable();
            $table->string('postal_code')->nullable();
            $table->string('short_address')->nullable();
            $table->decimal('latitude', 10, 7)->nullable();
            $table->decimal('longitude', 10, 7)->nullable();
            $table->text('delivery_notes')->nullable();
            $table->boolean('is_default_shipping')->default(false);
            $table->boolean('is_default_billing')->default(false);
            $table->timestamps();

            $table->foreign(['tenant_id', 'customer_identity_id'], 'commerce_customer_addresses_identity_fk')
                ->references(['tenant_id', 'id'])->on('customer_identities')->cascadeOnDelete();

            $table->index(['tenant_id', 'customer_identity_id'], 'commerce_customer_addresses_tenant_identity_index');
        });

        DB::statement(
            'CREATE UNIQUE INDEX commerce_customer_addresses_one_default_shipping '
            . 'ON commerce_customer_addresses (tenant_id, customer_identity_id) WHERE is_default_shipping = true'
        );
        DB::statement(
            'CREATE UNIQUE INDEX commerce_customer_addresses_one_default_billing '
            . 'ON commerce_customer_addresses (tenant_id, customer_identity_id) WHERE is_default_billing = true'
        );
    }

    public function down(): void
    {
        Schema::dropIfExists('commerce_customer_addresses');
    }
};
