<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * H6 Batch M — buyer (CustomerIdentity) password-reset tokens. Additive; mirrors the approved e-mail-verification token
 * design exactly, in its own table so a verification link can never reset a password and a reset link can never verify
 * an e-mail address (the purposes are separated structurally, not by a flag):
 *  - only the SHA-256 of the token is stored; expiring and single-use;
 *  - bound to the tenant AND the sales channel (the store host the request came through);
 *  - `customer_identity_id` cascades; `sales_channel_id` restricts.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('customer_password_reset_tokens', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('customer_identity_id')->constrained('customer_identities')->cascadeOnDelete();
            $table->foreignUuid('sales_channel_id')->constrained('sales_channels')->restrictOnDelete();
            $table->char('token_hash', 64)->unique();
            $table->timestamp('expires_at');
            $table->timestamp('used_at')->nullable();
            $table->timestamp('created_at');

            $table->index(['tenant_id', 'customer_identity_id', 'used_at'], 'customer_password_reset_tokens_identity_idx');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('customer_password_reset_tokens');
    }
};
