<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * H6 Batch F — append-only audit of staff-managed sales-channel pricing settings
 * (`default_price_list_id`, `wholesale_membership_enabled`). One row per effective change: actor, time and the
 * before/after values of exactly the keys that changed. Additive: no existing table is altered.
 *
 * Rollback constraint: `down()` refuses while any event exists (configuration history is audit evidence).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('sales_channel_setting_events', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('sales_channel_id')->constrained('sales_channels')->restrictOnDelete();
            $table->foreignUuid('actor_user_id')->nullable()->constrained('users')->nullOnDelete();
            // {"default_price_list_id": {"from": ..., "to": ...}, ...} — changed keys only.
            $table->json('changes');
            $table->timestamp('created_at');

            $table->index(['tenant_id', 'sales_channel_id', 'created_at'], 'sales_channel_setting_events_channel_idx');
        });
    }

    public function down(): void
    {
        if (DB::table('sales_channel_setting_events')->exists()) {
            throw new RuntimeException('Refusing to roll back: sales channel setting events exist and are audit evidence.');
        }

        Schema::dropIfExists('sales_channel_setting_events');
    }
};
