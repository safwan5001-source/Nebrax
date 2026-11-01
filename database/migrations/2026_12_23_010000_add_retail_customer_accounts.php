<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * B2C-ACCOUNTS — native retail customer accounts (additive, closed by default).
 *
 * - `sales_channels.customer_accounts_enabled` (default false): per-channel switch for retail shopper accounts on the
 *   store host. Combined with the deployment flag `commerce.retail_accounts_enabled` (see {@see \App\Services\Commerce\RetailAccountGate}).
 *   Every existing channel stays `false`, so no storefront changes behaviour by deploying this.
 * - `commerce_order_ownership_claims`: append-only audit of every guest-order → account link (who / which order /
 *   which proof). The ONLY way `commerce_orders.customer_identity_id` ever changes is NULL → identity through
 *   {@see \App\Services\Commerce\CommerceOrderOwnershipClaimService}; this table is its evidence trail.
 *
 * Rollback: `down()` refuses while any claim row exists (audit evidence).
 */
return new class extends Migration
{
    public function up(): void
    {
        if (DB::getDriverName() === 'sqlite') {
            DB::statement('ALTER TABLE sales_channels ADD COLUMN customer_accounts_enabled BOOLEAN NOT NULL DEFAULT 0');
        } else {
            Schema::table('sales_channels', function (Blueprint $table) {
                $table->boolean('customer_accounts_enabled')->default(false);
            });
        }

        Schema::create('commerce_order_ownership_claims', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('commerce_order_id')->constrained('commerce_orders')->restrictOnDelete();
            $table->foreignUuid('customer_identity_id')->constrained('customer_identities')->restrictOnDelete();
            // verified_email | order_reference
            $table->string('proof', 24);
            $table->timestamp('created_at');

            // An order can be claimed once, ever (ownership is then immutable again).
            $table->unique(['tenant_id', 'commerce_order_id'], 'commerce_order_ownership_claims_order_unique');
            $table->index(['tenant_id', 'customer_identity_id'], 'commerce_order_ownership_claims_identity_idx');
        });

        if (DB::getDriverName() === 'pgsql') {
            DB::statement("ALTER TABLE commerce_order_ownership_claims ADD CONSTRAINT commerce_order_ownership_claims_proof_chk CHECK (proof IN ('verified_email','order_reference'))");
        }
    }

    public function down(): void
    {
        if (Schema::hasTable('commerce_order_ownership_claims') && DB::table('commerce_order_ownership_claims')->exists()) {
            throw new RuntimeException('Refusing to roll back: order ownership claims exist and are audit evidence.');
        }

        Schema::dropIfExists('commerce_order_ownership_claims');

        Schema::table('sales_channels', function (Blueprint $table) {
            $table->dropColumn('customer_accounts_enabled');
        });
    }
};
