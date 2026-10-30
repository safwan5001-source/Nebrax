<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * H6 Batch E — native wholesale buyer membership (additive; no existing table is altered except one
 * defaulted boolean on `sales_channels`).
 *
 * - `sales_channels.wholesale_membership_enabled` (default false): marks a channel as one whose protected
 *   capabilities require an approved membership. No HTTP route sets it in this batch (staff channel
 *   settings are a later batch); every existing channel stays `false`, so DTC behaviour is unchanged.
 * - `wholesale_memberships`: ONE row per (tenant, channel, buyer identity). Eligibility state only — it never
 *   stores credentials or session state (those stay on `customer_identities` / Sanctum tokens).
 * - `wholesale_membership_events`: append-only decision history (who/when/from→to).
 *
 * Rollback constraint: `down()` refuses while any membership or event row exists (decision history is audit
 * evidence and must not be dropped silently). It never seeds an approved membership.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (DB::getDriverName() === 'sqlite') {
            DB::statement('ALTER TABLE sales_channels ADD COLUMN wholesale_membership_enabled BOOLEAN NOT NULL DEFAULT 0');
        } else {
            Schema::table('sales_channels', function (Blueprint $table) {
                $table->boolean('wholesale_membership_enabled')->default(false);
            });
        }

        Schema::create('wholesale_memberships', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('sales_channel_id')->constrained('sales_channels')->restrictOnDelete();
            $table->foreignUuid('customer_identity_id')->constrained('customer_identities')->restrictOnDelete();
            // pending | approved | rejected | suspended (validated by the model + a CHECK on PostgreSQL).
            $table->string('status', 16)->default('pending');
            $table->timestamp('applied_at');
            $table->timestamp('decided_at')->nullable();
            $table->foreignUuid('decided_by_user_id')->nullable()->constrained('users')->nullOnDelete();
            // Staff-only note; never serialized to the buyer.
            $table->string('decision_note', 500)->nullable();
            $table->timestamps();

            $table->unique(['tenant_id', 'sales_channel_id', 'customer_identity_id'], 'wholesale_memberships_scope_unique');
            $table->index(['tenant_id', 'sales_channel_id', 'status'], 'wholesale_memberships_status_idx');
        });

        Schema::create('wholesale_membership_events', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('wholesale_membership_id')->constrained('wholesale_memberships')->cascadeOnDelete();
            $table->string('from_status', 16)->nullable();
            $table->string('to_status', 16);
            // buyer (self-application) | staff (decision)
            $table->string('actor_type', 8);
            $table->foreignUuid('actor_user_id')->nullable()->constrained('users')->nullOnDelete();
            $table->string('note', 500)->nullable();
            $table->timestamp('created_at');

            $table->index(['tenant_id', 'wholesale_membership_id'], 'wholesale_membership_events_membership_idx');
        });

        if (DB::getDriverName() === 'pgsql') {
            DB::statement("ALTER TABLE wholesale_memberships ADD CONSTRAINT wholesale_memberships_status_chk CHECK (status IN ('pending','approved','rejected','suspended'))");
            DB::statement("ALTER TABLE wholesale_membership_events ADD CONSTRAINT wholesale_membership_events_actor_chk CHECK (actor_type IN ('buyer','staff'))");
        }
    }

    public function down(): void
    {
        if (DB::table('wholesale_memberships')->exists() || DB::table('wholesale_membership_events')->exists()) {
            throw new RuntimeException('Refusing to roll back: wholesale membership decisions exist and are audit evidence.');
        }

        Schema::dropIfExists('wholesale_membership_events');
        Schema::dropIfExists('wholesale_memberships');

        if (DB::getDriverName() === 'sqlite') {
            DB::statement('ALTER TABLE sales_channels DROP COLUMN wholesale_membership_enabled');

            return;
        }

        Schema::table('sales_channels', function (Blueprint $table) {
            $table->dropColumn('wholesale_membership_enabled');
        });
    }
};
