<?php

namespace App\Services\Commerce\Otp;

/**
 * COM-MOBILE-AUTH-1 — the only seam between Commerce customer phone
 * authentication and an actual SMS/OTP vendor.
 *
 * `CustomerOtpService` owns code generation, hashing, expiry, and attempt
 * limiting; this contract is responsible for delivery alone, so swapping
 * the vendor never touches identity, token, or rate-limit logic. No vendor
 * (Unifonic or otherwise) is bound here yet — see `FakeOtpProvider` and
 * `CommerceApiServiceProvider`. Selecting/activating a real vendor is a
 * separate, explicitly deferred Decision/Owner Gate.
 */
interface OtpProvider
{
    public function send(string $tenantId, string $phoneE164, string $code, string $purpose): void;
}
