<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * COM-MOBILE-CART-IDENTITY-1 (ADR-07) — PR #924 review fix (Codex P1, fifth
 * round): `resolveCurrent()`/`findByToken()`'s token rebinding is a single
 * mutable slot, so a customer with two devices sharing one cart can have
 * device B's touch invalidate a token `findByToken()` *just* handed to
 * device A moments earlier during checkout preparation — device A's next
 * request (including `checkout/complete`, which deliberately excludes the
 * identity fallback since the second review round) then 404s even though
 * nothing about its own session actually changed.
 *
 * A second, previous-generation slot bounds the common two-device case: the
 * token that was valid *immediately before* the current one keeps resolving
 * for one more rebind cycle, so a single interleaved touch from another
 * device no longer invalidates a token in the same request/response pair it
 * was just issued in. This does not make the cart hold unlimited
 * simultaneous device sessions (a third rapid rotation before device A's
 * next request still invalidates it) — that would need a genuine
 * multi-token table, a materially larger schema change than "cart
 * ownership" calls for. Nullable, purely additive; no historical cart row
 * is reinterpreted.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('commerce_carts', function (Blueprint $table) {
            $table->string('previous_token_hash')->nullable()->after('token_hash');
        });
    }

    public function down(): void
    {
        Schema::table('commerce_carts', function (Blueprint $table) {
            $table->dropColumn('previous_token_hash');
        });
    }
};
