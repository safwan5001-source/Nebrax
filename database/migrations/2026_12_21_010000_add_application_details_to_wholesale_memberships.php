<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * H6 Batch M — optional, UNVERIFIED application details a buyer may give when applying for wholesale access.
 * Additive and nullable; no existing row changes. Deliberately stored on the membership (not on the buyer identity):
 * `customer_identities.phone` feeds phone-OTP login elsewhere, so an unverified application phone must never land there.
 * They are context for the staff reviewer, never an authority (not used for pricing, linking or eligibility).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('wholesale_memberships', function (Blueprint $table) {
            $table->string('company_name', 150)->nullable()->after('customer_identity_id');
            $table->string('contact_phone', 30)->nullable()->after('company_name');
        });
    }

    public function down(): void
    {
        Schema::table('wholesale_memberships', function (Blueprint $table) {
            $table->dropColumn(['company_name', 'contact_phone']);
        });
    }
};
