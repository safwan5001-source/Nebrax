<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * H6 Batch H — buyer (CustomerIdentity) email-verification tokens. Additive; no existing table is altered.
 *
 * - only the SHA-256 of the token is stored (the plaintext exists only in the e-mailed link);
 * - expiring (`expires_at`) and single-use (`used_at`);
 * - bound to the tenant AND the sales channel (the wholesale host) the registration came through, so a token
 *   issued on one store can never verify an identity through another store, tenant or channel;
 * - `customer_identity_id` cascades (a deleted identity leaves no live token), `sales_channel_id` restricts.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('customer_email_verification_tokens', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('customer_identity_id')->constrained('customer_identities')->cascadeOnDelete();
            $table->foreignUuid('sales_channel_id')->constrained('sales_channels')->restrictOnDelete();
            $table->char('token_hash', 64)->unique();
            $table->timestamp('expires_at');
            $table->timestamp('used_at')->nullable();
            $table->timestamp('created_at');

            $table->index(['tenant_id', 'customer_identity_id', 'used_at'], 'customer_email_verification_tokens_identity_idx');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('customer_email_verification_tokens');
    }
};
