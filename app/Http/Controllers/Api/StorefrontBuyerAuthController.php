<?php

namespace App\Http\Controllers\Api;

use App\Http\Middleware\BindStorefrontBuyerToChannel;
use App\Http\Requests\CustomerLoginRequest;
use App\Http\Requests\BuyerRegisterRequest;
use App\Http\Requests\BuyerForgotPasswordRequest;
use App\Http\Requests\BuyerResendVerificationRequest;
use App\Http\Requests\BuyerResetPasswordRequest;
use App\Http\Requests\BuyerVerifyEmailRequest;
use App\Http\Resources\CustomerIdentityResource;
use App\Models\CustomerIdentity;
use App\Services\Commerce\BuyerEmailVerificationService;
use App\Services\Commerce\BuyerPasswordResetService;
use App\Services\CustomerAuthenticationService;
use App\Services\CustomerIdentityService;
use App\Support\PublicApiErrorCode;
use App\Support\PublicApiResponse;
use App\Tenancy\StorefrontContext;
use App\Tenancy\TenantContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * H6 Batch E — store-host buyer identity (email + password; SMS/OTP is a later Messaging Foundation batch).
 *
 * NOT a new identity system: it is the existing tenant-scoped {@see CustomerIdentity} + the existing
 * {@see CustomerIdentityService}/{@see CustomerAuthenticationService} (the same authorities `customer/v1` and
 * `commerce/v1` use), exposed on the Host-resolved `store/v1` surface behind the wholesale gates. Buyers are
 * separate from ERP `User`s by construction. The tenant and channel come only from the resolved Host.
 *
 * - register: 202, identical for new/existing emails (no enumeration), no token.
 * - login: failures are the uniform `ValidationException` from the shared service (unknown email, wrong
 *   password, inactive, unverified are indistinguishable). Unverified identities cannot log in — the email
 *   verification *delivery* channel is the pre-existing gap shared with `customer/v1`/`commerce/v1`
 *   (Messaging Foundation); this batch neither fakes nor bypasses it.
 * - the issued token carries the `store-channel:{id}` ability and is accepted only on that host/channel.
 * - logout deletes the presented token (explicit session invalidation).
 */
class StorefrontBuyerAuthController extends PublicApiController
{
    public function register(BuyerRegisterRequest $request, CustomerIdentityService $identities): JsonResponse
    {
        $identity = $identities->register($request->validated());

        // Identical 202 for a new and an existing address (no enumeration). The verification e-mail is created and
        // sent after the response so response time does not depend on the address either.
        if ($identity !== null) {
            $this->sendVerificationAfterResponse($identity->id, $request->validated('locale_path'));
        }

        return PublicApiResponse::success($request, ['verification_required' => true], 202);
    }

    /** Verify the e-mailed link's token for THIS host's tenant + channel. Every failure is one generic 422. */
    public function verifyEmail(BuyerVerifyEmailRequest $request, BuyerEmailVerificationService $verification): JsonResponse
    {
        if (! $verification->verify($request->validated('token'))) {
            return PublicApiResponse::error(
                $request, PublicApiErrorCode::VALIDATION_FAILED, 'رابط التأكيد غير صالح أو منتهي.', 422,
            );
        }

        return PublicApiResponse::success($request, ['verified' => true]);
    }

    /** Neutral 202 whatever the address is (unknown, verified, inactive, cooling down, or eligible). */
    public function resendVerification(BuyerResendVerificationRequest $request): JsonResponse
    {
        $identity = CustomerIdentity::query()
            ->where('email_normalized', CustomerIdentity::normalizeEmail($request->validated('email')))
            ->first();

        if ($identity !== null) {
            $this->sendVerificationAfterResponse($identity->id, $request->validated('locale_path'));
        }

        return PublicApiResponse::success($request, ['verification_required' => true], 202);
    }

    /** Created and sent after the response (timing never reveals whether the address exists). */
    private function sendVerificationAfterResponse(string $identityId, ?string $localePath): void
    {
        $this->afterResponseInStore(fn () => app(BuyerEmailVerificationService::class)->sendFor($identityId, (string) $localePath));
    }

    /**
     * H6 Batch M — neutral 202 whatever the address is (unknown, unverified, inactive, cooling down, or eligible). Only a
     * verified, active identity of THIS tenant receives a link; the mail is created and sent after the response.
     */
    public function forgotPassword(BuyerForgotPasswordRequest $request): JsonResponse
    {
        $identity = CustomerIdentity::query()
            ->where('email_normalized', CustomerIdentity::normalizeEmail($request->validated('email')))
            ->first();

        if ($identity !== null) {
            $localePath = $request->validated('locale_path');
            $this->afterResponseInStore(fn () => app(BuyerPasswordResetService::class)->sendFor($identity->id, (string) $localePath));
        }

        return PublicApiResponse::success($request, ['reset_requested' => true], 202);
    }

    /** Consume the e-mailed token for THIS host's tenant + channel and set the new password. Every failure is one generic 422. */
    public function resetPassword(BuyerResetPasswordRequest $request, BuyerPasswordResetService $resets): JsonResponse
    {
        if (! $resets->complete($request->validated('token'), $request->validated('password'))) {
            return PublicApiResponse::error(
                $request, PublicApiErrorCode::VALIDATION_FAILED, 'رابط إعادة التعيين غير صالح أو منتهي.', 422,
            );
        }

        return PublicApiResponse::success($request, ['password_reset' => true]);
    }

    /**
     * Runs `$work` after the response with the TRUSTED tenant/channel/storefront of this request re-established (the
     * terminating phase runs after the request-scoped contexts are gone), then removes them again, exactly once.
     */
    private function afterResponseInStore(callable $work): void
    {
        $tenant = app(TenantContext::class);
        $storefront = app(StorefrontContext::class);
        if (! $tenant->has() || ! $storefront->isEstablished()) {
            return;
        }
        $tenantId = (string) $tenant->id();
        $channelId = $storefront->salesChannelId();
        $storefrontId = $storefront->hasStorefront() ? $storefront->storefrontId() : null;
        $done = false;

        // `terminating` callbacks of a long-lived app instance can run again on a later request: run exactly once.
        app()->terminating(function () use (&$done, $work, $tenantId, $channelId, $storefrontId): void {
            if ($done) {
                return;
            }
            $done = true;

            $tenantCtx = app(TenantContext::class);
            $storeCtx = app(StorefrontContext::class);
            $tenantCtx->set($tenantId);
            $storeCtx->set($tenantId, $channelId, $storefrontId);
            try {
                $work();
            } finally {
                $tenantCtx->forget();
                $storeCtx->forget();
            }
        });
    }

    public function login(CustomerLoginRequest $request, CustomerAuthenticationService $authentication, StorefrontContext $context): JsonResponse
    {
        $result = $authentication->login(
            $request->validated('email'),
            $request->validated('password'),
            [BindStorefrontBuyerToChannel::ability($context->salesChannelId())],
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

    public function me(Request $request): JsonResponse
    {
        /** @var CustomerIdentity $identity */
        $identity = $request->user();

        return PublicApiResponse::success($request, ['customer' => new CustomerIdentityResource($identity)]);
    }
}
