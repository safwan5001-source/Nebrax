<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * COM-MOBILE-AUTH-1 — a Commerce customer may now prove identity via phone
 * OTP alone, never supplying email/password. `email`/`password` become
 * nullable (a phone-only identity has neither); `phone_verified_at` is the
 * OTP-side counterpart to the existing `email_verified_at`. Both nullable
 * unique-ish columns (`email_normalized`, `phone_e164`) already tolerate
 * multiple NULLs on SQLite and PostgreSQL alike, so this does not weaken the
 * existing one-identity-per-email/phone-per-tenant guarantee.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('customer_identities', function (Blueprint $table) {
            $table->timestamp('phone_verified_at')->nullable()->after('email_verified_at');
        });

        Schema::table('customer_identities', function (Blueprint $table) {
            $table->string('email')->nullable()->change();
            $table->string('email_normalized')->nullable()->change();
            $table->string('password')->nullable()->change();
        });
    }

    public function down(): void
    {
        Schema::table('customer_identities', function (Blueprint $table) {
            $table->string('email')->nullable(false)->change();
            $table->string('email_normalized')->nullable(false)->change();
            $table->string('password')->nullable(false)->change();
        });

        Schema::table('customer_identities', function (Blueprint $table) {
            $table->dropColumn('phone_verified_at');
        });
    }
};
