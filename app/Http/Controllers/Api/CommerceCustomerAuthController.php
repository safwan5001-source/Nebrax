<?php

namespace App\Http\Controllers\Api;

use App\Http\Requests\CommerceCustomerOtpRequestRequest;
use App\Http\Requests\CommerceCustomerOtpVerifyRequest;
use App\Http\Requests\CustomerLoginRequest;
use App\Http\Requests\CustomerRegisterRequest;
use App\Http\Resources\CustomerIdentityResource;
use App\Models\CustomerIdentity;
use App\Services\CustomerAuthenticationService;
use App\Services\CustomerIdentityService;
use App\Services\CustomerPhoneAuthenticationService;
use App\Support\PublicApiResponse;
use App\Tenancy\CustomerContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * ═══════════════════════════════════════════════════════════════
 *  Public/Mobile Commerce API V1 — COM-MOBILE-AUTH-1
 * ═══════════════════════════════════════════════════════════════
 *
 * Two independent, provider-neutral customer authentication mechanisms
 * (AWJ decision COM-MOBILE-AUTH-1-IDENTITY-MECHANISM):
 *  - phone + OTP (primary) — `requestOtp()`/`verifyOtp()`, a unified
 *    register-or-login flow backed by `CustomerPhoneAuthenticationService`.
 *  - email + password (alternative) — `registerWithEmail()`/
 *    `loginWithEmail()`, reusing `CustomerIdentityService`/
 *    `CustomerAuthenticationService` byte-for-byte, the exact same
 *    authorities `/customer/v1` already uses. Registration still returns
 *    202 with no token (email verification delivery is a pre-existing gap
 *    shared with `/customer/v1`, not introduced or fixed here — see the
 *    implementation report's discovered-backlog section).
 *
 * Both mechanisms produce the same `CustomerIdentity` + Sanctum
 * `customer:access` token shape; `me()`/`logout()` are mechanism-agnostic.
 * No exception is caught here — `ValidationException`/`LogicException`
 * propagate to `PublicApiExceptionRenderer`, which already envelopes them
 * uniformly for every other `/commerce/v1` controller.
 */
class CommerceCustomerAuthController extends PublicApiController
{
    public function registerWithEmail(CustomerRegisterRequest $request, CustomerIdentityService $identities): JsonResponse
    {
        $identities->register($request->validated());

        // Identical for new and existing identifiers — no enumeration, and
        // no token until a real email-verification delivery mechanism
        // exists (see implementation report backlog).
        return PublicApiResponse::success($request, ['verification_required' => true], 202);
    }

    public function loginWithEmail(CustomerLoginRequest $request, CustomerAuthenticationService $authentication): JsonResponse
    {
        $result = $authentication->login(
            $request->validated('email'),
            $request->validated('password'),
        );

        return PublicApiResponse::success($request, [
            'token' => $result['token'],
            'customer' => new CustomerIdentityResource($result['identity']),
        ]);
    }

    public function requestOtp(CommerceCustomerOtpRequestRequest $request, CustomerPhoneAuthenticationService $phoneAuth): JsonResponse
    {
        $phoneAuth->requestCode($request->validated('phone'));

        return PublicApiResponse::success($request, ['sent' => true], 202);
    }

    public function verifyOtp(CommerceCustomerOtpVerifyRequest $request, CustomerPhoneAuthenticationService $phoneAuth): JsonResponse
    {
        $result = $phoneAuth->verifyAndAuthenticate(
            $request->validated('phone'),
            $request->validated('code'),
        );

        return PublicApiResponse::success($request, [
            'token' => $result['token'],
            'customer' => new CustomerIdentityResource($result['identity']),
        ]);
    }

    public function logout(Request $request): JsonResponse
    {
        /** @var CustomerIdentity $identity */
        $identity = $request->user();
        $identity->currentAccessToken()->delete();

        return PublicApiResponse::success($request, ['logged_out' => true]);
    }

    public function me(Request $request, CustomerContext $customerContext): JsonResponse
    {
        /** @var CustomerIdentity $identity */
        $identity = $request->user();

        return PublicApiResponse::success($request, [
            'customer' => new CustomerIdentityResource($identity),
            'partner_link' => [
                'linked' => $customerContext->hasPartnerLink(),
                'partner_id' => $customerContext->linkedPartnerId(),
            ],
        ]);
    }
}
