<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * COM-MOBILE-AUTH-1 — OTP codes are a separate, short-lived, tenant-scoped
 * table, not a column on `customer_identities`: an identity may have zero or
 * many issued codes over its lifetime, only the latest unconsumed one is
 * ever active, and rows are cheap to prune independently of the identity.
 *
 * `code_hash` stores a bcrypt hash (`Hash::make()`), not a bare `sha256` —
 * a 6-digit code has only 10^6 possibilities, so a salted+slow hash resists
 * table-leak precomputation the way it would not with an unsalted digest.
 *
 * The partial unique index is the concurrency-safe backstop for "only one
 * active code per phone+purpose" — the same PostgreSQL/SQLite-portable
 * pattern already used by `customer_partner_links_one_active_per_identity`.
 * Without it, two concurrent issuance requests could each pass the
 * app-level checks and insert their own unconsumed code, leaving two
 * simultaneously valid codes (`CustomerOtpService::requestCode()`).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('customer_otp_codes', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained('tenants')->cascadeOnDelete();
            $table->string('phone_e164');
            $table->string('purpose');
            $table->string('code_hash');
            $table->unsignedTinyInteger('attempts')->default(0);
            $table->timestamp('consumed_at')->nullable();
            $table->timestamp('expires_at');
            $table->timestamps();

            $table->index(
                ['tenant_id', 'phone_e164', 'purpose', 'consumed_at'],
                'customer_otp_codes_lookup_index'
            );
        });

        DB::statement(
            'CREATE UNIQUE INDEX customer_otp_codes_one_active_per_phone_purpose '
            . 'ON customer_otp_codes (tenant_id, phone_e164, purpose) WHERE consumed_at IS NULL'
        );
    }

    public function down(): void
    {
        Schema::dropIfExists('customer_otp_codes');
    }
};
