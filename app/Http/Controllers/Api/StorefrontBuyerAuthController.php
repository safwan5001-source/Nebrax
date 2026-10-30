<?php

namespace App\Http\Controllers\Api;

use App\Http\Middleware\BindStorefrontBuyerToChannel;
use App\Http\Requests\CustomerLoginRequest;
use App\Http\Requests\CustomerRegisterRequest;
use App\Http\Resources\CustomerIdentityResource;
use App\Models\CustomerIdentity;
use App\Services\CustomerAuthenticationService;
use App\Services\CustomerIdentityService;
use App\Support\PublicApiResponse;
use App\Tenancy\StorefrontContext;
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
    public function register(CustomerRegisterRequest $request, CustomerIdentityService $identities): JsonResponse
    {
        $identities->register($request->validated());

        return PublicApiResponse::success($request, ['verification_required' => true], 202);
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
